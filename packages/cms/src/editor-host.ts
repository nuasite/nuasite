import { type CmsCommit, type CmsFileSystem, createCmsCore, parseProjectCmsConfig } from '@nuasite/cms-core'
import path from 'node:path'
import { applyCollectionOverrides, type CollectionOverrides } from './collection-overrides.ts'
import { ComponentRegistry } from './component-registry.ts'
import { EditorService, invalidateCollectionRoutesCache } from './editor-service.ts'
import { errorResponse, jsonResponse, preflightResponse } from './handlers/request-utils.ts'
import type { NuaCmsOptions } from './index.ts'
import { ManifestWriter } from './manifest-writer.ts'
import { resolveMarkerConfig } from './marker-config.ts'
import type { MediaStorageAdapter } from './media/types.ts'
import { type AstroParse, createProjectContext, runInProjectContext } from './project/context.ts'
import type { CompileAstro } from './project/source-guard.ts'
import { reloadClientScript } from './reload-client.ts'
import { scanCollectionsWithoutOverrides } from './scan-cache.ts'
import { parseTailwindConfig, parseTextStyles } from './tailwind-colors.ts'
import type { AvailableColors, AvailableTextStyles, CmsMarkerOptions, CollectionDefinition, ComponentDefinition } from './types.ts'

const DEFAULT_MAX_UPLOAD_SIZE = 20 * 1024 * 1024
const API_PREFIX = '/_nua/cms/'

export interface EditorHostOptions extends CmsMarkerOptions {
	/**
	 * Absolute path of the project root, spelled the way the rendered HTML's
	 * `data-astro-source-file` attributes spell source files (or any absolute path, when they
	 * are root-relative). Manifests carry source paths relative to it.
	 */
	root: string
	/** The project's files, rooted at `root`. Every read and write of the editor goes through it. */
	fs: CmsFileSystem
	/** `parse` of an initialized `@astrojs/compiler`. */
	parseAstro: AstroParse
	/**
	 * One component compiled by the same compiler: `transform(source, { filename, sourcemap: 'external' })`,
	 * returning its `code` and `map`. A write that would leave a `.astro`, `.ts` or `.tsx` file the site's
	 * build cannot parse is refused with it.
	 */
	compileAstro: CompileAstro
	/**
	 * Applies the changes of each editor write; see `CmsCommit`. A host whose files can change by
	 * other means passes one, and a write based on files that changed meanwhile is then refused
	 * with `409` (for a batch save, per file). Without it, writes go to `fs` directly.
	 */
	commit?: CmsCommit
	/** Where uploads go. Without it, the media routes answer `501`. */
	media?: MediaStorageAdapter
	/** Directories whose components the MDX component picker offers. */
	mdxComponentDirs?: string[]
	/** Per-collection overrides, as in the Astro config. */
	collections?: CollectionOverrides
	/** @default 20 MB */
	maxUploadSize?: number
	/**
	 * Keeps the definitions across starts. Without it, every start scans the project: it parses every
	 * component and reads every collection entry. After an {@link EditorHost.invalidate}, the first use
	 * scans only the part of the definitions the changed files can affect, unless the store has them all.
	 */
	definitions?: EditorDefinitionsStore
	/** Inject the editor into every page {@link EditorHost.processPage} returns. */
	editor?: {
		/** URL of the editor bundle (`cms-editor.js`). */
		src: string
		cmsConfig?: NuaCmsOptions['cmsConfig']
		/** WebSocket URL of the host's change notifications; adds the reload client. */
		reloadUrl?: string
	}
}

/** What the editor host scans the project for before it serves anything. Plain data, safe to serialize as JSON. */
export interface EditorDefinitions {
	components: Record<string, ComponentDefinition>
	/** As the content scan found them, before the `collections` overrides. */
	collections: Record<string, CollectionDefinition>
	colors: AvailableColors
	textStyles: AvailableTextStyles
}

/**
 * The host's store of {@link EditorDefinitions}. The definitions depend on the files `fs` serves,
 * on the host's build and on the options `componentDirs`, `contentDir` and `markComponents`; a host
 * keys what it saves by all of them, e.g. by its revision of the files and its build.
 */
export interface EditorDefinitionsStore {
	/**
	 * Look up the definitions for the files `fs` serves now. A miss returns the `save` for the key it
	 * looked up, which receives the scan of those files. The scan reads `fs` after `load()` returns, so
	 * `fs` serves that revision for the whole scan, or the host calls `invalidate` before `fs` serves
	 * changed files; otherwise a scan of newer files can be saved under the older key.
	 */
	load(): Promise<EditorDefinitionsLookup>
}

/**
 * A hit returns the saved definitions, as a fresh copy each time: the editor host keeps and changes
 * them. A miss returns `save`, which the editor host calls without waiting; an error it throws or
 * rejects with is logged with `console.error`. A scan that an `invalidate` superseded while it ran is
 * not saved, nor is a scan of some parts that ran beside a load of another part.
 */
export type EditorDefinitionsLookup = { definitions: EditorDefinitions } | { save(definitions: EditorDefinitions): Promise<void> | void }

export interface EditorHost {
	/**
	 * Mark a rendered page for the editor and record its manifest. The HTML must carry the
	 * compiler's source annotations (`annotateSourceFile`). `revision` is what the reload client
	 * compares the host's notifications with.
	 *
	 * The page's source locations are resolved after the HTML is returned, over every collection
	 * entry of a large project. A host passes `waitUntil` to keep that work alive past its response
	 * (in a Worker, `work => ctx.waitUntil(work)`); with it, the work also gives the event loop a turn
	 * every few dozen files, so a host sharing its thread with other work is not held by it.
	 * `waitUntil` must keep the work alive until it completes: the project's indexes are built once
	 * and shared, and a build cut off halfway leaves later pages waiting for it.
	 *
	 * With `sourcesOnDemand`, nothing runs past the response and `waitUntil` is not used: the page's
	 * `.json` manifest, or the next API request, resolves the sources and waits for them. For a host
	 * whose thread that work would hold before the page's response is sent. An API request reads page
	 * manifests, so it resolves every page left so far and waits for the resolutions other requests
	 * started. Its cost grows with the pages processed since the previous API request, less those
	 * whose manifest was read. A request that resolves gives the event loop the same turns, so the
	 * host keeps what {@link fetch} returns alive until it settles (in a Worker,
	 * `ctx.waitUntil(host.fetch(request))`), for the same reason.
	 */
	processPage(
		pagePath: string,
		html: string,
		options?: { revision?: string; waitUntil?: (work: Promise<unknown>) => void; sourcesOnDemand?: boolean },
	): Promise<string>
	/**
	 * Answer `/_nua/cms/*`, `/cms-manifest.json` and `/<page>.json` of a processed page. Returns
	 * `undefined` for any other request, which the host serves itself.
	 */
	fetch(request: Request): Promise<Response | undefined>
	/**
	 * Report files changed by anything other than this host (an agent, a checkout): paths relative
	 * to the root or absolute under it. Without paths, everything cached is dropped, and the
	 * definitions are loaded again before the next use: from `definitions` when it has them for the
	 * files now, scanned otherwise. With paths, only the part of the definitions they can affect is
	 * scanned again: the components for a file under `componentDirs`, the collections for one under
	 * `contentDir`, under a directory a served collection loads from or in the content config, the
	 * colors and text styles for a `.css` file, all of them for the Astro config.
	 */
	invalidate(changedPaths?: readonly string[]): void
}

/**
 * The visual editor's server for a host other than the Astro dev server: it works on the HTML
 * the host rendered and on the files of `fs`, keeps all of its state in this instance, and
 * answers over `Request` → `Response`.
 */
export async function createEditorHost(options: EditorHostOptions): Promise<EditorHost> {
	const config = resolveMarkerConfig(options)
	const context = createProjectContext({
		root: options.root,
		fs: options.fs,
		parseAstro: options.parseAstro,
		compileAstro: options.compileAstro,
		commit: options.commit,
	})
	const manifestWriter = new ManifestWriter(config.manifestFile)
	const service = new EditorService({
		context,
		config,
		manifestWriter,
		componentDefinitions: {},
		api: {
			core: createCmsCore(options.fs, {
				contentDir: config.contentDir,
				media: options.media,
				componentDirs: config.componentDirs,
				commit: options.commit,
			}),
			fs: options.fs,
			contentDir: config.contentDir,
			mediaAdapter: options.media,
			maxUploadSize: options.maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE,
			collectionOverrides: options.collections,
		},
	})

	/** Bumped by each `invalidate` that can change the definitions; a load started before it is superseded. */
	let definitionsGeneration = 0
	/** Per part, the generation of the load whose definitions are served. */
	const appliedGeneration: Record<DefinitionsPart, number> = { components: -1, collections: -1, styles: -1 }
	/** The parts an `invalidate` made stale since the last load started. */
	const staleParts = new Set<DefinitionsPart>()
	/** Per part, how many loads of it run. */
	const loadsInFlight = new Map<DefinitionsPart, number>()
	/**
	 * Copies of the served parts as loaded, before the host changes them in place. Kept only with a
	 * store: a load of some parts saves them whole, with these for the rest. Dropped by a write of
	 * the editor's API, which `invalidate` is not told about, so a later load scans every part again.
	 */
	let kept: Partial<EditorDefinitions> = {}
	/** Bumped when a write of the editor's API starts and when it ends; a load that saw it change keeps nothing. */
	let apiWrites = 0
	function dropKept(): void {
		apiWrites++
		kept = {}
	}
	/** Root-relative directories (or files) of the served collections, some of them outside `contentDir`. */
	let collectionPaths: string[] = []

	async function loadDefinitions(parts: ReadonlySet<DefinitionsPart>): Promise<void> {
		const generation = definitionsGeneration
		const writesAtStart = apiWrites
		// Only a load that no load of another part ran beside saves: the parts it did not load are then those it was started with.
		const othersSettled = DEFINITIONS_PARTS.every(part => parts.has(part) || !loadsInFlight.get(part))
		for (const part of parts) loadsInFlight.set(part, (loadsInFlight.get(part) ?? 0) + 1)
		let found: FoundDefinitions
		try {
			found = await runInProjectContext(context, () => findDefinitions(options.definitions, options.root, config, parts))
		} catch (error) {
			// Not kept: the next use loads again the parts no newer load has served.
			for (const part of parts) if (generation >= appliedGeneration[part]) staleParts.add(part)
			throw error
		} finally {
			for (const part of parts) loadsInFlight.set(part, (loadsInFlight.get(part) ?? 1) - 1)
		}
		// A superseded load still answers its callers, without waiting for the files to settle, and the
		// next use loads again. Each of its parts is served only when no newer load has served it, and it is never saved.
		const served = (found.whole ? DEFINITIONS_PARTS : [...parts]).filter(part => generation >= appliedGeneration[part])
		for (const part of served) appliedGeneration[part] = generation
		const { definitions } = found
		if (options.definitions && apiWrites === writesAtStart) {
			// A copy: the editor host changes its definitions in place (overrides, entry pathnames).
			Object.assign(kept, structuredClone(pick(definitions, served)))
			const whole = wholeDefinitions(kept)
			if (found.save && whole && othersSettled && generation === definitionsGeneration) saveDefinitions(found.save, structuredClone(whole))
		}
		if (served.includes('styles') && definitions.colors && definitions.textStyles) {
			manifestWriter.setAvailableColors(definitions.colors)
			manifestWriter.setAvailableTextStyles(definitions.textStyles)
		}
		if (served.includes('components') && definitions.components) {
			manifestWriter.setComponentDefinitions(definitions.components)
			service.setComponentDefinitions(definitions.components)
			if (options.mdxComponentDirs) manifestWriter.setMdxComponents(mdxComponentNames(definitions.components, options.mdxComponentDirs))
		}
		if (served.includes('collections') && definitions.collections) {
			manifestWriter.setCollectionDefinitions(applyCollectionOverrides(definitions.collections, options.collections))
			collectionPaths = Object.values(definitions.collections).map(collection => collection.path.split(path.sep).join('/'))
		}
	}

	function markDefinitionsStale(parts: readonly DefinitionsPart[]): void {
		if (parts.length === 0) return
		for (const part of parts) staleParts.add(part)
		definitionsGeneration++
	}

	/** Per part, its latest load: a use waits for these. */
	const latestLoads = new Map<DefinitionsPart, Promise<void>>()

	function startLoad(parts: ReadonlySet<DefinitionsPart>): Promise<void> {
		const load = loadDefinitions(parts)
		for (const part of parts) latestLoads.set(part, load)
		return load
	}

	await startLoad(new Set(DEFINITIONS_PARTS))

	/** Stale parts are loaded again lazily, once per batch of changes, before the next use. */
	function currentDefinitions(): Promise<void> {
		if (staleParts.size > 0) {
			const parts = new Set(staleParts)
			// With a store, a part not kept is scanned too, so that what is saved is whole and current.
			if (options.definitions) {
				for (const part of DEFINITIONS_PARTS) if (!isKept(kept, part)) parts.add(part)
			}
			staleParts.clear()
			startLoad(parts)
		}
		return Promise.all(new Set(latestLoads.values())).then(() => undefined)
	}

	const injection = options.editor ? editorInjection(options.editor, options) : undefined

	return {
		async processPage(pagePath, html, pageOptions) {
			await currentDefinitions()
			const marked = await service.processPage(pagePath, html, { waitUntil: pageOptions?.waitUntil, sourcesOnDemand: pageOptions?.sourcesOnDemand })
			if (!injection) return marked
			return injectIntoHead(marked, await injection(pageOptions?.revision))
		},

		async fetch(request) {
			const url = new URL(request.url)
			if (url.pathname.startsWith(API_PREFIX)) {
				if (request.method === 'OPTIONS') return preflightResponse(request)
				await currentDefinitions()
				const writes = request.method !== 'GET' && request.method !== 'HEAD'
				if (writes) dropKept()
				try {
					const response = await service.handleApi(url.pathname.slice(API_PREFIX.length), request)
					return response ?? errorResponse('Not found', 404)
				} finally {
					if (writes) dropKept()
				}
			}
			if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
			if (url.pathname === '/cms-manifest.json') {
				await currentDefinitions()
				return noStore(jsonResponse(await service.globalManifest()))
			}
			const match = url.pathname.match(/^\/(.*)\.json$/)
			if (!match) return undefined
			const manifest = await service.pageManifest(match[1] === 'index' ? '/' : `/${match[1]}`, {
				locateEntry: url.searchParams.get('locate') ?? undefined,
			})
			return manifest ? noStore(jsonResponse(manifest)) : undefined
		},

		invalidate(changedPaths) {
			runInProjectContext(context, () => {
				if (changedPaths === undefined) {
					context.state.clear()
					invalidateCollectionRoutesCache()
					markDefinitionsStale(DEFINITIONS_PARTS)
					return
				}
				for (const changed of changedPaths) {
					const absolute = path.resolve(options.root, changed.startsWith(options.root) ? changed : changed.replace(/^\/+/, ''))
					const relative = path.relative(options.root, absolute).split(path.sep).join('/')
					context.state.markFileDirty(absolute)
					if (relative.startsWith('src/pages/') && relative.includes('[')) {
						invalidateCollectionRoutesCache()
						manifestWriter.clearCollectionPathnames()
					}
					markDefinitionsStale(definitionsAffectedBy(relative, config, collectionPaths))
				}
			})
		},
	}
}

type EditorDefinitionsSave = (definitions: EditorDefinitions) => Promise<void> | void

/** The parts of the definitions a change can make stale, each scanned on its own: `styles` are the colors and text styles. */
type DefinitionsPart = 'components' | 'collections' | 'styles'

const DEFINITIONS_PARTS: readonly DefinitionsPart[] = ['components', 'collections', 'styles']

/** The definitions of the parts a load asked for, or all of them when `whole` (a store hit). */
interface FoundDefinitions {
	definitions: Partial<EditorDefinitions>
	whole: boolean
	save?: EditorDefinitionsSave
}

/** The saved definitions, or a scan of `parts` and the `save` of the key the store looked up. */
async function findDefinitions(
	store: EditorDefinitionsStore | undefined,
	root: string,
	config: Required<CmsMarkerOptions>,
	parts: ReadonlySet<DefinitionsPart>,
): Promise<FoundDefinitions> {
	const lookup = await store?.load()
	if (lookup && 'definitions' in lookup) return { definitions: lookup.definitions, whole: true }
	return { definitions: await scanDefinitions(root, config, parts), whole: false, save: lookup?.save }
}

function saveDefinitions(save: EditorDefinitionsSave, definitions: EditorDefinitions): void {
	Promise.resolve()
		.then(() => save(definitions))
		.catch((error: unknown) => {
			console.error('[cms] Saving the editor definitions failed:', error)
		})
}

async function scanDefinitions(
	root: string,
	config: Required<CmsMarkerOptions>,
	parts: ReadonlySet<DefinitionsPart>,
): Promise<Partial<EditorDefinitions>> {
	const scanned: Partial<EditorDefinitions> = {}
	if (parts.has('styles')) {
		scanned.colors = await parseTailwindConfig(root)
		scanned.textStyles = await parseTextStyles(root)
	}
	if (parts.has('components')) scanned.components = config.markComponents ? await scanComponents(config.componentDirs) : {}
	if (parts.has('collections')) scanned.collections = await scanCollectionsWithoutOverrides(config.contentDir)
	return scanned
}

/** The keys of `definitions` that belong to `parts`. */
function pick(definitions: Partial<EditorDefinitions>, parts: readonly DefinitionsPart[]): Partial<EditorDefinitions> {
	const picked: Partial<EditorDefinitions> = {}
	if (parts.includes('styles')) {
		picked.colors = definitions.colors
		picked.textStyles = definitions.textStyles
	}
	if (parts.includes('components')) picked.components = definitions.components
	if (parts.includes('collections')) picked.collections = definitions.collections
	return picked
}

function isKept(kept: Partial<EditorDefinitions>, part: DefinitionsPart): boolean {
	if (part === 'styles') return kept.colors !== undefined && kept.textStyles !== undefined
	return kept[part] !== undefined
}

/** The definitions, once every part of them is there. */
function wholeDefinitions(definitions: Partial<EditorDefinitions>): EditorDefinitions | undefined {
	const { components, collections, colors, textStyles } = definitions
	if (!components || !collections || !colors || !textStyles) return undefined
	return { components, collections, colors, textStyles }
}

async function scanComponents(componentDirs: string[]): Promise<Record<string, ComponentDefinition>> {
	const registry = new ComponentRegistry(componentDirs)
	await registry.scan()
	return registry.getComponents()
}

function mdxComponentNames(definitions: Record<string, ComponentDefinition>, mdxComponentDirs: string[]): string[] {
	const dirs = mdxComponentDirs.map(dir => dir.endsWith('/') ? dir : `${dir}/`)
	return Object.values(definitions).filter(def => dirs.some(dir => def.file.startsWith(dir))).map(def => def.name)
}

/** The parts of the definitions a change of `relative` can alter; `collectionPaths` are where the served collections load from. */
function definitionsAffectedBy(relative: string, config: Required<CmsMarkerOptions>, collectionPaths: readonly string[]): DefinitionsPart[] {
	if (/^astro\.config\.[cm]?[jt]s$/.test(relative)) return [...DEFINITIONS_PARTS]
	const under = (dir: string) => {
		const trimmed = dir.replace(/\/$/, '')
		return relative === trimmed || relative.startsWith(`${trimmed}/`)
	}
	const parts: DefinitionsPart[] = []
	if (config.componentDirs.some(under)) parts.push('components')
	if (under(config.contentDir) || collectionPaths.some(under) || /^src\/content\.config\.[cm]?[jt]s$/.test(relative)) parts.push('collections')
	if (relative.endsWith('.css')) parts.push('styles')
	return parts
}

function noStore(response: Response): Response {
	response.headers.set('Cache-Control', 'no-store')
	return response
}

/** `JSON.stringify` that is safe inside an inline `<script>`. */
function scriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c')
}

function editorInjection(
	editor: NonNullable<EditorHostOptions['editor']>,
	options: EditorHostOptions,
): (revision: string | undefined) => Promise<string> {
	// The locale comes from the config source, as for the dev server and the sidecar.
	const locale = parseProjectCmsConfig(options.fs).then(config => config.locale)
	return async revision => {
		const cmsConfig = {
			...(editor.cmsConfig ?? {}),
			...(editor.cmsConfig?.apiBase ? {} : { apiBase: '/_nua/cms' }),
			maxUploadSize: options.maxUploadSize ?? DEFAULT_MAX_UPLOAD_SIZE,
			locale: await locale,
		}
		const scripts = [
			`<script>window.NuaCmsConfig = ${scriptJson(cmsConfig)};</script>`,
			`<script type="module" src="${escapeAttribute(editor.src)}" data-nuasite-cms></script>`,
		]
		if (editor.reloadUrl) scripts.push(`<script>${reloadClientScript({ url: editor.reloadUrl, revision })}</script>`)
		return scripts.join('\n')
	}
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function injectIntoHead(html: string, snippet: string): string {
	const headEnd = html.search(/<\/head>/i)
	if (headEnd >= 0) return `${html.slice(0, headEnd)}${snippet}\n${html.slice(headEnd)}`
	const bodyStart = html.search(/<body[^>]*>/i)
	if (bodyStart >= 0) {
		const afterBody = html.indexOf('>', bodyStart) + 1
		return `${html.slice(0, afterBody)}${snippet}\n${html.slice(afterBody)}`
	}
	return `${snippet}\n${html}`
}
export { type ReloadClientOptions, reloadClientScript } from './reload-client.ts'
