import { type CmsCommit, type CmsFileSystem, createCmsCore, parseProjectCmsConfig } from '@nuasite/cms-core'
import path from 'node:path'
import type { CollectionOverrides } from './collection-overrides'
import { ComponentRegistry } from './component-registry'
import { EditorService, invalidateCollectionRoutesCache } from './editor-service'
import { errorResponse, jsonResponse, preflightResponse } from './handlers/request-utils'
import type { NuaCmsOptions } from './index'
import { ManifestWriter } from './manifest-writer'
import { resolveMarkerConfig } from './marker-config'
import type { MediaStorageAdapter } from './media/types'
import { type AstroParse, createProjectContext, runInProjectContext } from './project/context'
import { reloadClientScript } from './reload-client'
import { scanCollections } from './scan-cache'
import type { CmsMarkerOptions, ComponentDefinition } from './types'

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
	/** Inject the editor into every page {@link EditorHost.processPage} returns. */
	editor?: {
		/** URL of the editor bundle (`cms-editor.js`). */
		src: string
		cmsConfig?: NuaCmsOptions['cmsConfig']
		/** WebSocket URL of the host's change notifications; adds the reload client. */
		reloadUrl?: string
	}
}

export interface EditorHost {
	/**
	 * Mark a rendered page for the editor and record its manifest. The HTML must carry the
	 * compiler's source annotations (`annotateSourceFile`). `revision` is what the reload client
	 * compares the host's notifications with.
	 */
	processPage(pagePath: string, html: string, options?: { revision?: string }): Promise<string>
	/**
	 * Answer `/_nua/cms/*`, `/cms-manifest.json` and `/<page>.json` of a processed page. Returns
	 * `undefined` for any other request, which the host serves itself.
	 */
	fetch(request: Request): Promise<Response | undefined>
	/**
	 * Report files changed by anything other than this host (an agent, a checkout): paths relative
	 * to the root or absolute under it. Without paths, everything cached is dropped.
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

	async function loadDefinitions(): Promise<void> {
		await runInProjectContext(context, async () => {
			await manifestWriter.loadAvailableColors(options.root)
			const definitions = config.markComponents ? await scanComponents(config.componentDirs) : {}
			manifestWriter.setComponentDefinitions(definitions)
			service.setComponentDefinitions(definitions)
			if (options.mdxComponentDirs) manifestWriter.setMdxComponents(mdxComponentNames(definitions, options.mdxComponentDirs))
			manifestWriter.setCollectionDefinitions(await scanCollections(config.contentDir, options.collections))
		})
	}

	let definitions: Promise<void> = loadDefinitions()
	let definitionsStale = false
	await definitions

	/** Definitions are rescanned lazily, once per batch of changes, before the next use. */
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
			const marked = await service.processPage(pagePath, html)
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
			const manifest = await service.pageManifest(match[1] === 'index' ? '/' : `/${match[1]}`)
			return manifest ? noStore(jsonResponse(manifest)) : undefined
		},

		invalidate(changedPaths) {
			runInProjectContext(context, () => {
				if (changedPaths === undefined) {
					context.state.clear()
					invalidateCollectionRoutesCache()
					definitionsStale = true
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
					if (affectsDefinitions(relative, config)) definitionsStale = true
				}
			})
		},
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
export { type ReloadClientOptions, reloadClientScript } from './reload-client'
