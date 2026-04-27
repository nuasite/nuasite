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
}

export interface ParsedCollection {
	name: string
	fields: ParsedField[]
}

export type ParsedConfig = Map<string, ParsedCollection>

const FIELD_HELPER_TYPES = new Set([
	'text',
	'number',
	'image',
	'url',
	'email',
	'tel',
	'color',
	'date',
	'datetime',
	'time',
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

	// Collect `const X = defineCollection({...})` declarations and the
	// `export const collections = { name: X, ... }` mapping, in any order.
	const collectionDecls = new Map<string, t.ObjectExpression>()
	const exportMap = new Map<string, string>() // varName → collectionName

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

			if (decl.id.name === 'collections' && decl.init.type === 'ObjectExpression') {
				for (const prop of decl.init.properties) {
					if (prop.type !== 'ObjectProperty') continue
					const key = propertyKeyName(prop.key)
					if (!key) continue
					if (prop.value.type === 'Identifier') {
						exportMap.set(prop.value.name, key)
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

	for (const [varName, collectionName] of exportMap) {
		const decl = collectionDecls.get(varName)
		if (!decl) continue

		const schemaProperty = decl.properties.find(
			p =>
				p.type === 'ObjectProperty'
				&& propertyKeyName(p.key) === 'schema',
		) as t.ObjectProperty | undefined
		if (!schemaProperty) continue

		const schemaObject = unwrapSchemaToObject(schemaProperty.value)
		if (!schemaObject) continue

		result.set(collectionName, {
			name: collectionName,
			fields: parseSchemaFields(schemaObject),
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

/**
 * Unwrap a `schema:` value down to the top-level (z|n).object({ ... }) ObjectExpression.
 * Handles direct calls and the Astro callback form `({ image }) => z.object({...})`.
 */
function unwrapSchemaToObject(node: t.Node): t.ObjectExpression | null {
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
		const body = node.body
		if (body.type === 'BlockStatement') {
			for (const stmt of body.body) {
				if (stmt.type === 'ReturnStatement' && stmt.argument) {
					return unwrapSchemaToObject(stmt.argument)
				}
			}
			return null
		}
		return unwrapSchemaToObject(body)
	}

	if (node.type === 'CallExpression') {
		const callee = node.callee
		if (
			callee.type === 'MemberExpression'
			&& callee.object.type === 'Identifier'
			&& (callee.object.name === 'z' || callee.object.name === 'n')
			&& callee.property.type === 'Identifier'
			&& callee.property.name === 'object'
		) {
			const arg = node.arguments[0]
			if (arg?.type === 'ObjectExpression') return arg
		}
	}

	return null
}

function parseSchemaFields(schemaObject: t.ObjectExpression): ParsedField[] {
	const fields: ParsedField[] = []
	for (const prop of schemaObject.properties) {
		if (prop.type !== 'ObjectProperty') continue
		const name = propertyKeyName(prop.key)
		if (!name) continue

		const field: ParsedField = { name, required: true }
		analyzeFieldExpression(prop.value, field)
		fields.push(field)
	}
	return fields
}

/**
 * Walk a field's value expression. Each layer is either a wrapper method call
 * (`.optional()`, `.default()`, `.nullable()`, `.nullish()`, `.orderBy(...)`)
 * or the base call (`n.image()`, `image()`, `z.enum([...])`, `n.array(reference(...))`).
 */
function analyzeFieldExpression(node: t.Node, field: ParsedField): void {
	let current: t.Node | null = node
	while (current) {
		if (current.type !== 'CallExpression') return

		if (isBaseCall(current)) {
			analyzeBaseCall(current, field)
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

		current = current.callee.object
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

function analyzeBaseCall(node: t.CallExpression, field: ParsedField): void {
	const callee = node.callee

	// Bare image() / reference() from the schema callback form
	if (callee.type === 'Identifier') {
		if (callee.name === 'image') {
			field.type = 'image'
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

	// (z|n).array(reference('foo'))  →  array of references
	if ((ns === 'z' || ns === 'n') && fn === 'array') {
		const inner = node.arguments[0]
		if (
			inner?.type === 'CallExpression'
			&& inner.callee.type === 'Identifier'
			&& inner.callee.name === 'reference'
		) {
			const target = inner.arguments[0]
			if (target?.type === 'StringLiteral') {
				field.reference = { target: target.value, isArray: true }
			}
		}
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
