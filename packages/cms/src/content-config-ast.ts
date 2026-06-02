import type * as t from '@babel/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from './config'
import { parseFrontmatter } from './source-finder/ast-parser'
import type { FieldHints, FieldType } from './types'

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
}

export interface ParsedCollection {
	name: string
	fields: ParsedField[]
	loaderPattern?: string
	loaderBase?: string
}

export type ParsedConfig = Map<string, ParsedCollection>

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

/** Cached parse result keyed by absolute path; invalidated by mtime. */
const parseCache = new Map<string, { mtimeMs: number; parsed: ParsedConfig }>()

/**
 * Parse the project's Astro content config file (TypeScript) into a structured
 * representation of each collection's schema. Returns an empty map if no config
 * file exists or parsing fails.
 */
export async function parseContentConfig(): Promise<ParsedConfig> {
	const projectRoot = getProjectRoot()
	for (const configPath of ['src/content/config.ts', 'src/content.config.ts']) {
		const fullPath = path.join(projectRoot, configPath)
		let stat: Awaited<ReturnType<typeof fs.stat>>
		try {
			stat = await fs.stat(fullPath)
		} catch {
			continue
		}

		const cached = parseCache.get(fullPath)
		if (cached && cached.mtimeMs === stat.mtimeMs) {
			if (cached.parsed.size > 0) return cached.parsed
			continue
		}

		const content = await fs.readFile(fullPath, 'utf-8')
		const parsed = parseConfigSource(content, configPath)
		parseCache.set(fullPath, { mtimeMs: stat.mtimeMs, parsed })
		if (parsed.size > 0) return parsed
	}
	return new Map()
}

/** Exported for unit testing — operates on a source string directly. */
export function parseConfigSource(source: string, sourcePath?: string): ParsedConfig {
	const result: ParsedConfig = new Map()
	const ast = parseFrontmatter(source, sourcePath) as unknown as t.File | null
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
		) as t.ObjectProperty | undefined
		const loaderOptions = loaderProperty ? extractGlobLoaderOptions(loaderProperty.value, bindings) : {}
		const loaderPattern = loaderOptions.pattern
		const loaderBase = loaderOptions.base

		const schemaProperty = decl.properties.find(
			p =>
				p.type === 'ObjectProperty'
				&& propertyKeyName(p.key) === 'schema',
		) as t.ObjectProperty | undefined
		if (!schemaProperty) {
			if (!loaderPattern) continue
			result.set(collectionName, {
				name: collectionName,
				fields: [],
				loaderPattern,
				loaderBase,
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
			})
			continue
		}

		result.set(collectionName, {
			name: collectionName,
			fields: parseSchemaFields(schemaObject, bindings),
			loaderPattern,
			loaderBase,
		})
	}

	return result
}

function isDefineCollectionCallee(callee: t.Node): boolean {
	return callee.type === 'Identifier' && callee.name === 'defineCollection'
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

	// n.image(), n.url(), n.text(...), etc. — semantic field types from @nuasite/cms
	if (ns === 'n' && FIELD_HELPER_TYPES.has(fn)) {
		field.type = fn as FieldType
		const firstArg = node.arguments[0]
		if (firstArg?.type === 'ObjectExpression') {
			const hints = parseHintsFromObject(firstArg)
			if (hints) field.hints = hints
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
	const raw: Record<string, string | number> = {}
	for (const prop of obj.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const key = propertyKeyName(prop.key)
		if (!key || !VALID_HINT_KEYS.has(key)) continue

		const value = prop.value
		if (value.type === 'NumericLiteral') {
			raw[key] = value.value
		} else if (
			value.type === 'UnaryExpression'
			&& value.operator === '-'
			&& value.argument.type === 'NumericLiteral'
		) {
			raw[key] = -value.argument.value
		} else if (value.type === 'StringLiteral') {
			raw[key] = value.value
		}
	}
	if (Object.keys(raw).length === 0) return undefined
	return raw as FieldHints
}
