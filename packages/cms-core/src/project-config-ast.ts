import { parse } from '@babel/parser'
import type { ArrayExpression, File, Node, ObjectExpression } from '@babel/types'
import type { CmsConfig, CmsListStyle } from '@nuasite/cms-types'
import type { CmsFileSystem } from './fs/types'

type Bindings = Map<string, Node>

const EMPTY_CONFIG: CmsConfig = { listStyles: [] }

function parseSource(source: string): File | null {
	try {
		return parse(source, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		})
	} catch {
		return null
	}
}

function collectBindings(ast: File): Bindings {
	const bindings: Bindings = new Map()
	for (const stmt of ast.program.body) {
		const varDecl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration'
			? stmt.declaration
			: stmt.type === 'VariableDeclaration'
			? stmt
			: null
		if (!varDecl) continue

		for (const decl of varDecl.declarations) {
			if (decl.id.type === 'Identifier' && decl.init) bindings.set(decl.id.name, decl.init)
		}
	}
	return bindings
}

function resolveExpression(node: Node, bindings: Bindings, visited: Set<string> = new Set()): Node {
	let current = node
	while (current.type === 'Identifier') {
		if (visited.has(current.name)) return current
		visited.add(current.name)
		const next = bindings.get(current.name)
		if (!next) return current
		current = next
	}
	return current
}

function propertyKeyName(key: Node): string | null {
	if (key.type === 'Identifier') return key.name
	if (key.type === 'StringLiteral') return key.value
	return null
}

function objectPropertyValue(node: ObjectExpression, keyName: string, bindings: Bindings): Node | null {
	for (const prop of node.properties) {
		if (prop.type !== 'ObjectProperty') continue
		if (propertyKeyName(prop.key) !== keyName) continue
		return resolveExpression(prop.value, bindings)
	}
	return null
}

function objectAtPath(root: ObjectExpression, keys: string[], bindings: Bindings): ObjectExpression | null {
	let current: ObjectExpression = root
	for (const key of keys) {
		const value = objectPropertyValue(current, key, bindings)
		if (!value || value.type !== 'ObjectExpression') return null
		current = value
	}
	return current
}

function staticString(node: Node, bindings: Bindings): string | undefined {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type === 'StringLiteral') return resolved.value
	if (resolved.type === 'TemplateLiteral' && resolved.expressions.length === 0) {
		return resolved.quasis[0]?.value.cooked ?? resolved.quasis[0]?.value.raw
	}
	return undefined
}

function parseListStyle(node: Node, bindings: Bindings): CmsListStyle | null {
	const resolved = resolveExpression(node, bindings)
	if (resolved.type !== 'ObjectExpression') return null
	const labelNode = objectPropertyValue(resolved, 'label', bindings)
	const classNode = objectPropertyValue(resolved, 'class', bindings)
	if (!labelNode || !classNode) return null
	const label = staticString(labelNode, bindings)
	const className = staticString(classNode, bindings)
	if (label === undefined || className === undefined) return null
	return { label, class: className }
}

function parseListStyles(node: ArrayExpression, bindings: Bindings): CmsListStyle[] {
	const styles: CmsListStyle[] = []
	for (const element of node.elements) {
		if (!element || element.type === 'SpreadElement') continue
		const style = parseListStyle(element, bindings)
		if (style) styles.push(style)
	}
	return styles
}

function configObjectFromDefaultExport(ast: File, bindings: Bindings): ObjectExpression | null {
	for (const stmt of ast.program.body) {
		if (stmt.type !== 'ExportDefaultDeclaration') continue
		const declaration = resolveExpression(stmt.declaration, bindings)
		if (declaration.type === 'ObjectExpression') return declaration
		if (declaration.type === 'CallExpression') {
			const firstArg = declaration.arguments[0]
			if (!firstArg || firstArg.type === 'SpreadElement') return null
			const resolvedArg = resolveExpression(firstArg, bindings)
			if (resolvedArg.type === 'ObjectExpression') return resolvedArg
		}
	}
	return null
}

/** `nua.cms.cmsConfig.listStyles` of the config object; empty when absent or not an array. */
function parseConfigListStyles(configObject: ObjectExpression, bindings: Bindings): CmsListStyle[] {
	const cmsConfig = objectAtPath(configObject, ['nua', 'cms', 'cmsConfig'], bindings)
	if (!cmsConfig) return []

	const listStylesNode = objectPropertyValue(cmsConfig, 'listStyles', bindings)
	if (!listStylesNode || listStylesNode.type !== 'ArrayExpression') return []

	return parseListStyles(listStylesNode, bindings)
}

/** The string at `path` → `key` of the config object, when it is a non-empty static string. */
function staticStringAt(configObject: ObjectExpression, path: string[], key: string, bindings: Bindings): string | undefined {
	const parent = objectAtPath(configObject, path, bindings)
	const node = parent ? objectPropertyValue(parent, key, bindings) : null
	return (node && staticString(node, bindings)) || undefined
}

/**
 * The project's language: `nua.cms.cmsConfig.locale` when declared, otherwise Astro's
 * `i18n.defaultLocale`. The explicit key comes first because most sites are single-language
 * and have no `i18n` block — adding one changes how Astro routes, which is not a lever to
 * pull for the sake of sorting labels. A value that cannot be read statically counts as
 * absent, so an unreadable explicit locale falls through to `i18n.defaultLocale`.
 */
function parseLocale(configObject: ObjectExpression, bindings: Bindings): string | undefined {
	return staticStringAt(configObject, ['nua', 'cms', 'cmsConfig'], 'locale', bindings)
		?? staticStringAt(configObject, ['i18n'], 'defaultLocale', bindings)
}

/**
 * Parse the project-level CMS config from an Astro config source string:
 * `nua.cms.cmsConfig.listStyles`, and the project's language (see {@link parseLocale}).
 */
export function parseProjectCmsConfigSource(source: string): CmsConfig {
	const ast = parseSource(source)
	if (!ast) return EMPTY_CONFIG

	const bindings = collectBindings(ast)
	const configObject = configObjectFromDefaultExport(ast, bindings)
	if (!configObject) return EMPTY_CONFIG

	const locale = parseLocale(configObject, bindings)
	return { listStyles: parseConfigListStyles(configObject, bindings), ...(locale ? { locale } : {}) }
}

const ASTRO_CONFIG_FILES = ['astro.config.ts', 'astro.config.mts', 'astro.config.mjs', 'astro.config.js']

/** Read and parse the consuming project's Astro config, tolerating absence or malformed config. */
export async function parseProjectCmsConfig(fs: CmsFileSystem): Promise<CmsConfig> {
	for (const file of ASTRO_CONFIG_FILES) {
		let source: string
		try {
			source = await fs.readFile(file)
		} catch {
			continue
		}
		return parseProjectCmsConfigSource(source)
	}
	return EMPTY_CONFIG
}
