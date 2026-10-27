import { parse } from '@babel/parser'
import type { ArrayExpression, File, Node, ObjectExpression } from '@babel/types'
import type { CmsConfig, CmsListStyle } from '@nuasite/cms-types'
import type { CmsFileSystem } from './fs/types.ts'

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

/**
 * The expression under the wrappers that exist for the type checker only — `x as T`,
 * `x satisfies T`, `x!`, `<T>x`. They are gone at runtime, so a config that works there must
 * read the same here: `const LOCALE = 'cs' as const`, `defineConfig({ … } satisfies NuaConfig)`.
 */
function withoutTypeWrappers(node: Node): Node {
	let current = node
	while (
		current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression' || current.type === 'TSNonNullExpression'
		|| current.type === 'TSTypeAssertion'
	) {
		current = current.expression
	}
	return current
}

function resolveExpression(node: Node, bindings: Bindings, visited: Set<string> = new Set()): Node {
	let current = withoutTypeWrappers(node)
	while (current.type === 'Identifier') {
		if (visited.has(current.name)) return current
		visited.add(current.name)
		const next = bindings.get(current.name)
		if (!next) return current
		current = withoutTypeWrappers(next)
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
 * What the default export's config goes through before Astro sees it: the `defineConfig` of
 * `@nuasite/nua/config`, which adds the nua integration on its own; Astro's, or no call at
 * all, where a `nua` key means nothing; or a function this reader does not know.
 */
function defaultExportWrapper(ast: File, bindings: Bindings): 'nua' | 'astro' | 'unknown' {
	const exported = ast.program.body.find(stmt => stmt.type === 'ExportDefaultDeclaration')
	const declaration = exported?.type === 'ExportDefaultDeclaration' ? resolveExpression(exported.declaration, bindings) : null
	if (declaration?.type !== 'CallExpression') return 'astro'
	// `(defineConfig as any)(…)` and `defineConfig!(…)` call the same function.
	const callee = withoutTypeWrappers(declaration.callee)
	if (callee.type !== 'Identifier') return 'unknown'
	for (const stmt of ast.program.body) {
		if (stmt.type !== 'ImportDeclaration' || !stmt.specifiers.some(specifier => specifier.local.name === callee.name)) continue
		if (stmt.source.value === '@nuasite/nua/config') return 'nua'
		if (stmt.source.value === 'astro/config') return 'astro'
	}
	return 'unknown'
}

/**
 * A CMS instance as far as this reader is concerned: its `cmsConfig` object, `null` when it
 * declares none that can be read, `undefined` when there is no instance at all.
 */
type CmsInstance = ObjectExpression | null | undefined

/**
 * The CMS instance a nua integration runs, given the value of its `cms` option (`null` when
 * the option is not set). nua runs a CMS unless told `cms: false`; `true`, nothing, or a
 * value that cannot be read are all an instance — only an object can carry a `cmsConfig`.
 */
function nuaCmsInstance(cms: Node | null, bindings: Bindings): CmsInstance {
	if (cms?.type === 'BooleanLiteral' && !cms.value) return undefined
	return cms?.type === 'ObjectExpression' ? objectAtPath(cms, ['cmsConfig'], bindings) : null
}

/** The CMS instance the config's own `nua` key stands for, if anything reads that key. */
function wrapperCmsInstance(ast: File, configObject: ObjectExpression, bindings: Bindings): CmsInstance {
	const wrapper = defaultExportWrapper(ast, bindings)
	if (wrapper === 'astro') return undefined

	const nua = objectPropertyValue(configObject, 'nua', bindings)
	const cms = nua?.type === 'ObjectExpression' ? objectPropertyValue(nua, 'cms', bindings) : null
	if (wrapper === 'unknown') {
		// Somebody's own wrapper: whether it adds nua cannot be known from here. A `nua.cms`
		// block is taken as a sign that it does; without one, nothing is assumed.
		return cms?.type === 'ObjectExpression' ? nuaCmsInstance(cms, bindings) : undefined
	}
	// The nua wrapper adds the integration whether or not the config mentions `nua` — only
	// `nua: false` stops it — so the instance is there even with nothing to read from.
	if (nua?.type === 'BooleanLiteral' && !nua.value) return undefined
	return nuaCmsInstance(cms, bindings)
}

/**
 * The `cmsConfig` object of the CMS instance whose configuration the page ends up with, or
 * null when that instance declares none (or none can be read).
 *
 * The CMS options reach the integration three ways: the `nua` key of `defineConfig` from
 * `@nuasite/nua/config`, or the integration called directly in `integrations` —
 * `nuaCms({ … })`, `nua({ cms: { … } })`. A call is recognised by where its callee is
 * imported from, not by its name.
 *
 * A site picks one. A config that uses several runs several CMS instances, every one of them
 * assigns `window.NuaCmsConfig`, and the page keeps the last assignment. Which one that is was
 * established by running such configs through Astro's own dev setup, not by reading hook
 * code: nua registers its CMS behind everything listed in `integrations`, so
 *
 * - nua's CMS — the wrapper's, or a listed `nua()` call's — beats every `nuaCms()` call,
 *   wherever it stands and whether or not it carries a `cmsConfig`;
 * - without one, the last `nuaCms()` call is it.
 *
 * Exactly one object is the answer; `listStyles` from one instance and `locale` from another
 * would describe a configuration no page ever has. Two nua integrations in one config (the
 * wrapper plus a listed `nua()`, or `nua()` twice) is not a working setup — their page
 * scripts collide — so nothing is promised for it beyond an answer.
 */
function effectiveCmsConfig(ast: File, configObject: ObjectExpression, bindings: Bindings): ObjectExpression | null {
	let fromNua = wrapperCmsInstance(ast, configObject, bindings)
	let fromCms: CmsInstance

	const integrations = objectPropertyValue(configObject, 'integrations', bindings)
	const integrationImports = collectCmsIntegrationImports(ast)
	for (const element of integrations?.type === 'ArrayExpression' ? integrations.elements : []) {
		if (!element || element.type === 'SpreadElement') continue
		const call = resolveExpression(element, bindings)
		// The callee as it is at runtime: `(nuaCms as any)(…)` is a `nuaCms` call like any other.
		const callee = call.type === 'CallExpression' ? withoutTypeWrappers(call.callee) : null
		if (call.type !== 'CallExpression' || callee?.type !== 'Identifier') continue
		const optionsPath = integrationImports.get(callee.name)
		if (!optionsPath) continue

		const firstArg = call.arguments[0]
		const options = firstArg && firstArg.type !== 'SpreadElement' ? resolveExpression(firstArg, bindings) : null
		const optionsObject = options?.type === 'ObjectExpression' ? options : null
		if (optionsPath.length === 0) {
			fromCms = optionsObject && objectAtPath(optionsObject, ['cmsConfig'], bindings)
		} else if (fromNua === undefined) {
			fromNua = nuaCmsInstance(optionsObject && objectPropertyValue(optionsObject, 'cms', bindings), bindings)
		}
	}
	return fromNua !== undefined ? fromNua : fromCms ?? null
}

/** `listStyles` of the `cmsConfig` object; empty when absent or not an array. */
function parseConfigListStyles(cmsConfig: ObjectExpression | null, bindings: Bindings): CmsListStyle[] {
	const listStylesNode = cmsConfig ? objectPropertyValue(cmsConfig, 'listStyles', bindings) : null
	return listStylesNode?.type === 'ArrayExpression' ? parseListStyles(listStylesNode, bindings) : []
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
function parseLocale(cmsConfig: ObjectExpression | null, configObject: ObjectExpression, bindings: Bindings): string | undefined {
	return staticStringOf(cmsConfig, 'locale', bindings) ?? staticStringOf(objectAtPath(configObject, ['i18n'], bindings), 'defaultLocale', bindings)
}

/**
 * Parse the project-level CMS config from an Astro config source string: `listStyles` and
 * the project's language (see {@link parseLocale}), from wherever the config hands the
 * integration its `cmsConfig` (see {@link effectiveCmsConfig}).
 */
export function parseProjectCmsConfigSource(source: string): CmsConfig {
	const ast = parseSource(source)
	if (!ast) return EMPTY_CONFIG

	const bindings = collectBindings(ast)
	const configObject = configObjectFromDefaultExport(ast, bindings)
	if (!configObject) return EMPTY_CONFIG

	const cmsConfig = effectiveCmsConfig(ast, configObject, bindings)
	const locale = parseLocale(cmsConfig, configObject, bindings)
	return { listStyles: parseConfigListStyles(cmsConfig, bindings), ...(locale ? { locale } : {}) }
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
