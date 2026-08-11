import { parse as parseBabel } from '@babel/parser'
import type * as t from '@babel/types'
import {
	type CollectionLayout,
	type CollectionLayoutSection,
	type DerivedTransform,
	type FieldHints,
	type FieldType,
	isDerivedTransform,
	isFieldType,
	type PathnameSegment,
	type PathnameSpec,
} from '@nuasite/cms-types'
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
	/** Name of the field this one is computed from (`n.text({ derivedFrom: 'category' })`). */
	derivedFrom?: string
	/** Named transform for the derived value; absent means `slugifyHref`. */
	derivedTransform?: DerivedTransform
}

export interface ParsedCollection {
	name: string
	fields: ParsedField[]
	/** `fields` is known to be incomplete — a spread or computed key in the schema was skipped. */
	partialFields?: true
	loaderPattern?: string
	loaderBase?: string
	/** Declarative form layout from a `defineCmsCollection({ cms: { … } })` block. */
	layout?: CollectionLayout
	/** Declarative page-URL rule from a `defineCmsCollection({ cms: { pathname } })` block. */
	pathname?: PathnameSpec
	/** Declarative entry-title source from a `defineCmsCollection({ cms: { titleField } })` block. */
	titleField?: string
	/** The collection owns no page, from a `defineCmsCollection({ cms: { fragment } })` block. */
	fragment?: true
	/** Preview target of a fragment collection, from a `defineCmsCollection({ cms: { previewOf } })` block. */
	previewOf?: string
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
 * a non-Identifier node, seeing through type-only wrappers (`as const`, `satisfies`,
 * `!`) on the way — they change nothing about the value a schema declares. Cycle-safe
 * via the visited set. Returns the node it stopped on — the peeled original when the
 * identifier is unbound or already visited.
 */
function resolveExpression(node: t.Node, bindings: Bindings, visited: Set<string> = new Set()): t.Node {
	let current: t.Node = node
	for (;;) {
		if (
			current.type === 'TSAsExpression'
			|| current.type === 'TSSatisfiesExpression'
			|| current.type === 'TSNonNullExpression'
			|| current.type === 'TSTypeAssertion'
		) {
			current = current.expression
			continue
		}
		if (current.type !== 'Identifier') return current
		if (visited.has(current.name)) return current
		visited.add(current.name)
		const next = bindings.get(current.name)
		if (!next) return current
		current = next
	}
}

function isAstNode(value: unknown): value is t.Node {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
}

/** Visit `node` and everything beneath it, finding children by shape — no @babel/traverse dependency. */
function walkNodes(node: t.Node, visit: (n: t.Node) => void): void {
	visit(node)
	const children: unknown[] = Object.values(node)
	for (const child of children) {
		if (Array.isArray(child)) {
			for (const item of child) {
				if (isAstNode(item)) walkNodes(item, visit)
			}
		} else if (isAstNode(child)) {
			walkNodes(child, visit)
		}
	}
}

/** Record every name a binding construct introduces, destructuring patterns included. */
function declaredPatternNames(node: t.Node, record: (name: string) => void): void {
	switch (node.type) {
		case 'Identifier':
			record(node.name)
			return
		case 'ObjectPattern':
			for (const prop of node.properties) declaredPatternNames(prop.type === 'RestElement' ? prop.argument : prop.value, record)
			return
		case 'ArrayPattern':
			for (const el of node.elements) {
				if (el) declaredPatternNames(el, record)
			}
			return
		case 'AssignmentPattern':
			declaredPatternNames(node.left, record)
			return
		case 'RestElement':
			declaredPatternNames(node.argument, record)
			return
	}
}

/**
 * Names the file declares more than once, anywhere.
 *
 * `bindings` is module-scope only, so a same-named local — a `const` inside the schema
 * callback, a parameter — is invisible to it and an identifier would resolve to the
 * module-level declaration instead: the wrong option list, the wrong type, the wrong
 * `required` flag. Modelling scopes properly is a bigger job than this parser wants, so
 * a name declared twice is simply not resolved and the field degrades as it did before.
 */
function shadowedNames(ast: t.File): Set<string> {
	const seen = new Set<string>()
	const shadowed = new Set<string>()
	const record = (name: string): void => {
		if (seen.has(name)) shadowed.add(name)
		seen.add(name)
	}

	walkNodes(ast, node => {
		switch (node.type) {
			case 'VariableDeclarator':
				declaredPatternNames(node.id, record)
				return
			case 'FunctionDeclaration':
			case 'FunctionExpression':
			case 'ArrowFunctionExpression':
				for (const param of node.params) declaredPatternNames(param, record)
				if (node.type !== 'ArrowFunctionExpression' && node.id) record(node.id.name)
				return
			case 'ClassDeclaration':
				if (node.id) record(node.id.name)
				return
			case 'ImportSpecifier':
			case 'ImportDefaultSpecifier':
			case 'ImportNamespaceSpecifier':
				record(node.local.name)
				return
		}
	})
	return shadowed
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

	// A name the file declares twice cannot be resolved to one binding without a scope
	// model, so drop it and let the fields that mention it stay untyped.
	for (const name of shadowedNames(ast)) bindings.delete(name)

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
		const declaredPathname = cmsProperty?.type === 'ObjectProperty' ? parseCmsPathname(cmsProperty.value, bindings) : undefined
		const titleField = cmsProperty?.type === 'ObjectProperty' ? parseCmsTitleField(cmsProperty.value, bindings) : undefined
		const fragment = cmsProperty?.type === 'ObjectProperty' ? parseCmsFragment(cmsProperty.value, bindings) : undefined
		const previewOf = cmsProperty?.type === 'ObjectProperty' ? parseCmsPreviewOf(cmsProperty.value, bindings) : undefined

		// `fragment` (no page of its own) and `pathname` (compose the entry's page URL)
		// contradict each other. Report it rather than silently preferring one — over this
		// channel because `cms-core` can't reach the ErrorCollector in `@nuasite/cms` and must
		// not grow a dependency on it; `warnOnPathnameCollisions` in collection-scanner.ts warns
		// the same way. `fragment` wins, and the warning says so.
		if (fragment && declaredPathname) {
			console.warn(
				`[cms] collection "${collectionName}": \`cms.fragment\` and \`cms.pathname\` are mutually exclusive — a fragment collection has no page of its own, so the \`pathname\` rule is ignored`,
			)
		}
		const pathname = fragment ? undefined : declaredPathname

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
				titleField,
				fragment,
				previewOf,
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
				titleField,
				fragment,
				previewOf,
			})
			continue
		}

		result.set(collectionName, {
			name: collectionName,
			fields: parseSchemaFields(schemaObject, bindings),
			...(hasSkippedMembers(schemaObject) ? { partialFields: true as const } : {}),
			loaderPattern,
			loaderBase,
			layout,
			pathname,
			titleField,
			fragment,
			previewOf,
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

/**
 * The complete option list of an `enum([…])` array, or null when any member is unreadable.
 *
 * All-or-nothing on purpose: these options become a *closed* set downstream, so reading
 * `[...BASE, 'blog']` as just `['blog']` would lock the field to the one member we
 * understood — every existing entry invalid, and the editor refusing to write the values
 * the schema does allow. A list we cannot read whole leaves the field open instead.
 */
function readEnumOptions(node: t.ArrayExpression): string[] | null {
	const options: string[] = []
	for (const el of node.elements) {
		if (el?.type !== 'StringLiteral') return null
		options.push(el.value)
	}
	return options.length > 0 ? options : null
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

/**
 * Parse a `cms: { titleField: 'heading' }` block into the field name an entry's
 * browse title is read from. Same shape-tolerant contract as {@link parseCmsPathname}:
 * a non-string or empty value yields undefined, which leaves the fallback chain in place.
 */
function parseCmsTitleField(node: t.Node, bindings: Bindings): string | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'ObjectExpression') return undefined

	const titleFieldProp = resolved.properties.find(
		p => p.type === 'ObjectProperty' && propertyKeyName(p.key) === 'titleField',
	)
	if (!titleFieldProp || titleFieldProp.type !== 'ObjectProperty') return undefined

	const value = resolveExpression(titleFieldProp.value, bindings)
	if (value.type !== 'StringLiteral' || value.value === '') return undefined
	return value.value
}

/**
 * Parse a `cms: { fragment: true }` block — the collection declaring it owns no page.
 * Only the literal `true` counts; anything else (including `fragment: false`) leaves the
 * collection routed as usual.
 */
function parseCmsFragment(node: t.Node, bindings: Bindings): true | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'ObjectExpression') return undefined

	const fragmentProp = resolved.properties.find(
		p => p.type === 'ObjectProperty' && propertyKeyName(p.key) === 'fragment',
	)
	if (!fragmentProp || fragmentProp.type !== 'ObjectProperty') return undefined

	const value = resolveExpression(fragmentProp.value, bindings)
	return value.type === 'BooleanLiteral' && value.value ? true : undefined
}

/**
 * Parse a `cms: { previewOf: '/aktualne' }` block into the page a fragment collection is
 * previewed on. Same shape-tolerant contract as {@link parseCmsTitleField}; a non-string
 * or empty value yields undefined, leaving the entries without a preview target.
 */
function parseCmsPreviewOf(node: t.Node, bindings: Bindings): string | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'ObjectExpression') return undefined

	const previewOfProp = resolved.properties.find(
		p => p.type === 'ObjectProperty' && propertyKeyName(p.key) === 'previewOf',
	)
	if (!previewOfProp || previewOfProp.type !== 'ObjectProperty') return undefined

	const value = resolveExpression(previewOfProp.value, bindings)
	if (value.type !== 'StringLiteral' || value.value === '') return undefined
	return value.value
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
 * Whether members of the schema object were skipped, leaving the field list short.
 *
 * A spread (`n.object({ ...base, order: n.number() })`) or a computed key contributes real
 * fields that never make it into `fields`. The difference matters to anything that treats
 * the list as exhaustive: an incomplete list is not the same as an empty one, and reading
 * it as complete turns a legitimate config into a page of warnings.
 */
function hasSkippedMembers(schemaObject: t.ObjectExpression): boolean {
	return schemaObject.properties.some(prop => prop.type !== 'ObjectProperty' || !propertyKeyName(prop.key))
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
function analyzeFieldExpression(node: t.Node, field: ParsedField, bindings: Bindings, helpers: Set<string> = new Set()): void {
	let current: t.Node | null = resolveExpression(node, bindings)
	while (current) {
		if (current.type !== 'CallExpression') return

		if (isBaseCall(current)) {
			analyzeBaseCall(current, field, bindings)
			return
		}

		// `tag: optionalTag()` — continue into what the helper returns, so both its type and
		// the `.optional()` it hides reach the field.
		if (current.callee.type === 'Identifier') {
			const returned = sameFileHelperReturn(current, bindings, helpers)
			if (returned) analyzeFieldExpression(returned, field, bindings, helpers)
			return
		}

		if (current.callee.type !== 'MemberExpression') return
		const property = current.callee.property
		const methodName = property.type === 'Identifier' ? property.name : ''

		// `n.text().array()` — the postfix spelling of `n.array(n.text())`. Without this the
		// walk steps into the receiver and stamps the *element* type on the list itself.
		if (methodName === 'array') {
			const item: ParsedField = { name: '__item__', required: true }
			analyzeFieldExpression(current.callee.object, item, bindings, helpers)
			// Keep an array of references flat, exactly as the `n.array(reference())` branch does.
			if (item.reference) {
				field.reference = { target: item.reference.target, isArray: true }
				return
			}
			field.type = 'array'
			if (item.type) field.itemType = item.type
			if (item.fields) field.fields = item.fields
			return
		}

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
 * The expression a same-file zero-argument helper returns, for field values written as
 * `tag: optionalTag()`. Cycle-safe via `seen`. A helper taking arguments, or one imported
 * from another module, resolves to null — its body is not here to read, and guessing at a
 * type the schema may not declare is worse than leaving the field untyped.
 */
function sameFileHelperReturn(call: t.CallExpression, bindings: Bindings, seen: Set<string>): t.Node | null {
	if (call.callee.type !== 'Identifier' || call.arguments.length > 0) return null
	if (seen.has(call.callee.name)) return null
	seen.add(call.callee.name)

	const fn = resolveExpression(call.callee, bindings)
	if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return null
	if (fn.params.length > 0) return null

	if (fn.body.type !== 'BlockStatement') return fn.body
	for (const stmt of fn.body.body) {
		if (stmt.type === 'ReturnStatement' && stmt.argument) return stmt.argument
	}
	return null
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
	// FIELD_HELPER_TYPES gates to the helper subset (excludes select/array/object/reference,
	// inferred below, and boolean, which `z` declares the same way); isFieldType narrows
	// `fn` to FieldType.
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

	// (z|n).boolean()  →  checkbox. Not in FIELD_HELPER_TYPES because that gate is `n`-only,
	// and a plain `z.boolean()` declares the very same field.
	if ((ns === 'z' || ns === 'n') && fn === 'boolean') {
		field.type = 'boolean'
		return
	}

	// (z|n).enum([...])  →  select with options
	if ((ns === 'z' || ns === 'n') && fn === 'enum') {
		const arg = node.arguments[0] ? resolveExpression(node.arguments[0], bindings) : undefined
		const options = arg?.type === 'ArrayExpression' ? readEnumOptions(arg) : null
		if (options) {
			field.type = 'select'
			field.options = options
		}
		// `n.enum([…], { label, help, … })` — the value list takes the first argument, so
		// layout hints ride in the second one; every other marker carries them in the first.
		// A bare `z.enum([…], { message })` is unaffected: Zod's params share no key with the
		// layout shape, so nothing is picked up.
		const hintsArg = node.arguments[1]
		if (hintsArg?.type === 'ObjectExpression') {
			const layout = parseFieldLayoutFromObject(hintsArg)
			if (layout) field.layout = layout
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
			case 'derivedFrom':
				parseDerivedFromValue(value, layout)
				break
		}
	}
	return Object.keys(layout).length > 0 ? layout : undefined
}

/**
 * Read a `derivedFrom` option in either authoring form:
 *
 * ```ts
 * n.text({ derivedFrom: 'category' })                                // → slugifyHref
 * n.text({ derivedFrom: { field: 'category', transform: 'slug' } })
 * ```
 *
 * `field` is mandatory in the object form — without a source there is nothing to derive
 * from, so the whole declaration is dropped. An unknown `transform` name is ignored rather
 * than rejected: the field keeps deriving, on the default transform, instead of silently
 * dropping out of the recompute because of a typo.
 */
function parseDerivedFromValue(value: t.ObjectProperty['value'], layout: ParsedFieldLayout): void {
	if (value.type === 'StringLiteral') {
		if (value.value) layout.derivedFrom = value.value
		return
	}
	if (value.type !== 'ObjectExpression') return

	let field: string | undefined
	let transform: DerivedTransform | undefined
	for (const prop of value.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (prop.value.type !== 'StringLiteral') continue
		if (key === 'field') field = prop.value.value
		else if (key === 'transform' && isDerivedTransform(prop.value.value)) transform = prop.value.value
	}

	if (!field) return
	layout.derivedFrom = field
	if (transform) layout.derivedTransform = transform
}
