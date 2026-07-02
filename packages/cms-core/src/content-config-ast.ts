import { parse as parseBabel } from '@babel/parser'
import type * as t from '@babel/types'
import { type CollectionLayout, type CollectionLayoutSection, type FieldHints, type FieldType, isFieldType, type PathnameSegment, type PathnameSpec } from '@nuasite/cms-types'
import type { CmsFileSystem } from './fs/types'

export interface ParsedReference {
	target: string
	isArray: boolean
}

export interface ParsedField {
	name: string
	type?: FieldType
	options?: string[]
	hints?: FieldHints
	required: boolean
	orderBy?: { direction: 'asc' | 'desc' }
	reference?: ParsedReference
	/** True when the field is `image()` from an Astro callback schema, which routes through `astro:assets`. */
	astroImage?: boolean
	/** Element type for `array` fields */
	itemType?: FieldType
	/** Nested fields for `object` fields, or per-item fields for `array` of objects */
	fields?: ParsedField[]
	/** Layout hints read from the field's `n.*({ … })` options (label/help/group/sidebar/width/order/hidden). */
	layout?: ParsedFieldLayout
}

/** Per-field layout hints parsed from a marker's options object. */
export interface ParsedFieldLayout {
	label?: string
	help?: string
	group?: string
	sidebar?: boolean
	width?: 'full' | 'half'
	order?: number
	hidden?: boolean
}

export interface ParsedCollection {
	name: string
	fields: ParsedField[]
	loaderPattern?: string
	loaderBase?: string
	/** Declarative form layout from a `defineCmsCollection({ cms: { … } })` block. */
	layout?: CollectionLayout
	/** Declarative page-URL rule from a `defineCmsCollection({ cms: { pathname } })` block. */
	pathname?: PathnameSpec
}

export type ParsedConfig = Map<string, ParsedCollection>

/** Cached parse result keyed by config path; invalidated by mtime. */
export type ParseCache = Map<string, { mtimeMs: number; parsed: ParsedConfig }>

const FIELD_HELPER_TYPES = new Set([
	'text',
	'number',
	'image',
	'file',
	'url',
	'email',
	'tel',
	'color',
	'date',
	'datetime',
	'time',
	'year',
	'month',
	'textarea',
	'markdown',
])

const VALID_HINT_KEYS = new Set([
	'min',
	'max',
	'step',
	'placeholder',
	'maxLength',
	'minLength',
	'rows',
	'accept',
])

const WRAPPER_METHODS = new Set(['optional', 'nullable', 'nullish', 'default'])

/** Map of top-level `const <name> = <expr>` bindings within a single config file. */
type Bindings = Map<string, t.Node>

/**
 * Follow `Identifier` references through same-file `const` bindings until reaching
 * a non-Identifier node. Cycle-safe via the visited set. Returns the original node
 * unchanged when the identifier is unbound or already visited.
 */
function resolveExpression(node: t.Node, bindings: Bindings, visited: Set<string> = new Set()): t.Node {
	let current: t.Node = node
	while (current.type === 'Identifier') {
		if (visited.has(current.name)) return current
		visited.add(current.name)
		const next = bindings.get(current.name)
		if (!next) return current
		current = next
	}
	return current
}

/**
 * Parse a TypeScript/JS source string into a Babel `File`. Babel-only — no Astro
 * coupling. Returns null when parsing throws fatally.
 */
function parseSource(source: string): t.File | null {
	try {
		return parseBabel(source, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		})
	} catch {
		return null
	}
}

/**
 * Parse the project's Astro content config file (TypeScript) into a structured
 * representation of each collection's schema. Returns an empty map if no config
 * file exists or parsing fails. The mtime-keyed cache (via `fs.stat()`) skips
 * re-reading and re-parsing an unchanged config file.
 */
export async function parseContentConfig(fs: CmsFileSystem, cache: ParseCache): Promise<ParsedConfig> {
	for (const configPath of ['src/content/config.ts', 'src/content.config.ts']) {
		let stat: Awaited<ReturnType<CmsFileSystem['stat']>>
		try {
			stat = await fs.stat(configPath)
		} catch {
			continue
		}

		const cached = cache.get(configPath)
		if (cached && cached.mtimeMs === stat.mtimeMs) {
			if (cached.parsed.size > 0) return cached.parsed
			continue
		}

		const content = await fs.readFile(configPath)
		const parsed = parseConfigSource(content, configPath)
		cache.set(configPath, { mtimeMs: stat.mtimeMs, parsed })
		if (parsed.size > 0) return parsed
	}
	return new Map()
}

/** Exported for unit testing — operates on a source string directly. */
export function parseConfigSource(source: string, _sourcePath?: string): ParsedConfig {
	const result: ParsedConfig = new Map()
	const ast = parseSource(source)
	if (!ast) return result

	// Single pass: collect every top-level `const X = <expr>` binding (so we can
	// later resolve Identifier references like `cs: TestimonialTranslation`),
	// while also picking out `defineCollection({...})` calls and the
	// `export const collections = { name: X, ... }` mapping.
	const bindings: Bindings = new Map()
	const collectionDecls = new Map<string, t.ObjectExpression>()
	const exportMap = new Map<string, string>() // varName → collectionName
	const inlineCollections = new Map<string, t.ObjectExpression>() // collectionName → defineCollection arg (inline form)

	for (const stmt of ast.program.body) {
		const varDecl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration'
			? stmt.declaration
			: stmt.type === 'VariableDeclaration'
			? stmt
			: null
		if (!varDecl) continue

		for (const decl of varDecl.declarations) {
			if (decl.id.type !== 'Identifier') continue
			if (!decl.init) continue

			bindings.set(decl.id.name, decl.init)

			if (decl.id.name === 'collections' && decl.init.type === 'ObjectExpression') {
				for (const prop of decl.init.properties) {
					if (prop.type !== 'ObjectProperty') continue
					const key = propertyKeyName(prop.key)
					if (!key) continue
					if (prop.value.type === 'Identifier') {
						exportMap.set(prop.value.name, key)
					} else if (prop.value.type === 'CallExpression' && isDefineCollectionCallee(prop.value.callee)) {
						// Inline form: `collections = { name: defineCollection({...}) }`
						const inlineArg = prop.value.arguments[0]
						if (inlineArg?.type === 'ObjectExpression') {
							inlineCollections.set(key, inlineArg)
						}
					}
				}
				continue
			}

			if (decl.init.type === 'CallExpression' && isDefineCollectionCallee(decl.init.callee)) {
				const arg = decl.init.arguments[0]
				if (arg?.type === 'ObjectExpression') {
					collectionDecls.set(decl.id.name, arg)
				}
			}
		}
	}

	// Unify both styles: inline `name: defineCollection({...})` and the
	// `const x = defineCollection({...}); collections = { name: x }` reference form.
	const collectionObjects = new Map<string, t.ObjectExpression>(inlineCollections)
	for (const [varName, collectionName] of exportMap) {
		const decl = collectionDecls.get(varName)
		if (decl) collectionObjects.set(collectionName, decl)
	}

	for (const [collectionName, decl] of collectionObjects) {
		const loaderProperty = decl.properties.find(
			p =>
				p.type === 'ObjectProperty'
				&& propertyKeyName(p.key) === 'loader',
		)
		const loaderOptions = loaderProperty?.type === 'ObjectProperty' ? extractGlobLoaderOptions(loaderProperty.value, bindings) : {}
		const loaderPattern = loaderOptions.pattern
		const loaderBase = loaderOptions.base

		const cmsProperty = decl.properties.find(
			p =>
				p.type === 'ObjectProperty'
				&& propertyKeyName(p.key) === 'cms',
		)
		const layout = cmsProperty?.type === 'ObjectProperty' ? parseCmsLayout(cmsProperty.value, bindings) : undefined
		const pathname = cmsProperty?.type === 'ObjectProperty' ? parseCmsPathname(cmsProperty.value, bindings) : undefined

		const schemaProperty = decl.properties.find(
			p =>
				p.type === 'ObjectProperty'
				&& propertyKeyName(p.key) === 'schema',
		)
		if (!schemaProperty || schemaProperty.type !== 'ObjectProperty') {
			if (!loaderPattern) continue
			result.set(collectionName, {
				name: collectionName,
				fields: [],
				loaderPattern,
				loaderBase,
				layout,
				pathname,
			})
			continue
		}

		const schemaObject = unwrapSchemaToObject(schemaProperty.value, bindings)
		if (!schemaObject) {
			if (!loaderPattern) continue
			result.set(collectionName, {
				name: collectionName,
				fields: [],
				loaderPattern,
				loaderBase,
				layout,
				pathname,
			})
			continue
		}

		result.set(collectionName, {
			name: collectionName,
			fields: parseSchemaFields(schemaObject, bindings),
			loaderPattern,
			loaderBase,
			layout,
			pathname,
		})
	}

	return result
}

/**
 * Parse a `cms: { display, sidebar, sections }` layout block (the
 * `defineCmsCollection` form) from its ObjectExpression. Unknown/malformed keys
 * are skipped; returns undefined when nothing usable is found.
 */
function parseCmsLayout(node: t.Node, bindings: Bindings): CollectionLayout | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'ObjectExpression') return undefined

	const layout: CollectionLayout = {}
	for (const prop of resolved.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		const value = resolveExpression(prop.value, bindings)
		if (key === 'display') {
			if (value.type === 'StringLiteral' && (value.value === 'tabs' || value.value === 'sections')) layout.display = value.value
		} else if (key === 'sidebar') {
			if (value.type === 'ArrayExpression') layout.sidebar = stringArray(value)
		} else if (key === 'sections') {
			if (value.type === 'ArrayExpression') {
				const sections = value.elements
					.map(el => (el && el.type !== 'SpreadElement' ? parseLayoutSection(resolveExpression(el, bindings)) : null))
					.filter((s): s is NonNullable<typeof s> => s !== null)
				if (sections.length > 0) layout.sections = sections
			}
		}
	}
	return Object.keys(layout).length > 0 ? layout : undefined
}

/** Parse one `{ title, fields, collapsed }` section object. Requires a title + ≥1 field. */
function parseLayoutSection(node: t.Node): CollectionLayoutSection | null {
	if (node.type !== 'ObjectExpression') return null
	let title: string | undefined
	let fields: string[] = []
	let collapsed = false
	for (const prop of node.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (key === 'title' && prop.value.type === 'StringLiteral') title = prop.value.value
		else if (key === 'fields' && prop.value.type === 'ArrayExpression') fields = stringArray(prop.value)
		else if (key === 'collapsed' && prop.value.type === 'BooleanLiteral') collapsed = prop.value.value
	}
	if (title === undefined || fields.length === 0) return null
	return collapsed ? { title, fields, collapsed } : { title, fields }
}

/** Collect string-literal elements from an array expression. */
function stringArray(node: t.ArrayExpression): string[] {
	const out: string[] = []
	for (const el of node.elements) {
		if (el?.type === 'StringLiteral') out.push(el.value)
	}
	return out
}

function isDefineCollectionCallee(callee: t.Node): boolean {
	// `defineCmsCollection` (the @nuasite/cms wrapper carrying a `cms` layout block)
	// is treated identically — at runtime it strips `cms` and returns the Astro config.
	return callee.type === 'Identifier' && (callee.name === 'defineCollection' || callee.name === 'defineCmsCollection')
}

/**
 * Parse a `cms: { pathname: [...] }` block into a serializable {@link PathnameSpec}.
 * Robust by design: unknown/malformed entries are skipped and never throw; returns
 * undefined when no usable segment is found.
 */
function parseCmsPathname(node: t.Node, bindings: Bindings): PathnameSpec | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'ObjectExpression') return undefined

	const pathnameProp = resolved.properties.find(
		p => p.type === 'ObjectProperty' && propertyKeyName(p.key) === 'pathname',
	)
	if (!pathnameProp || pathnameProp.type !== 'ObjectProperty') return undefined

	const arr = resolveExpression(pathnameProp.value, bindings)
	if (arr.type !== 'ArrayExpression') return undefined

	const spec: PathnameSpec = []
	for (const el of arr.elements) {
		if (!el || el.type === 'SpreadElement') continue
		const segment = parsePathnameSegment(resolveExpression(el, bindings))
		if (segment) spec.push(segment)
	}
	return spec.length > 0 ? spec : undefined
}

/** Parse one `{ field, map? }` or `{ literal }` segment object. */
function parsePathnameSegment(node: t.Node): PathnameSegment | null {
	if (node.type !== 'ObjectExpression') return null
	let field: string | undefined
	let literal: string | undefined
	let map: Record<string, string> | undefined
	for (const prop of node.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (key === 'field' && prop.value.type === 'StringLiteral') field = prop.value.value
		else if (key === 'literal' && prop.value.type === 'StringLiteral') literal = prop.value.value
		else if (key === 'map' && prop.value.type === 'ObjectExpression') map = parseStringRecord(prop.value)
	}
	if (literal !== undefined) return { literal }
	if (field !== undefined) return map ? { field, map } : { field }
	return null
}

/** Collect string→string pairs from an object expression (non-string values skipped). */
function parseStringRecord(node: t.ObjectExpression): Record<string, string> | undefined {
	const out: Record<string, string> = {}
	for (const prop of node.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (key === null) continue
		if (prop.value.type === 'StringLiteral') out[key] = prop.value.value
	}
	return Object.keys(out).length > 0 ? out : undefined
}

function propertyKeyName(key: t.Node): string | null {
	if (key.type === 'Identifier') return key.name
	if (key.type === 'StringLiteral') return key.value
	return null
}

function extractGlobLoaderOptions(node: t.Node, bindings: Bindings): { pattern?: string; base?: string } {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'CallExpression') return {}
	if (!isGlobCallee(resolved.callee)) return {}

	const arg = resolved.arguments[0]
	if (!arg) return {}
	const options = resolveExpression(arg, bindings)
	if (options.type !== 'ObjectExpression') return {}

	const result: { pattern?: string; base?: string } = {}
	for (const prop of options.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (key !== 'pattern' && key !== 'base') continue
		const value = extractStaticString(prop.value, bindings)
		if (value !== undefined) result[key] = value
	}

	return result
}

function extractStaticString(node: t.Node, bindings: Bindings): string | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type === 'StringLiteral') return resolved.value
	if (resolved.type === 'TemplateLiteral' && resolved.expressions.length === 0) {
		return resolved.quasis[0]?.value.cooked ?? resolved.quasis[0]?.value.raw
	}
	return undefined
}

function isGlobCallee(callee: t.Node): boolean {
	return callee.type === 'Identifier' && callee.name === 'glob'
}

/**
 * Unwrap a `schema:` value down to the top-level (z|n).object({ ... }) ObjectExpression.
 * Handles direct calls, the Astro callback form `({ image }) => z.object({...})`,
 * and same-file variable references like `schema: BlogSchema`.
 */
function unwrapSchemaToObject(node: t.Node, bindings: Bindings): t.ObjectExpression | null {
	const resolved = resolveExpression(node, bindings)

	if (resolved.type === 'ArrowFunctionExpression' || resolved.type === 'FunctionExpression') {
		const body = resolved.body
		if (body.type === 'BlockStatement') {
			for (const stmt of body.body) {
				if (stmt.type === 'ReturnStatement' && stmt.argument) {
					return unwrapSchemaToObject(stmt.argument, bindings)
				}
			}
			return null
		}
		return unwrapSchemaToObject(body, bindings)
	}

	if (resolved.type === 'CallExpression') {
		const callee = resolved.callee
		if (
			callee.type === 'MemberExpression'
			&& callee.object.type === 'Identifier'
			&& (callee.object.name === 'z' || callee.object.name === 'n')
			&& callee.property.type === 'Identifier'
			&& callee.property.name === 'object'
		) {
			const arg = resolved.arguments[0]
			if (!arg) return null
			const resolvedArg = resolveExpression(arg, bindings)
			if (resolvedArg.type === 'ObjectExpression') return resolvedArg
		}
	}

	return null
}

function parseSchemaFields(schemaObject: t.ObjectExpression, bindings: Bindings): ParsedField[] {
	const fields: ParsedField[] = []
	for (const prop of schemaObject.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const name = propertyKeyName(prop.key)
		if (!name) continue

		const field: ParsedField = { name, required: true }
		analyzeFieldExpression(prop.value, field, bindings)
		fields.push(field)
	}
	return fields
}

/**
 * Walk a field's value expression. Each layer is either a wrapper method call
 * (`.optional()`, `.default()`, `.nullable()`, `.nullish()`, `.orderBy(...)`)
 * or the base call (`n.image()`, `image()`, `z.enum([...])`, `n.array(reference(...))`).
 *
 * Resolves same-file `Identifier` references against `bindings` at each layer so
 * patterns like `cs: TestimonialTranslation` and `en: TestimonialTranslation.optional()`
 * are followed back to their defining call.
 */
function analyzeFieldExpression(node: t.Node, field: ParsedField, bindings: Bindings): void {
	let current: t.Node | null = resolveExpression(node, bindings)
	while (current) {
		if (current.type !== 'CallExpression') return

		if (isBaseCall(current)) {
			analyzeBaseCall(current, field, bindings)
			return
		}

		if (current.callee.type !== 'MemberExpression') return
		const property = current.callee.property
		const methodName = property.type === 'Identifier' ? property.name : ''

		if (WRAPPER_METHODS.has(methodName)) {
			field.required = false
		} else if (methodName === 'orderBy') {
			const arg = current.arguments[0]
			const direction = arg?.type === 'StringLiteral' && arg.value === 'desc' ? 'desc' : 'asc'
			field.orderBy = { direction }
		}

		current = resolveExpression(current.callee.object, bindings)
	}
}

/**
 * A "base call" is the innermost call that defines the field's type: a Zod/n
 * helper invocation or a bare `image()` / `reference()` from a callback param.
 */
function isBaseCall(node: t.CallExpression): boolean {
	const callee = node.callee
	if (callee.type === 'Identifier') {
		return callee.name === 'image' || callee.name === 'reference'
	}
	if (callee.type === 'MemberExpression') {
		return callee.object.type === 'Identifier'
			&& (callee.object.name === 'n' || callee.object.name === 'z')
	}
	return false
}

function analyzeBaseCall(node: t.CallExpression, field: ParsedField, bindings: Bindings): void {
	const callee = node.callee

	// Bare image() / reference() from the schema callback form
	if (callee.type === 'Identifier') {
		if (callee.name === 'image') {
			field.type = 'image'
			field.astroImage = true
			return
		}
		if (callee.name === 'reference') {
			const arg = node.arguments[0]
			if (arg?.type === 'StringLiteral') {
				field.reference = { target: arg.value, isArray: false }
			}
			return
		}
		return
	}

	if (callee.type !== 'MemberExpression') return
	if (callee.object.type !== 'Identifier' || callee.property.type !== 'Identifier') return
	const ns = callee.object.name
	const fn = callee.property.name

	// n.image(), n.url(), n.text(...), etc. — semantic field types from @nuasite/cms.
	// FIELD_HELPER_TYPES gates to the helper subset (excludes boolean/select/array/object/
	// reference, which are inferred elsewhere); isFieldType narrows `fn` to FieldType.
	if (ns === 'n' && FIELD_HELPER_TYPES.has(fn) && isFieldType(fn)) {
		field.type = fn
		const firstArg = node.arguments[0]
		if (firstArg?.type === 'ObjectExpression') {
			const hints = parseHintsFromObject(firstArg)
			if (hints) field.hints = hints
			const layout = parseFieldLayoutFromObject(firstArg)
			if (layout) field.layout = layout
		}
		return
	}

	// (z|n).enum([...])  →  select with options
	if ((ns === 'z' || ns === 'n') && fn === 'enum') {
		const arg = node.arguments[0]
		if (arg?.type === 'ArrayExpression') {
			const options: string[] = []
			for (const el of arg.elements) {
				if (el?.type === 'StringLiteral') options.push(el.value)
			}
			if (options.length > 0) {
				field.type = 'select'
				field.options = options
			}
		}
		return
	}

	// (z|n).object({...})  →  nested object field
	if ((ns === 'z' || ns === 'n') && fn === 'object') {
		const arg = node.arguments[0]
		if (!arg) return
		const resolved = resolveExpression(arg, bindings)
		if (resolved.type === 'ObjectExpression') {
			field.type = 'object'
			field.fields = parseSchemaFields(resolved, bindings)
		}
		return
	}

	// (z|n).array(<inner>)  →  array; inspect the element type
	if ((ns === 'z' || ns === 'n') && fn === 'array') {
		const innerRaw = node.arguments[0]
		if (!innerRaw) return
		const inner = resolveExpression(innerRaw, bindings)
		// Array of references: keep the existing flat shape so detectReferenceFields can wire it up.
		if (
			inner.type === 'CallExpression'
			&& inner.callee.type === 'Identifier'
			&& inner.callee.name === 'reference'
		) {
			const target = inner.arguments[0]
			if (target?.type === 'StringLiteral') {
				field.reference = { target: target.value, isArray: true }
			}
			return
		}
		// Array of anything else: analyze the inner expression and lift its type/fields.
		// Note: nested arrays (`n.array(n.array(...))`) collapse here — `itemType` records
		// only the outer element type, the inner element shape is lost. No editor flow
		// currently renders nested arrays, so we don't carry a recursive `itemDefinition`
		// yet; add one when editor support arrives.
		const innerField: ParsedField = { name: '__item__', required: true }
		analyzeFieldExpression(inner, innerField, bindings)
		field.type = 'array'
		if (innerField.type) field.itemType = innerField.type
		if (innerField.fields) field.fields = innerField.fields
		return
	}
}

function parseHintsFromObject(obj: t.ObjectExpression): FieldHints | undefined {
	const raw: { [K in keyof FieldHints]: FieldHints[K] } = {}
	for (const prop of obj.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (!key || !VALID_HINT_KEYS.has(key)) continue

		const value = prop.value
		if (value.type === 'NumericLiteral') {
			assignHint(raw, key, value.value)
		} else if (
			value.type === 'UnaryExpression'
			&& value.operator === '-'
			&& value.argument.type === 'NumericLiteral'
		) {
			assignHint(raw, key, -value.argument.value)
		} else if (value.type === 'StringLiteral') {
			assignHint(raw, key, value.value)
		}
	}
	if (Object.keys(raw).length === 0) return undefined
	return raw
}

/** Assign a parsed hint value onto the hints object, narrowing per the FieldHints shape. */
function assignHint(hints: FieldHints, key: string, value: string | number): void {
	switch (key) {
		case 'min':
		case 'max':
			hints[key] = value
			return
		case 'step':
		case 'maxLength':
		case 'minLength':
		case 'rows':
			if (typeof value === 'number') hints[key] = value
			return
		case 'placeholder':
		case 'accept':
			if (typeof value === 'string') hints[key] = value
			return
	}
}

/** Read per-field layout hints (label/help/group/sidebar/width/order/hidden) from a marker's options object. */
function parseFieldLayoutFromObject(obj: t.ObjectExpression): ParsedFieldLayout | undefined {
	const layout: ParsedFieldLayout = {}
	for (const prop of obj.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		const value = prop.value
		switch (key) {
			case 'label':
				if (value.type === 'StringLiteral') layout.label = value.value
				break
			case 'help':
				if (value.type === 'StringLiteral') layout.help = value.value
				break
			case 'group':
				if (value.type === 'StringLiteral') layout.group = value.value
				break
			case 'width':
				if (value.type === 'StringLiteral' && (value.value === 'full' || value.value === 'half')) layout.width = value.value
				break
			case 'order':
				if (value.type === 'NumericLiteral') {
					layout.order = value.value
				} else if (value.type === 'UnaryExpression' && value.operator === '-' && value.argument.type === 'NumericLiteral') {
					layout.order = -value.argument.value
				}
				break
			case 'sidebar':
				if (value.type === 'BooleanLiteral') layout.sidebar = value.value
				break
			case 'hidden':
				if (value.type === 'BooleanLiteral') layout.hidden = value.value
				break
		}
	}
	return Object.keys(layout).length > 0 ? layout : undefined
}
