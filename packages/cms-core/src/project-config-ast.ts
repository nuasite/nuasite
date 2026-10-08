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

/**
 * The integrations that take the CMS options as a call argument, by the module their default
 * export comes from, with the path to those options inside the first argument:
 * `nuaCms(options)` and `nua({ cms: options })`.
 */
const CMS_INTEGRATION_OPTIONS_PATH: Record<string, string[]> = {
	'@nuasite/cms': [],
	'@nuasite/nua': ['cms'],
	'@nuasite/nua/integration': ['cms'],
}

/** Local names the file imports a CMS-carrying integration under, mapped to its options path. */
function collectCmsIntegrationImports(ast: File): Map<string, string[]> {
	const imports = new Map<string, string[]>()
	for (const stmt of ast.program.body) {
		if (stmt.type !== 'ImportDeclaration') continue
		const optionsPath = CMS_INTEGRATION_OPTIONS_PATH[stmt.source.value]
		if (!optionsPath) continue
		for (const specifier of stmt.specifiers) {
			// `import nuaCms from …` and `import { default as nuaCms } from …`. `@nuasite/nua` also
			// exports its integration by name, as `nua`.
			const importedName = specifier.type === 'ImportDefaultSpecifier'
				? 'default'
				: specifier.type === 'ImportSpecifier'
				? propertyKeyName(specifier.imported)
				: null
			if (importedName === 'default' || (importedName === 'nua' && optionsPath.length > 0)) imports.set(specifier.local.name, optionsPath)
		}
	}
	return imports
}

/**
 * Every `cmsConfig` object the Astro config declares, in the order they are consulted.
 *
 * The CMS options reach the integration three ways, and a site picks one: the `nua.cms` block
 * of `defineConfig` from `@nuasite/nua/config`, or the integration called directly in
 * `integrations` — `nuaCms({ … })`, `nua({ cms: { … } })`. A reader that knew only the first
 * served nothing for a site using the others, while the integration itself had the value.
 * A call is recognised by where its callee is imported from, not by its name.
 */
function cmsConfigObjects(ast: File, configObject: ObjectExpression, bindings: Bindings): ObjectExpression[] {
	const found: ObjectExpression[] = []
	const fromBlock = objectAtPath(configObject, ['nua', 'cms', 'cmsConfig'], bindings)
	if (fromBlock) found.push(fromBlock)

	const integrations = objectPropertyValue(configObject, 'integrations', bindings)
	if (integrations?.type !== 'ArrayExpression') return found

	const integrationImports = collectCmsIntegrationImports(ast)
	for (const element of integrations.elements) {
		if (!element || element.type === 'SpreadElement') continue
		const call = resolveExpression(element, bindings)
		if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier') continue
		const optionsPath = integrationImports.get(call.callee.name)
		const firstArg = call.arguments[0]
		if (!optionsPath || !firstArg || firstArg.type === 'SpreadElement') continue
		const options = resolveExpression(firstArg, bindings)
		if (options.type !== 'ObjectExpression') continue
		const fromCall = objectAtPath(options, [...optionsPath, 'cmsConfig'], bindings)
		if (fromCall) found.push(fromCall)
	}
	return found
}

/** The first `listStyles` array among the `cmsConfig` objects; empty when none declares one. */
function parseConfigListStyles(cmsConfigs: ObjectExpression[], bindings: Bindings): CmsListStyle[] {
	for (const cmsConfig of cmsConfigs) {
		const listStylesNode = objectPropertyValue(cmsConfig, 'listStyles', bindings)
		if (listStylesNode?.type === 'ArrayExpression') return parseListStyles(listStylesNode, bindings)
	}
	return []
}

/** The value of `key` in `object`, when it is a non-empty static string. */
function staticStringOf(object: ObjectExpression | null, key: string, bindings: Bindings): string | undefined {
	const node = object ? objectPropertyValue(object, key, bindings) : null
	return (node && staticString(node, bindings)) || undefined
}

/**
 * The project's language: `cmsConfig.locale` when declared, otherwise Astro's
 * `i18n.defaultLocale`. The explicit key comes first because most sites are single-language
 * and have no `i18n` block — adding one changes how Astro routes, which is not a lever to
 * pull for the sake of sorting labels. A value that cannot be read statically counts as
 * absent, so an unreadable explicit locale falls through to `i18n.defaultLocale`.
 */
function parseLocale(cmsConfigs: ObjectExpression[], configObject: ObjectExpression, bindings: Bindings): string | undefined {
	for (const cmsConfig of cmsConfigs) {
		const explicit = staticStringOf(cmsConfig, 'locale', bindings)
		if (explicit) return explicit
	}
	return staticStringOf(objectAtPath(configObject, ['i18n'], bindings), 'defaultLocale', bindings)
}

/**
 * Parse the project-level CMS config from an Astro config source string: `listStyles` and
 * the project's language (see {@link parseLocale}), from wherever the config hands the
 * integration its `cmsConfig` (see {@link cmsConfigObjects}).
 */
export function parseProjectCmsConfigSource(source: string): CmsConfig {
	const ast = parseSource(source)
	if (!ast) return EMPTY_CONFIG

	const bindings = collectBindings(ast)
	const configObject = configObjectFromDefaultExport(ast, bindings)
	if (!configObject) return EMPTY_CONFIG

	const cmsConfigs = cmsConfigObjects(ast, configObject, bindings)
	const locale = parseLocale(cmsConfigs, configObject, bindings)
	return { listStyles: parseConfigListStyles(cmsConfigs, bindings), ...(locale ? { locale } : {}) }
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
