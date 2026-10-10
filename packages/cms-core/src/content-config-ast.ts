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
	/**
	 * Where the field renders (`n.text({ position: 'header' })`).
	 *
	 * `sidebar: true` above is the shorthand for `position: 'sidebar'` and stays because it is
	 * what existing configs are written with; `'header'` has no shorthand, and until this was
	 * parsed the top strip could only ever be asked for by a `@position` comment in an entry
	 * that already existed — so a collection with no entries yet could not have one at all.
	 */
	position?: 'sidebar' | 'header'
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

/**
 * A key of the config's `collections` export, whether or not the rest of its declaration
 * could be read. `ParsedConfig` only holds the collections with a readable schema or glob
 * pattern; this is every name, so a scan can tell a collection it could not locate from one
 * that does not exist.
 *
 * The loader facts are stricter than `ParsedCollection`'s: an option is only reported when
 * nothing next to it (a spread) could replace it, because a scan report vouches by them.
 */
export interface DeclaredCollection {
	name: string
	/** Literal `base` of a `glob()` loader; `.` when the options name none, which is the project root to Astro. */
	loaderBase?: string
	/** Literal `pattern` of a `glob()` loader. */
	loaderPattern?: string
	/** The patterns of a `glob()` loader that takes a list of them, when every one is a literal. */
	loaderPatterns?: string[]
	/** Literal path of a `file()` loader. */
	loaderFile?: string
	/** The declaration has a `loader`, whatever it is. */
	hasLoader?: true
	/** The declaration has no `loader` at all: its entries are the files of `<contentDir>/<name>`. */
	noLoader?: true
}

/** One read of a content config: what {@link parseContentConfig} returns, and what the config declares beyond it. */
export interface ContentConfigRead {
	parsed: ParsedConfig
	/** Every collection name the reader could make out. */
	declared: DeclaredCollection[]
	/**
	 * The reader could not see the whole `collections` export, so `declared` may be missing
	 * names: the export is not an object literal (a call, a re-export from another module),
	 * the literal has a spread, a method, a `__proto__` or a computed key in it, or the file
	 * mentions `collections` in a way that may add to it.
	 */
	partial: boolean
	/**
	 * The file exports `collections`, or may through `export *`. Astro takes no collections
	 * from a content config that does not, whatever the file declares without exporting it.
	 */
	exportsCollections: boolean
}

/** Cached parse result keyed by config path; invalidated by mtime. */
export type ParseCache = Map<string, { mtimeMs: number } & ContentConfigRead>

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

/** Where a project may keep its content config, in the order the parser prefers them. */
export const CONTENT_CONFIG_PATHS = ['src/content/config.ts', 'src/content.config.ts'] as const

/**
 * Where Astro also takes a content config from and this reader does not look. A project with
 * one of these has a config; it is only out of the reader's sight.
 */
export const UNREAD_CONTENT_CONFIG_PATHS = [
	'src/content.config.mjs',
	'src/content.config.js',
	'src/content.config.mts',
	'src/content/config.mjs',
	'src/content/config.js',
	'src/content/config.mts',
] as const

/**
 * Why `parseContentConfig` came back empty. Three different facts share that one return value, and
 * only two of them are a defect: a site with no content collections is a legitimate site.
 */
export type EmptyContentConfigReason = 'missing' | 'unparseable' | 'no-collections'

/**
 * Tell the three apart, for a caller that has to report the empty map rather than just handle it.
 *
 * A parse failure anywhere wins over an empty parse: a config that will not read is a problem to
 * name even when a second one beside it reads cleanly and declares nothing.
 */
export async function classifyEmptyContentConfig(fs: CmsFileSystem): Promise<EmptyContentConfigReason> {
	let found = false
	for (const configPath of CONTENT_CONFIG_PATHS) {
		try {
			await fs.stat(configPath)
		} catch {
			continue
		}
		found = true
		if (parseSource(await fs.readFile(configPath)) === null) {
			return 'unparseable'
		}
	}
	return found ? 'no-collections' : 'missing'
}

/**
 * Parse the project's Astro content config file (TypeScript) into a structured
 * representation of each collection's schema. Returns an empty map if no config
 * file exists or parsing fails. The mtime-keyed cache (via `fs.stat()`) skips
 * re-reading and re-parsing an unchanged config file.
 */
export async function parseContentConfig(fs: CmsFileSystem, cache: ParseCache): Promise<ParsedConfig> {
	return (await readContentConfig(fs, cache)).parsed
}

/**
 * {@link parseContentConfig}, plus every collection name the config declares — including the
 * ones the parsed map leaves out because neither a schema nor a glob pattern could be read.
 * Same file choice and the same cache.
 */
export async function readContentConfig(fs: CmsFileSystem, cache: ParseCache): Promise<ContentConfigRead> {
	// A config whose parsed map came back empty may still declare names, all of them unreadable
	// declarations, or export a `collections` the reader cannot see into. The first such read
	// is the answer when no config parses to anything.
	let unparsed: ContentConfigRead | undefined
	for (const configPath of CONTENT_CONFIG_PATHS) {
		let stat: Awaited<ReturnType<CmsFileSystem['stat']>>
		try {
			stat = await fs.stat(configPath)
		} catch {
			continue
		}

		let cached = cache.get(configPath)
		if (!cached || cached.mtimeMs !== stat.mtimeMs) {
			const content = await fs.readFile(configPath)
			cached = { mtimeMs: stat.mtimeMs, ...readConfigSource(content) }
			cache.set(configPath, cached)
		}
		if (cached.parsed.size > 0) return cached
		if (!unparsed && (cached.declared.length > 0 || cached.exportsCollections)) unparsed = cached
	}
	return unparsed ?? { parsed: new Map(), declared: [], partial: false, exportsCollections: false }
}

/** Exported for unit testing — operates on a source string directly. */
export function parseConfigSource(source: string, _sourcePath?: string): ParsedConfig {
	return readConfigSource(source).parsed
}

function readConfigSource(source: string): ContentConfigRead {
	const result: ParsedConfig = new Map()
	const ast = parseSource(source)
	if (!ast) return { parsed: result, declared: [], partial: false, exportsCollections: false }

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

		const fields = parseSchemaFields(schemaObject, bindings)
		// Once per parse of the config file, not once per entry: the parse result is cached by
		// mtime, so a bad declaration is reported when it is read, not on every scan that
		// consults it.
		checkDerivedFromDeclarations(collectionName, fields)

		result.set(collectionName, {
			name: collectionName,
			fields,
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

	return { parsed: result, ...readDeclaredCollections(ast) }
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
 * Every mention of the string option `name` in the code of a config file, comments aside: as
 * an identifier anywhere, and as a string where it is a key. One that is the key of a property
 * given a plain string is that string. Any other mention is `null`: another kind of value (a
 * call, a concatenation, a variable), a shorthand, a variable, a parameter or a member of
 * that name. A key given an object literal is left out: it is not a string option, so it is
 * another option of that name. `null` instead of a list for a file that does not parse.
 *
 * For telling whether an option is set to a known value wherever the file could set it,
 * without evaluating the file.
 */
export function configOptionMentions(source: string, name: string): Array<string | null> | null {
	const ast = parseSource(source)
	if (!ast) return null
	const mentions: Array<string | null> = []
	walkValues(ast.program, path => {
		const { node, key } = path.at(-1)!
		const parent = path.at(-2)?.node
		const isKey = parent?.type === 'ObjectProperty' && key === 'key'
		const asString = node.type === 'StringLiteral'
			? node.value
			: node.type === 'TemplateLiteral' && node.expressions.length === 0
			? node.quasis[0]?.value.cooked
			: undefined
		const computedMember = (parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') && key === 'property' && parent.computed
		const named = node.type === 'Identifier' ? node.name === name : asString === name && (isKey || computedMember)
		if (!named) return
		// `[name]: …` is keyed by a variable of that name, not by the name.
		if (!isKey || (node.type === 'Identifier' && parent.computed)) mentions.push(null)
		else if (parent.value.type !== 'ObjectExpression') mentions.push(extractStaticString(parent.value, new Map()) ?? null)
	})
	return mentions
}

/** The loaders' own calls. They read what they are handed and hand it on unchanged. */
const READER_CALLS = ['glob', 'file', 'defineCollection', 'defineCmsCollection']

/** Wrappers that change nothing about a value, the ones {@link resolveExpression} sees through. */
const VALUE_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion'])

/** TypeScript nodes that hold code and not only types; every other `TS…` node is skipped by {@link walkValues}. */
const TS_NODES_WITH_CODE = new Set([
	...VALUE_WRAPPERS,
	'TSInstantiationExpression',
	'TSEnumDeclaration',
	'TSEnumBody',
	'TSEnumMember',
	'TSModuleDeclaration',
	'TSModuleBlock',
	'TSExportAssignment',
	'TSImportEqualsDeclaration',
	'TSExternalModuleReference',
	'TSParameterProperty',
	'TSDeclareFunction',
	'TSDeclareMethod',
])

/** Keys of a node that hold no code. */
const NODE_METADATA = new Set(['loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments'])

/** A node and the key of its parent it sits under; a path is these from the program down. */
interface PathStep {
	node: t.Node
	key: string
}

/** Visit every node that can run, with the path that leads to it. Types are passed over: they cannot touch a value. */
function walkValues(node: t.Node, visit: (path: PathStep[]) => void, path: PathStep[] = [{ node, key: '' }]): void {
	visit(path)
	const children: [string, unknown][] = Object.entries(node)
	for (const [key, child] of children) {
		if (NODE_METADATA.has(key)) continue
		for (const item of Array.isArray(child) ? child : [child]) {
			if (!isAstNode(item) || (item.type.startsWith('TS') && !TS_NODES_WITH_CODE.has(item.type))) continue
			path.push({ node: item, key })
			walkValues(item, visit, path)
			path.pop()
		}
	}
}

/** Is the declarator at `path[index]` one of a module-level declaration? */
function isModuleLevelDeclarator(path: PathStep[], index: number): boolean {
	const holder = path[index - 2]?.node
	if (holder?.type === 'ExportNamedDeclaration') return path[index - 3]?.node.type === 'Program'
	return holder?.type === 'Program'
}

/** A value that cannot be changed in place, so a `const` holding it is what it was declared as, whatever is done with it. */
function isImmutableLiteral(node: t.Node): boolean {
	return node.type === 'StringLiteral' || node.type === 'TemplateLiteral' || node.type === 'NumericLiteral'
		|| node.type === 'BooleanLiteral' || node.type === 'NullLiteral' || node.type === 'BigIntLiteral'
}

/**
 * The module-level `const`s whose value is, by the time Astro reads the config, what the file
 * declares it as. Only these are followed; a name left out is unknown to the reader.
 *
 * A name is kept when every mention of it in the file is one of a short list of uses that can
 * neither change the value nor hand it to code that can:
 *
 * - its one declaration;
 * - the value of a property in an object literal the reader reads, a first argument of
 *   `glob`, `file`, `defineCollection` or `defineCmsCollection` where the reader reads that
 *   call, or the whole initializer of another `const` (an alias). "Where the reader reads" is
 *   the initializer of a `const` that is itself kept, so a name falls with the one that holds it;
 * - `X.key` where the declaration gives `key` a string, a number, a boolean or `null`, read
 *   into a declaration, a property, a call argument, an array, a template, or a binary,
 *   logical or conditional expression;
 * - `export { X }`, `export default X`, a type (`typeof X`), and `Object.keys(X)`.
 *
 * Any other mention drops the name: a call that takes it, a member written or called, an
 * array or a spread that holds it, a loop, a conditional, a function that mentions it, a
 * second declaration of the name anywhere (a parameter, a local). So does `eval` or
 * `Function` anywhere in the file, for every name. Listing what is harmless instead of what
 * is harmful means a use nobody thought of leaves a name unknown, not trusted.
 *
 * A `const` that holds a string, a number, a boolean or `null` is kept whatever mentions it:
 * neither the binding nor the value can change.
 *
 * `trusted` names which of the loaders' calls, and `Object`, are not declared in the file
 * itself; a local `glob` is not Astro's.
 */
function followedConstants(ast: t.File, bindings: Bindings): { followed: Bindings; trusted: Set<string> } {
	const dropped = new Set<string>()
	/** A name → the `const`s whose initializer it is read in: it is kept only while they are. */
	const heldBy = new Map<string, Set<string>>()
	/** A name → the calls it is handed to: it is kept only while they are what they are taken for. */
	const handedTo = new Map<string, Set<string>>()
	const untrusted = new Set<string>()
	let anythingMayChange = false

	const note = (map: Map<string, Set<string>>, name: string, values: Iterable<string>): void => {
		map.set(name, new Set([...map.get(name) ?? [], ...values]))
	}

	/** The primitive a `const`'s object literal gives `key`, if that is certain. */
	const holdsPrimitiveAt = (name: string, key: string): boolean => {
		const init = bindings.get(name)
		const object = init && resolveExpression(init, new Map())
		const member = object?.type === 'ObjectExpression' ? literalMember(object, key) : undefined
		return !!member && isImmutableLiteral(resolveExpression(member, new Map()))
	}

	/**
	 * The `const` whose initializer the expression at `path[index]` is read in, and the loaders'
	 * calls it passes through on the way: it is that initializer, a property value of an object
	 * literal that is, or a first argument of one of those calls that is. `null` anywhere else.
	 */
	const readIn = (path: PathStep[], index: number): { holder: string; calls: string[] } | null => {
		const calls: string[] = []
		for (let at = index;;) {
			const parent = path[at - 1]?.node
			const { node, key } = path[at]!
			if (!parent) return null
			if (VALUE_WRAPPERS.has(parent.type) && key === 'expression') {
				at--
			} else if (parent.type === 'ObjectProperty' && key === 'value' && path[at - 2]?.node.type === 'ObjectExpression') {
				at -= 2
			} else if (
				parent.type === 'CallExpression' && parent.arguments[0] === node && parent.callee.type === 'Identifier'
				&& READER_CALLS.includes(parent.callee.name)
			) {
				calls.push(parent.callee.name)
				at--
			} else {
				return parent.type === 'VariableDeclarator' && key === 'init' && parent.id.type === 'Identifier' && isModuleLevelDeclarator(path, at - 1)
					? { holder: parent.id.name, calls }
					: null
			}
		}
	}

	/** Is the expression at `path[index]` only read, into a place that keeps nothing but its value? */
	const isValueRead = (path: PathStep[], index: number): boolean => {
		let at = index
		while (VALUE_WRAPPERS.has(path[at - 1]?.node.type ?? '') && path[at]!.key === 'expression') at--
		const parent = path[at - 1]?.node
		const { key } = path[at]!
		switch (parent?.type) {
			case 'ObjectProperty':
				return key === 'value' && path[at - 2]?.node.type === 'ObjectExpression'
			case 'CallExpression':
			case 'OptionalCallExpression':
			case 'NewExpression':
				return key === 'arguments'
			case 'VariableDeclarator':
			case 'ArrayExpression':
			case 'TemplateLiteral':
			case 'BinaryExpression':
			case 'LogicalExpression':
			case 'ConditionalExpression':
				return true
			default:
				return false
		}
	}

	walkValues(ast.program, path => {
		const { node, key } = path.at(-1)!
		const parent = path.at(-2)?.node
		if (node.type !== 'Identifier' || !parent) return
		const { name } = node

		// Not a mention of the binding at all: the name of a property.
		const isMemberKey =
			(parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod' || parent.type === 'ClassProperty')
			&& key === 'key' && !parent.computed
		const isMemberName = (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed
		const isModuleName = (parent.type === 'ExportSpecifier' && key === 'exported') || (parent.type === 'ImportSpecifier' && key === 'imported')
		if (isMemberKey || isMemberName || isModuleName) return

		if (name === 'eval' || name === 'Function') anythingMayChange = true

		if (READER_CALLS.includes(name) || name === 'Object') {
			const imported = (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier')
				&& key === 'local'
			// `Object` only as the one a method is called on: `Object.keys = …` makes it another.
			const grandparent = path.at(-3)?.node
			const called = (parent.type === 'CallExpression' && key === 'callee')
				|| (name === 'Object' && parent.type === 'MemberExpression' && key === 'object' && !parent.computed
					&& grandparent?.type === 'CallExpression' && grandparent.callee === parent)
			if (!imported && !called) untrusted.add(name)
		}
		if (!bindings.has(name)) return

		// Its declaration. Any other declaration of the name is a mention like any other.
		if (parent.type === 'VariableDeclarator' && key === 'id' && isModuleLevelDeclarator(path, path.length - 2)) return
		if (parent.type === 'ExportDefaultDeclaration') return
		if (parent.type === 'ExportSpecifier' && key === 'local') return
		if (
			parent.type === 'CallExpression' && parent.arguments[0] === node && parent.callee.type === 'MemberExpression' && !parent.callee.computed
			&& parent.callee.object.type === 'Identifier' && parent.callee.object.name === 'Object'
			&& parent.callee.property.type === 'Identifier' && parent.callee.property.name === 'keys'
		) {
			note(handedTo, name, ['Object'])
			return
		}
		if (
			(parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'object' && !parent.computed
			&& parent.property.type === 'Identifier' && holdsPrimitiveAt(name, parent.property.name) && isValueRead(path, path.length - 2)
		) return

		const read = readIn(path, path.length - 1)
		if (read === null) {
			dropped.add(name)
			return
		}
		note(heldBy, name, [read.holder])
		note(handedTo, name, read.calls)
	})

	const trusted = new Set([...READER_CALLS, 'Object'].filter(name => !untrusted.has(name)))
	const keeps = (name: string): boolean => {
		const init = bindings.get(name)
		return init !== undefined && isImmutableLiteral(resolveExpression(init, new Map()))
	}
	const followed: Bindings = new Map()
	for (const [name, init] of bindings) {
		const handedOn = [...handedTo.get(name) ?? []].every(call => trusted.has(call))
		if (keeps(name) || (!anythingMayChange && !dropped.has(name) && handedOn)) followed.set(name, init)
	}
	// A name falls with the one whose initializer holds it.
	for (let fell = true; fell;) {
		fell = false
		for (const [name, holders] of heldBy) {
			if (!followed.has(name) || keeps(name) || [...holders].every(holder => followed.has(holder))) continue
			followed.delete(name)
			fell = true
		}
	}
	return { followed, trusted }
}

/**
 * Every collection name the file's `collections` export declares, and whether that is all of
 * them. Reads more forms than the parse above follows (`as`, `satisfies`, a same-file
 * variable, a numeric key): naming a collection commits to nothing, while parsing one gives
 * it a schema and a place in every scan.
 *
 * Identifiers are followed through the module-level `const`s {@link followedConstants} keeps.
 */
function readDeclaredCollections(ast: t.File): Pick<ContentConfigRead, 'declared' | 'partial' | 'exportsCollections'> {
	const bindings: Bindings = new Map()
	let collections: t.Node | undefined
	let exportsCollections = false
	// `collections` comes from where this reader does not look: another module, another local
	// name, a `let`, a destructuring…
	let outOfSight = false
	// …or would, unless this file declares it: `export * from`, `export { collections }` of an import.
	let exportedUndeclared = false
	for (const stmt of ast.program.body) {
		if (stmt.type === 'ExportAllDeclaration') {
			exportedUndeclared = true
			exportsCollections = true
			continue
		}
		if (stmt.type === 'ExportNamedDeclaration') {
			for (const specifier of stmt.specifiers) {
				const exported = specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value
				if (exported !== 'collections') continue
				exportsCollections = true
				if (stmt.source || specifier.type !== 'ExportSpecifier' || specifier.local.name !== 'collections') outOfSight = true
				else exportedUndeclared = true
			}
		}
		const varDecl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration'
			? stmt.declaration
			: stmt.type === 'VariableDeclaration'
			? stmt
			: null
		for (const decl of varDecl?.declarations ?? []) {
			if (stmt.type === 'ExportNamedDeclaration') {
				declaredPatternNames(decl.id, name => {
					if (name === 'collections') exportsCollections = true
				})
			}
			if (varDecl?.kind === 'const' && decl.id.type === 'Identifier' && decl.init) {
				bindings.set(decl.id.name, decl.init)
				if (decl.id.name === 'collections') collections = decl.init
				continue
			}
			declaredPatternNames(decl.id, name => {
				if (name === 'collections') outOfSight = true
			})
		}
	}

	if (!collections) return { declared: [], partial: outOfSight || exportedUndeclared, exportsCollections }

	const { followed, trusted } = followedConstants(ast, bindings)
	const object = resolveExpression(collections, followed)
	if (object.type !== 'ObjectExpression') return { declared: [], partial: true, exportsCollections }

	// What `collections` holds by the time Astro reads it may be more than the declaration says.
	let partial = outOfSight || !followed.has('collections') || !isPlainLiteralObject(object)
	// A name given twice holds what it was given last.
	const declared = new Map<string, DeclaredCollection>()
	for (const prop of object.properties) {
		// A spread, a method or a computed key that is not a string (`[name]: …` is not the name
		// it spells) hides a name.
		const name = staticKeyName(prop)
		if (prop.type !== 'ObjectProperty' || name === null) {
			partial = true
			continue
		}
		if (name === '__proto__') continue
		declared.set(name, { name, ...readDeclaredLoader(prop.value, followed, trusted) })
	}
	return { declared: [...declared.values()], partial, exportsCollections }
}

/**
 * The key an object member is stored under, or `null` when it cannot be told: a spread, or
 * a computed key that is not a string (`['loader']` is `loader`; `[key]` could be anything).
 * A numeric key is a name like any other.
 */
function staticKeyName(prop: t.ObjectExpression['properties'][number]): string | null {
	if (prop.type === 'SpreadElement') return null
	if (prop.computed) return prop.key.type === 'StringLiteral' ? prop.key.value : null
	return prop.key.type === 'NumericLiteral' ? String(prop.key.value) : propertyKeyName(prop.key)
}

/**
 * An object literal that holds what its own keys say and nothing else: no spread, no key that
 * cannot be read, and no `__proto__`, which gives it another object's properties to answer with.
 */
function isPlainLiteralObject(object: t.ObjectExpression): boolean {
	return object.properties.every(prop => {
		const key = staticKeyName(prop)
		return key !== null && key !== '__proto__'
	})
}

/**
 * What an object literal holds under `key`: the last member of that name, as a later one
 * replaces an earlier. `undefined` when it has none; `null` when it has one that is not a
 * plain value (a getter, a setter, a method).
 */
function literalMember(object: t.ObjectExpression, key: string): t.Node | null | undefined {
	const member = object.properties.findLast(prop => staticKeyName(prop) === key)
	if (member === undefined) return undefined
	return member.type === 'ObjectProperty' ? member.value : null
}

/** The loader facts of a {@link DeclaredCollection}, read off the value its `collections` key holds. */
function readDeclaredLoader(value: t.Node, bindings: Bindings, trusted: Set<string>): Omit<DeclaredCollection, 'name'> {
	const isCallOf = (node: t.Node, names: string[]): node is t.CallExpression & { callee: t.Identifier } =>
		node.type === 'CallExpression' && node.callee.type === 'Identifier' && names.includes(node.callee.name) && trusted.has(node.callee.name)

	const declaration = resolveExpression(value, bindings)
	if (!isCallOf(declaration, ['defineCollection', 'defineCmsCollection']) || !declaration.arguments[0]) return {}
	const options = resolveExpression(declaration.arguments[0], bindings)
	if (options.type !== 'ObjectExpression') return {}

	// The last `loader` is the one that counts. A spread or a key that cannot be read after it
	// may replace it, and a `__proto__` may supply one where the literal names none.
	const lastLoader = options.properties.findLastIndex(prop => staticKeyName(prop) === 'loader')
	const mayBeReplaced = options.properties.some((prop, index) => {
		const key = staticKeyName(prop)
		return key === '__proto__' || (key === null && index > lastLoader)
	})
	if (mayBeReplaced) return {}
	const loader = literalMember(options, 'loader')
	if (loader === undefined) return { noLoader: true }
	if (loader === null) return {}

	const facts: Omit<DeclaredCollection, 'name'> = { hasLoader: true }
	const call = resolveExpression(loader, bindings)
	if (!isCallOf(call, ['glob', 'file']) || !call.arguments[0]) return facts
	if (call.callee.name === 'file') {
		const file = extractStaticString(call.arguments[0], bindings)
		if (file !== undefined) facts.loaderFile = file
		return facts
	}

	const globOptions = resolveExpression(call.arguments[0], bindings)
	// A spread, a key that cannot be read or a `__proto__` may supply either option, so no literal next to one can be trusted.
	if (globOptions.type !== 'ObjectExpression' || !isPlainLiteralObject(globOptions)) return facts
	const base = literalMember(globOptions, 'base')
	const pattern = literalMember(globOptions, 'pattern')
	// Without a `base`, Astro's glob loads from the project root.
	if (base === undefined) facts.loaderBase = '.'
	else if (base !== null) {
		const literal = extractStaticString(base, bindings)
		if (literal !== undefined) facts.loaderBase = literal
	}
	if (!pattern) return facts
	const literal = extractStaticString(pattern, bindings)
	if (literal !== undefined) {
		facts.loaderPattern = literal
		return facts
	}
	// A list of patterns is a union with its `!` members taken out again.
	const list = resolveExpression(pattern, bindings)
	const patterns = list.type === 'ArrayExpression' ? list.elements.map(element => element ? extractStaticString(element, bindings) : undefined) : []
	if (patterns.length > 0 && patterns.every(one => one !== undefined)) facts.loaderPatterns = patterns
	return facts
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
			case 'position':
				if (value.type === 'StringLiteral' && (value.value === 'sidebar' || value.value === 'header')) layout.position = value.value
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

/**
 * Report the `derivedFrom` declarations the recompute cannot honour, and drop the ones that
 * would otherwise take effect halfway.
 *
 * Two kinds, both silent before:
 *
 * - **Unknown source.** `derivedFrom: 'catgory'` parses perfectly well, so the field is
 *   hidden (a declaration implies `hidden`) and then never computed, because no such key ever
 *   appears in the frontmatter. The result is a field that has quietly left the CMS. Warn
 *   rather than throw: a typo in one field must not take the whole config down, and the site
 *   still builds.
 * - **Nested field.** Deriving is a top-level operation — `applyDerivedFields` reads the
 *   entry's top-level frontmatter, which is the only place a source name is unambiguous.
 *   A `derivedFrom` inside `n.object({ … })` used to hide the sub-field anyway and then never
 *   compute it, so the key disappeared from the file on the next write. Rather than invent
 *   "source relative to the parent object" semantics, the declaration is dropped here: the
 *   nested field stays visible and hand-editable, and the warning says why.
 *
 * Emitted over `console.warn` for the same reason as `warnOnPathnameCollisions` in
 * `collection-scanner.ts`: `cms-core` cannot reach the ErrorCollector in `@nuasite/cms` and
 * must not grow a dependency on it.
 */
function checkDerivedFromDeclarations(collectionName: string, fields: ParsedField[]): void {
	const siblingNames = new Set(fields.map(f => f.name))
	for (const field of fields) {
		const source = field.layout?.derivedFrom
		if (source !== undefined && !siblingNames.has(source)) {
			console.warn(
				`[cms] collection "${collectionName}": field "${field.name}" derives from "${source}", which is not a field of this collection`
					+ ` — the field is hidden and nothing is ever computed for it`,
			)
		}
		dropNestedDerivedFrom(collectionName, field.name, field.fields)
	}
}

/** Strip `derivedFrom` from every field below the top level, warning once per declaration. */
function dropNestedDerivedFrom(collectionName: string, path: string, fields: ParsedField[] | undefined): void {
	if (!fields) return
	for (const field of fields) {
		const fieldPath = `${path}.${field.name}`
		const layout = field.layout
		if (layout?.derivedFrom !== undefined) {
			console.warn(
				`[cms] collection "${collectionName}": field "${fieldPath}" declares \`derivedFrom\` on a nested field, which is not supported`
					+ ` — only top-level fields derive, so the declaration is ignored and the field stays editable`,
			)
			delete layout.derivedFrom
			delete layout.derivedTransform
		}
		dropNestedDerivedFrom(collectionName, fieldPath, field.fields)
	}
}
