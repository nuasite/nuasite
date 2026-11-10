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
	 * Keeps the definitions across starts. Without it, every start (and the first use after an
	 * {@link EditorHost.invalidate} that can change them) scans the project: it parses every
	 * component and reads every collection entry.
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
 * not saved.
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
	 */
	processPage(pagePath: string, html: string, options?: { revision?: string; waitUntil?: (work: Promise<unknown>) => void }): Promise<string>
	/**
	 * Answer `/_nua/cms/*`, `/cms-manifest.json` and `/<page>.json` of a processed page. Returns
	 * `undefined` for any other request, which the host serves itself.
	 */
	fetch(request: Request): Promise<Response | undefined>
	/**
	 * Report files changed by anything other than this host (an agent, a checkout): paths relative
	 * to the root or absolute under it. Without paths, everything cached is dropped, and the
	 * definitions are loaded again before the next use: from `definitions` when it has them for the
	 * files now, scanned otherwise.
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
	const context = createProjectContext({ root: options.root, fs: options.fs, parseAstro: options.parseAstro, commit: options.commit })
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
	/** The generation of the load whose definitions are served. */
	let appliedGeneration = -1
	let definitionsStale = false

	async function loadDefinitions(): Promise<void> {
		const generation = definitionsGeneration
		let found: { definitions: EditorDefinitions; save?: EditorDefinitionsSave }
		try {
			found = await runInProjectContext(context, () => findDefinitions(options.definitions, options.root, config))
		} catch (error) {
			// Not kept: the next use loads again (a superseded load's invalidate already asked for that).
			if (generation === definitionsGeneration) definitionsStale = true
			throw error
		}
		// A superseded load still answers its callers, without waiting for the files to settle, and the
		// next use loads again. It is served only when no newer load has been, and never saved.
		if (generation < appliedGeneration) return
		appliedGeneration = generation
		const { definitions, save } = found
		// A copy: the editor host changes its definitions in place (overrides, entry pathnames).
		if (save && generation === definitionsGeneration) saveDefinitions(save, structuredClone(definitions))
		manifestWriter.setAvailableColors(definitions.colors)
		manifestWriter.setAvailableTextStyles(definitions.textStyles)
		manifestWriter.setComponentDefinitions(definitions.components)
		service.setComponentDefinitions(definitions.components)
		if (options.mdxComponentDirs) manifestWriter.setMdxComponents(mdxComponentNames(definitions.components, options.mdxComponentDirs))
		manifestWriter.setCollectionDefinitions(applyCollectionOverrides(definitions.collections, options.collections))
	}

	function markDefinitionsStale(): void {
		definitionsStale = true
		definitionsGeneration++
	}

	let definitions: Promise<void> = loadDefinitions()
	await definitions

	/** Definitions are loaded again lazily, once per batch of changes, before the next use. */
	function currentDefinitions(): Promise<void> {
		if (definitionsStale) {
			definitionsStale = false
			definitions = loadDefinitions()
		}
		return definitions
	}

	const injection = options.editor ? editorInjection(options.editor, options) : undefined

	return {
		async processPage(pagePath, html, pageOptions) {
			await currentDefinitions()
			const marked = await service.processPage(pagePath, html, pageOptions?.waitUntil)
			if (!injection) return marked
			return injectIntoHead(marked, await injection(pageOptions?.revision))
		},

		async fetch(request) {
			const url = new URL(request.url)
			if (url.pathname.startsWith(API_PREFIX)) {
				if (request.method === 'OPTIONS') return preflightResponse(request)
				await currentDefinitions()
				const response = await service.handleApi(url.pathname.slice(API_PREFIX.length), request)
				return response ?? errorResponse('Not found', 404)
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
					markDefinitionsStale()
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
					if (affectsDefinitions(relative, config)) markDefinitionsStale()
				}
			})
		},
	}
}

type EditorDefinitionsSave = (definitions: EditorDefinitions) => Promise<void> | void

/** The saved definitions, or a scan and the `save` of the key the store looked up. */
async function findDefinitions(
	store: EditorDefinitionsStore | undefined,
	root: string,
	config: Required<CmsMarkerOptions>,
): Promise<{ definitions: EditorDefinitions; save?: EditorDefinitionsSave }> {
	const lookup = await store?.load()
	if (lookup && 'definitions' in lookup) return { definitions: lookup.definitions }
	return { definitions: await scanDefinitions(root, config), save: lookup?.save }
}

function saveDefinitions(save: EditorDefinitionsSave, definitions: EditorDefinitions): void {
	Promise.resolve()
		.then(() => save(definitions))
		.catch((error: unknown) => {
			console.error('[cms] Saving the editor definitions failed:', error)
		})
}

async function scanDefinitions(root: string, config: Required<CmsMarkerOptions>): Promise<EditorDefinitions> {
	return {
		colors: await parseTailwindConfig(root),
		textStyles: await parseTextStyles(root),
		components: config.markComponents ? await scanComponents(config.componentDirs) : {},
		collections: await scanCollectionsWithoutOverrides(config.contentDir),
	}
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

/** Whether a change can alter component, collection or color definitions. */
function affectsDefinitions(relative: string, config: Required<CmsMarkerOptions>): boolean {
	const under = (dir: string) => relative.startsWith(`${dir.replace(/\/$/, '')}/`)
	return config.componentDirs.some(under)
		|| under(config.contentDir)
		|| /^src\/content\.config\.[cm]?[jt]s$/.test(relative)
		|| relative.endsWith('.css')
		|| /^astro\.config\.[cm]?[jt]s$/.test(relative)
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
