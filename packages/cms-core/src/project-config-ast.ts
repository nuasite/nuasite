import { parse } from '@babel/parser'
import type { ArrayExpression, File, Node, ObjectExpression } from '@babel/types'
import type { CmsConfig, CmsListStyle } from '@nuasite/cms-types'
import path from 'node:path'
import { normalizeBasePath } from './base-path.ts'
import { configOptionMentions, findLoadedContentConfig } from './content-config-ast.ts'
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

/** Where Astro looks for its config, in its order (`astro/dist/core/config/config.js`): it takes the first there is. */
const ASTRO_CONFIG_FILES = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts']

/** The code of the Astro config file Astro uses, or `null` when the project has none. */
async function readAstroConfigSource(fs: CmsFileSystem): Promise<string | null> {
	for (const file of ASTRO_CONFIG_FILES) {
		try {
			return await fs.readFile(file)
		} catch {
			continue
		}
	}
	return null
}

/** Read and parse the consuming project's Astro config, tolerating absence or malformed config. */
export async function parseProjectCmsConfig(fs: CmsFileSystem): Promise<CmsConfig> {
	const source = await readAstroConfigSource(fs)
	return source === null ? EMPTY_CONFIG : parseProjectCmsConfigSource(source)
}

/**
 * The project's source directory, root-relative: `src` by default, or `null` when where Astro loads content from
 * cannot be told.
 *
 * Read off the code of the one config file Astro uses. Two of its options decide the place:
 * `srcDir`, where the content config and the content directory are, and `root`, which every
 * loader's `base` is resolved against. Which mention of either name is Astro's option cannot
 * be told without evaluating the file (it may name another plugin's option, a variable, a
 * member), so every one of them has to be a property given a plain string: all `srcDir`s the
 * same directory inside the project, every `root` the project root itself, which the scan
 * takes it to be. Either name given an object literal is not Astro's option, which is a string.
 */
export async function readAstroSrcDir(fs: CmsFileSystem): Promise<string | null> {
	const source = await readAstroConfigSource(fs)
	if (source === null) return 'src'
	const roots = configOptionMentions(source, 'root')
	const srcDirs = configOptionMentions(source, 'srcDir')
	if (roots === null || srcDirs === null) return null
	if (roots.some(root => root === null || normalizeBasePath(root) !== '.')) return null
	if (srcDirs.length === 0) return 'src'
	const [srcDir, ...others] = srcDirs.map(literal => (literal === null ? null : normalizeBasePath(literal)))
	if (srcDir === null || srcDir === undefined || others.some(other => other !== srcDir)) return null
	return path.isAbsolute(srcDir) || srcDir.startsWith('..') ? null : srcDir
}

/**
 * The source directory a content check judges: a custom `srcDir` only when a content config is there. The mention
 * {@link readAstroSrcDir} took for it may be another option of that name, and then `src` is where the config is. Where
 * the directory cannot be told, `src` as well.
 */
export async function contentSrcDir(fs: CmsFileSystem): Promise<string> {
	const srcDir = await readAstroSrcDir(fs)
	if (srcDir === null || srcDir === 'src') return 'src'
	return (await findLoadedContentConfig(fs, srcDir)) === null ? 'src' : srcDir
}

/**
 * Whether the Astro config turns on `legacy.collectionsBackwardsCompat`, without which Astro 7 fails the build on a
 * content config at the legacy `src/content/config.*`. `null` when that cannot be read off the code.
 *
 * Off unless the config says so, as in Astro. `defineConfig` of `@nuasite/nua/config` turns it on, and a `legacy` key
 * of the config's own replaces that default whole (`{ ...defaults, ...config }`), so only the key's own value counts
 * once it is there.
 */
export function parseLegacyCollectionsOptInSource(source: string): boolean | null {
	const ast = parseSource(source)
	if (!ast) return null
	const bindings = collectBindings(ast)
	const configObject = configObjectFromDefaultExport(ast, bindings)
	if (!configObject) return null
	const hasSpread = (object: ObjectExpression): boolean => object.properties.some(property => property.type === 'SpreadElement')

	const legacy = objectPropertyValue(configObject, 'legacy', bindings)
	if (legacy === null) {
		if (hasSpread(configObject)) return null
		const wrapper = defaultExportWrapper(ast, bindings)
		return wrapper === 'unknown' ? null : wrapper === 'nua'
	}
	if (legacy.type !== 'ObjectExpression') return null
	const optIn = objectPropertyValue(legacy, 'collectionsBackwardsCompat', bindings)
	if (optIn === null) return hasSpread(legacy) ? null : false
	return optIn.type === 'BooleanLiteral' ? optIn.value : null
}

/** {@link parseLegacyCollectionsOptInSource} of the Astro config Astro uses. Without one Astro runs on its defaults: off. */
export async function readLegacyCollectionsOptIn(fs: CmsFileSystem): Promise<boolean | null> {
	const source = await readAstroConfigSource(fs)
	return source === null ? false : parseLegacyCollectionsOptInSource(source)
}
