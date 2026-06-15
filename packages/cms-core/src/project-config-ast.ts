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

/** Parse `nua.cms.cmsConfig.listStyles` from an Astro config source string. */
export function parseProjectCmsConfigSource(source: string): CmsConfig {
	const ast = parseSource(source)
	if (!ast) return EMPTY_CONFIG

	const bindings = collectBindings(ast)
	const configObject = configObjectFromDefaultExport(ast, bindings)
	if (!configObject) return EMPTY_CONFIG

	const cmsConfig = objectAtPath(configObject, ['nua', 'cms', 'cmsConfig'], bindings)
	if (!cmsConfig) return EMPTY_CONFIG

	const listStylesNode = objectPropertyValue(cmsConfig, 'listStyles', bindings)
	if (!listStylesNode || listStylesNode.type !== 'ArrayExpression') return EMPTY_CONFIG

	return { listStyles: parseListStyles(listStylesNode, bindings) }
}

/** Read and parse the consuming project's `astro.config.ts`, tolerating absence or malformed config. */
export async function parseProjectCmsConfig(fs: CmsFileSystem): Promise<CmsConfig> {
	try {
		const source = await fs.readFile('astro.config.ts')
		return parseProjectCmsConfigSource(source)
	} catch {
		return { listStyles: [] }
	}
}
