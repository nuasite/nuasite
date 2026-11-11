import { type CmsCore, type CmsFileSystem, resolvePathnameFromSpec, scanRouteCollections } from '@nuasite/cms-core'
import path from 'node:path'
import type { CollectionOverrides } from './collection-overrides.ts'
import { getProjectRoot } from './config.ts'
import { handleCmsApiRequest } from './handlers/api-routes.ts'
import { buildMapPattern, detectArrayPattern, extractArrayElementProps, parseInlineArrayName } from './handlers/array-ops.ts'
import {
	extractPropsFromSource,
	findComponentInvocationLine,
	findFrontmatterEnd,
	getPageFileCandidates,
	normalizeFilePath,
} from './handlers/component-ops.ts'
import { processHtml } from './html-processor.ts'
import type { ManifestWriter } from './manifest-writer.ts'
import type { MediaStorageAdapter } from './media/types.ts'
import { currentProjectContext, type ProjectContext, projectFiles, runInProjectContext } from './project/context.ts'
import { runYieldingToHost } from './project/host-yield.ts'
import type { CollectionRouteInfo } from './project/state.ts'
import {
	buildCollectionTextIndex,
	buildSourceIndexes,
	collectionsReadByPage,
	declaredSitePathFromData,
	enhanceManifestWithSourceSnippets,
	findCollectionSource,
	findSourceLocation,
	parseMarkdownContent,
	readableCollectionsHoldText,
	reindexDirtyFiles,
} from './source-finder/index.ts'
import { projectRelativeSource } from './source-finder/source-files.ts'
import type { PageSources } from './source-finder/types.ts'
import type {
	CmsMarkerOptions,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	ComponentInstance,
	ManifestEntry,
	PageSeoData,
} from './types.ts'
import { firstNonEmptyLine } from './utils.ts'

/**
 * The visual editor's server side, independent of how pages are served: it marks rendered HTML
 * and records each page's manifest, serves the manifests, and answers the editor's API. The Astro
 * dev server drives it through Vite middleware; another host calls it directly. Every call runs in
 * the service's project context.
 */
export interface EditorServiceOptions {
	context: ProjectContext
	config: Required<CmsMarkerOptions>
	manifestWriter: ManifestWriter
	componentDefinitions: Record<string, ComponentDefinition>
	/** The editor API (`/_nua/cms/*`). Left out when another server answers it (proxy mode). */
	api?: {
		core: CmsCore
		fs: CmsFileSystem
		contentDir: string
		mediaAdapter?: MediaStorageAdapter
		maxUploadSize: number
		collectionOverrides?: CollectionOverrides
	}
}

/** The body of `/<page>.json`. */
export interface PageManifestResponse {
	page: string
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	componentDefinitions: Record<string, ComponentDefinition>
	collection?: CollectionEntry
	seo?: PageSeoData
}

export class EditorService {
	private readonly context: ProjectContext
	private readonly config: Required<CmsMarkerOptions>
	private readonly manifestWriter: ManifestWriter
	private componentDefinitions: Record<string, ComponentDefinition>
	private readonly api: EditorServiceOptions['api']
	/** On-demand resolutions and searches in flight, by page, entry and kind, so repeated asks share one. */
	private readonly pendingEntrySearch = new Map<string, Promise<void>>()
	/** Entries a search found no source for; a new render of the page brings new entry objects. */
	private readonly unlocatable = new WeakSet<ManifestEntry>()

	constructor(options: EditorServiceOptions) {
		this.context = options.context
		this.config = options.config
		this.manifestWriter = options.manifestWriter
		this.componentDefinitions = options.componentDefinitions
		this.api = options.api
	}

	setComponentDefinitions(definitions: Record<string, ComponentDefinition>): void {
		this.componentDefinitions = definitions
	}

	/**
	 * Mark a rendered page and record its manifest. Every entry is recorded `pending`: its sources
	 * are resolved only when the editor asks for that entry (see {@link pageManifest}), so nothing
	 * is resolved that is not edited. With `waitUntil`, the indexes that resolution reads are built
	 * after the page is returned, held by it and giving the event loop a turn between chunks of
	 * files, so the editor's first ask finds them; without it, the first ask builds them.
	 */
	processPage(pagePath: string, html: string, waitUntil?: (work: Promise<unknown>) => void): Promise<string> {
		return runInProjectContext(this.context, async () => {
			const marked = await markHtml(html, pagePath, this.config, this.manifestWriter)
			await populateComponentProps(pagePath, marked.components)
			const entries = Object.fromEntries(Object.entries(marked.entries).map(([id, entry]) => [id, { ...entry, pending: true }]))
			this.manifestWriter.addPage(pagePath, entries, marked.components, marked.collection, marked.seo)
			if (waitUntil) {
				const indexes = runYieldingToHost(() => buildSourceIndexes(this.manifestWriter.getCollectionDefinitions()))
				waitUntil(indexes.catch(error => console.error('[cms] Building the source indexes failed:', error)))
			}
			return marked.html
		})
	}

	/**
	 * The manifest of a page {@link processPage} has seen, its entries `pending` until the editor asks for them.
	 * `resolveEntry` names a `pending` entry whose sources are resolved before the manifest is
	 * returned; the project's indexes are built on the first such ask. `locateEntry` also searches
	 * the whole project for the text of an entry the resolution left without a source.
	 */
	async pageManifest(pagePath: string, options: { resolveEntry?: string; locateEntry?: string } = {}): Promise<PageManifestResponse | undefined> {
		if (options.resolveEntry !== undefined) await this.onDemand(pagePath, options.resolveEntry, false)
		if (options.locateEntry !== undefined) await this.onDemand(pagePath, options.locateEntry, true)
		const pageData = this.manifestWriter.getPageManifest(pagePath)
		if (!pageData) return undefined
		const response: PageManifestResponse = {
			page: pagePath,
			entries: pageData.entries,
			components: pageData.components,
			componentDefinitions: this.componentDefinitions,
		}
		if (pageData.collection) response.collection = pageData.collection
		if (pageData.seo) response.seo = pageData.seo
		return response
	}

	private async onDemand(pagePath: string, entryId: string, searchProject: boolean): Promise<void> {
		const key = `${pagePath}\0${entryId}\0${searchProject}`
		let search = this.pendingEntrySearch.get(key)
		if (!search) {
			// Within the request that asks, so the passes over the project's files can give the host a turn.
			const started = runInProjectContext(this.context, () =>
				runYieldingToHost(async () => {
					await resolvePendingEntry(pagePath, entryId, this.manifestWriter)
					if (searchProject) await locateTextOnDemand(pagePath, entryId, this.manifestWriter, this.unlocatable)
				}))
			search = started
			this.pendingEntrySearch.set(key, started)
			const forget = () => {
				if (this.pendingEntrySearch.get(key) === started) this.pendingEntrySearch.delete(key)
			}
			started.then(forget, forget)
		}
		try {
			await search
		} catch (error) {
			console.error('[cms] On-demand source search failed:', error)
		}
	}

	/** The body of `/cms-manifest.json`: definitions, colors and every page the editor can link to. */
	globalManifest(): Promise<Record<string, unknown>> {
		return runInProjectContext(this.context, async () => {
			// Pages from the filesystem, then collection entry pages, then visited pages (with SEO titles).
			const pageMap = new Map<string, { pathname: string; title?: string }>()
			for (const pagePath of await discoverPagesFromFilesystem()) {
				pageMap.set(pagePath, { pathname: pagePath })
			}
			const { collectionDefinitions, entryPages } = buildCollectionManifestPages(
				this.manifestWriter.getCollectionDefinitions(),
				await discoverCollectionRoutes(),
			)
			for (const page of entryPages) {
				pageMap.set(page.pathname, page)
			}
			for (const [pagePath, data] of this.manifestWriter.getPageDataForPreviews()) {
				const existing = pageMap.get(pagePath)
				const title = data.seo?.title?.content || existing?.title
				pageMap.set(pagePath, { pathname: pagePath, ...(title ? { title } : {}) })
			}
			const pages = Array.from(pageMap.values()).sort((a, b) => a.pathname.localeCompare(b.pathname))

			const manifest: Record<string, unknown> = {
				componentDefinitions: this.componentDefinitions,
				availableColors: this.manifestWriter.getAvailableColors(),
				availableTextStyles: this.manifestWriter.getAvailableTextStyles(),
				pages,
			}
			if (Object.keys(collectionDefinitions).length > 0) manifest.collectionDefinitions = collectionDefinitions
			const mdxComponents = this.manifestWriter.getMdxComponents()
			if (mdxComponents) manifest.mdxComponents = mdxComponents
			return manifest
		})
	}

	/** Answer `/_nua/cms/<route>`; `undefined` when this service has no API. */
	handleApi(route: string, request: Request): Promise<Response> | undefined {
		const api = this.api
		if (!api) return undefined
		return runInProjectContext(
			this.context,
			() => handleCmsApiRequest(route, request, { ...api, manifestWriter: this.manifestWriter, projectRoot: this.context.root }),
		)
	}
}

/**
 * Phase 1 (fast): Mark HTML with CMS IDs and build basic manifest entries.
 * Returns quickly so the page can be sent to the browser without delay.
 * Source resolution and snippet enhancement are deferred to Phase 2.
 */
async function markHtml(
	html: string,
	pagePath: string,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
) {
	// Re-index only files that changed since last page load (tracked by Vite watcher).
	await reindexDirtyFiles()

	// In dev mode, reset counter per page for consistent IDs during HMR
	let pageCounter = 0
	const idGenerator = () => `cms-${pageCounter++}`

	// Check if this is a collection page
	const collectionInfo = await findCollectionSource(pagePath, config.contentDir, manifestWriter.getCollectionDefinitions())
	const isCollectionPage = !!collectionInfo

	let mdContent: Awaited<ReturnType<typeof parseMarkdownContent>> | undefined
	if (collectionInfo) {
		mdContent = await parseMarkdownContent(collectionInfo)
	}

	const bodyFirstLine = firstNonEmptyLine(mdContent?.body)

	const result = await processHtml(
		html,
		pagePath,
		{
			attributeName: config.attributeName,
			includeTags: config.includeTags,
			excludeTags: config.excludeTags,
			includeEmptyText: config.includeEmptyText,
			generateManifest: config.generateManifest,
			markComponents: config.markComponents,
			componentDirs: config.componentDirs,
			skipMarkdownContent: isCollectionPage,
			collectionInfo: collectionInfo
				? { name: collectionInfo.name, slug: collectionInfo.slug, bodyFirstLine, bodyText: mdContent?.body, contentPath: collectionInfo.file }
				: undefined,
			seo: config.seo,
			pageFiles: getPageFileCandidates(pagePath),
			collectionDefinitions: manifestWriter.getCollectionDefinitions(),
		},
		idGenerator,
	)

	// Build collection entry if this is a collection page
	let collectionEntry: CollectionEntry | undefined
	if (collectionInfo && mdContent) {
		collectionEntry = {
			collectionName: mdContent.collectionName,
			collectionSlug: mdContent.collectionSlug,
			sourcePath: mdContent.file,
			frontmatter: mdContent.frontmatter,
			body: mdContent.body,
			bodyStartLine: mdContent.bodyStartLine,
			wrapperId: result.collectionWrapperId,
		}
	}

	return {
		html: result.html,
		entries: result.entries,
		components: result.components,
		collection: collectionEntry,
		seo: result.seo,
		collectionDefinitions: result.collectionDefinitions,
	}
}

/** Fill each component's props from where the page's sources invoke it. Reads only the files the page is rendered from. */
async function populateComponentProps(pagePath: string, components: Record<string, ComponentInstance>): Promise<void> {
	const projectRoot = getProjectRoot()
	const fileCache = new Map<string, string[] | null>()
	const readLines = async (filePath: string): Promise<string[] | null> => {
		if (fileCache.has(filePath)) return fileCache.get(filePath)!
		try {
			const content = await projectFiles().readFile(filePath)
			const lines = content.split('\n')
			fileCache.set(filePath, lines)
			return lines
		} catch {
			fileCache.set(filePath, null)
			return null
		}
	}

	for (const comp of Object.values(components)) {
		if (comp.componentName.startsWith('__array:')) continue

		let found = false

		if (comp.invocationSourcePath) {
			const filePath = normalizeFilePath(comp.invocationSourcePath)
			const lines = await readLines(path.resolve(projectRoot, filePath))
			if (lines) {
				const invLine = findComponentInvocationLine(lines, comp.componentName, comp.invocationIndex ?? 0)
				if (invLine >= 0) {
					comp.props = extractPropsFromSource(lines, invLine, comp.componentName)
					found = true
				}
			}
		}

		if (!found) {
			for (const candidate of getPageFileCandidates(pagePath)) {
				const lines = await readLines(path.resolve(projectRoot, candidate))
				if (lines) {
					const invLine = findComponentInvocationLine(lines, comp.componentName, comp.invocationIndex ?? 0)
					if (invLine >= 0) {
						comp.props = extractPropsFromSource(lines, invLine, comp.componentName)
						break
					}
				}
			}
		}
	}

	// Resolve spread props for array-rendered components
	const componentGroups = new Map<string, typeof components[string][]>()
	for (const comp of Object.values(components)) {
		const key = `${comp.componentName}::${comp.invocationSourcePath ?? ''}`
		if (!componentGroups.has(key)) componentGroups.set(key, [])
		componentGroups.get(key)!.push(comp)
	}

	for (const group of componentGroups.values()) {
		if (group.length < 1) continue
		if (!group.some(c => Object.keys(c.props).length === 0)) continue

		const firstComp = group[0]!
		const filePath = normalizeFilePath(firstComp.invocationSourcePath ?? firstComp.sourcePath)
		const lines = await readLines(path.resolve(projectRoot, filePath))
		if (!lines) continue

		const fmEnd = findFrontmatterEnd(lines)

		let pattern: ReturnType<typeof detectArrayPattern>
		const parsed = parseInlineArrayName(firstComp.componentName)
		if (parsed) {
			const { arrayVarName, mapOccurrence } = parsed
			const mapRegex = new RegExp(buildMapPattern(arrayVarName))
			let mapLine = -1
			let seen = 0
			for (let i = fmEnd; i < lines.length; i++) {
				if (mapRegex.test(lines[i]!)) {
					if (seen === mapOccurrence) {
						mapLine = i
						break
					}
					seen++
				}
			}
			if (mapLine < 0) continue
			pattern = { arrayVarName, mapLineIndex: mapLine }
		} else {
			const invLine = findComponentInvocationLine(lines, firstComp.componentName, 0)
			if (invLine < 0) continue
			pattern = detectArrayPattern(lines, invLine)
		}
		if (!pattern) continue
		if (fmEnd === 0) continue

		const frontmatterContent = lines.slice(1, fmEnd - 1).join('\n')

		const sorted = [...group].sort((a, b) => (a.invocationIndex ?? 0) - (b.invocationIndex ?? 0))
		for (let i = 0; i < sorted.length; i++) {
			const comp = sorted[i]!
			if (Object.keys(comp.props).length > 0) continue

			const arrayProps = extractArrayElementProps(frontmatterContent, pattern.arrayVarName, i)
			if (arrayProps) {
				comp.props = arrayProps
			}
		}
	}
}

/** Resolve the sources of every entry of a page at once, and fill its components' props. */
export async function enhanceManifestInBackground(
	pagePath: string,
	entries: Record<string, ManifestEntry>,
	components: Record<string, ComponentInstance>,
	collection: CollectionEntry | undefined,
	seo: PageSeoData | undefined,
	collectionDefinitions: Record<string, CollectionDefinition> | undefined,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
): Promise<void> {
	try {
		await populateComponentProps(pagePath, components)
		const pageFiles = getPageFileCandidates(pagePath)
		const page = pageSources(pageFiles, components)
		const enhanced = await enhanceManifestWithSourceSnippets(entries, collectionDefinitions, pageFiles, page)

		// Text the snippet pass left without a source is searched for only when the editor asks
		// (locateTextOnDemand): that search walks every source file, which a page with many such
		// entries cannot pay on each load.
		manifestWriter.addPage(pagePath, enhanced, components, collection, seo)
	} catch (error) {
		console.error('[cms] Background enhancement failed:', error)
	}
}

/**
 * Resolve the sources of one `pending` entry of a page, as {@link enhanceManifestInBackground} does
 * for all of them, and record it in the page's manifest. A page re-rendered meanwhile keeps its new manifest.
 */
async function resolvePendingEntry(pagePath: string, entryId: string, manifestWriter: ManifestWriter): Promise<void> {
	const pageData = manifestWriter.getPageManifest(pagePath)
	const entry = pageData?.entries[entryId]
	if (!pageData || !entry?.pending) return

	const pageFiles = getPageFileCandidates(pagePath)
	const page = pageSources(pageFiles, pageData.components)
	const enhanced = await enhanceManifestWithSourceSnippets(
		pageData.entries,
		manifestWriter.getCollectionDefinitions(),
		pageFiles,
		page,
		new Set([entryId]),
	)
	const resolved = enhanced[entryId]

	const current = manifestWriter.getPageManifest(pagePath)
	if (!resolved || !current || current.entries[entryId] !== entry) return
	const { pending: _pending, ...settled } = resolved
	manifestWriter.addPage(pagePath, { ...current.entries, [entryId]: settled }, current.components, current.collection, current.seo)
}

/**
 * Search the whole project for the source of one text entry the page load left without one, and
 * record what is found in the page's manifest. A page re-rendered meanwhile keeps its new manifest.
 */
async function locateTextOnDemand(
	pagePath: string,
	entryId: string,
	manifestWriter: ManifestWriter,
	unlocatable: WeakSet<ManifestEntry>,
): Promise<void> {
	const pageData = manifestWriter.getPageManifest(pagePath)
	const entry = pageData?.entries[entryId]
	if (!pageData || !entry || entry.pending || unlocatable.has(entry) || entry.sourcePath || entry.imageMetadata?.src || !entry.text || !entry.tag) {
		return
	}

	const pageFiles = getPageFileCandidates(pagePath)
	const { renderedFiles } = pageSources(pageFiles, pageData.components)
	const collections = manifestWriter.getCollectionDefinitions()
	// A page render drops the collection text index until its phase 2 rebuilds it.
	await buildCollectionTextIndex(collections)
	const readable = await collectionsReadByPage(pageData.entries, [...pageFiles, ...renderedFiles], collections)
	// Collection content phase 2 could not pin to one entry: equal text in a template is not its source.
	const location = readableCollectionsHoldText(entry.text, readable)
		? undefined
		: await findSourceLocation(entry.text, entry.tag, pageFiles, renderedFiles)

	// Another entry's search may have rewritten the page manifest meanwhile; a new render replaces the entry.
	const current = manifestWriter.getPageManifest(pagePath)
	if (!current || current.entries[entryId] !== entry) return
	if (!location) {
		unlocatable.add(entry)
		return
	}
	const located: ManifestEntry = { ...entry, sourcePath: location.file, sourceLine: location.line, sourceSnippet: location.snippet }
	if (location.variableName) located.variableName = location.variableName
	manifestWriter.addPage(pagePath, { ...current.entries, [entryId]: located }, current.components, current.collection, current.seo)
}

/** The files `components` say the page is rendered from: each component's own file and the file invoking it. */
function pageSources(pageFiles: readonly string[], components: Record<string, ComponentInstance>): PageSources {
	const rendered = new Set(pageFiles)
	for (const component of Object.values(components)) {
		rendered.add(projectRelativeSource(component.sourcePath))
		if (component.invocationSourcePath) rendered.add(projectRelativeSource(component.invocationSourcePath))
	}
	return { renderedFiles: [...rendered], components }
}

/** Page file extensions recognized by Astro */
const PAGE_EXTENSIONS = new Set(['.astro', '.md', '.mdx'])

/**
 * Scan src/pages directory to discover all static page routes.
 * Skips dynamic routes (files with [ in the name) and API routes (.ts/.js).
 */
async function discoverPagesFromFilesystem(): Promise<string[]> {
	const projectRoot = getProjectRoot()
	const pagesDir = path.join(projectRoot, 'src', 'pages')

	try {
		await projectFiles().access(pagesDir)
	} catch {
		return []
	}

	const pages: string[] = []

	async function walk(dir: string, urlPrefix: string) {
		const entries = await projectFiles().readdir(dir)
		for (const entry of entries) {
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue

			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				// Skip directories with dynamic segments
				if (entry.name.includes('[')) continue
				await walk(fullPath, `${urlPrefix}${entry.name}/`)
			} else {
				const ext = path.extname(entry.name)
				if (!PAGE_EXTENSIONS.has(ext)) continue
				// Skip dynamic routes
				if (entry.name.includes('[')) continue

				const baseName = path.basename(entry.name, ext)
				const pagePath = baseName === 'index'
					? urlPrefix.replace(/\/$/, '') || '/'
					: `${urlPrefix}${baseName}`
				pages.push(pagePath)
			}
		}
	}

	await walk(pagesDir, '/')
	return pages
}

/** Invalidate the cached collection routes (called when route files change) */
export function invalidateCollectionRoutesCache() {
	currentProjectContext().state.collectionRoutes = null
}

/**
 * Discover which collections are rendered as pages by scanning src/pages for
 * dynamic route files (e.g. [slug].astro) that call getCollection(). Returns a
 * map from collection name to its route info (see {@link CollectionRouteInfo}).
 * Recurses into dynamic directories too (e.g. `[topic]/[slug].astro`) so those
 * collections are still recognized as routed, just without a static prefix.
 * Result is cached after first call.
 */
export async function discoverCollectionRoutes(): Promise<Map<string, CollectionRouteInfo>> {
	const state = currentProjectContext().state
	if (state.collectionRoutes) return state.collectionRoutes

	const projectRoot = getProjectRoot()
	const pagesDir = path.join(projectRoot, 'src', 'pages')
	const routes = new Map<string, CollectionRouteInfo>()

	try {
		await projectFiles().access(pagesDir)
	} catch {
		state.collectionRoutes = routes
		return routes
	}

	async function walk(dir: string, urlPrefix: string, dynamicAncestor: boolean) {
		const entries = await projectFiles().readdir(dir)
		for (const entry of entries) {
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue

			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				await walk(fullPath, `${urlPrefix}${entry.name}/`, dynamicAncestor || entry.name.includes('['))
			} else {
				const ext = path.extname(entry.name)
				if (!PAGE_EXTENSIONS.has(ext)) continue
				// Only interested in dynamic route files
				if (!entry.name.includes('[')) continue

				try {
					const content = await projectFiles().readFile(fullPath)
					const { staticPaths, all } = scanRouteCollections(content)
					const names = staticPaths.length > 0 ? staticPaths : all.slice(0, 1)
					for (const name of names) {
						// A static prefix is only usable when no ancestor directory is
						// itself dynamic — otherwise record "routed, no prefix" so the
						// caller still trusts declared URLs without fabricating one.
						routes.set(name, dynamicAncestor ? true : urlPrefix)
					}
				} catch { /* skip unreadable files */ }
			}
		}
	}

	await walk(pagesDir, '/', false)
	state.collectionRoutes = routes
	return routes
}

/** One page of the dev manifest's `pages` list, as contributed by a collection entry. */
interface EntryPage {
	pathname: string
	title?: string
}

/**
 * Project the scanned collection definitions for the dev manifest response: resolve each
 * entry's page URL, and report which pages those entries contribute to the manifest's
 * `pages` list. Pathnames are pre-populated so the collections browser can redirect to a
 * detail page without visiting it first. The entry's own declared URL
 * (urlPath/permalink/…) is preferred over the discovered static route prefix, because it
 * is correct even when the collection is served under a *dynamic* prefix (e.g.
 * `[topic]/[slug]`) that `discoverCollectionRoutes` can't map to a static one.
 *
 * Definitions are copied rather than mutated so heuristic pathnames don't persist if the
 * route file is later removed.
 */
export function buildCollectionManifestPages(
	collectionDefs: Record<string, CollectionDefinition>,
	collectionRoutes: Map<string, CollectionRouteInfo>,
): { collectionDefinitions: Record<string, CollectionDefinition>; entryPages: EntryPage[] } {
	const collectionDefinitions: Record<string, CollectionDefinition> = {}
	const entryPages: EntryPage[] = []

	for (const [name, def] of Object.entries(collectionDefs)) {
		const routeInfo = collectionRoutes.get(def.name)
		const routePrefix = typeof routeInfo === 'string' ? routeInfo : undefined
		// Whether any page route renders this collection. The heuristic fallbacks below (a
		// frontmatter-declared site path, or the discovered route prefix) only apply to
		// routed collections — otherwise a declared `cms.pathname` spec whose fields are
		// missing for an entry would fabricate a URL from an unrelated frontmatter field
		// (e.g. a data collection's own `url`).
		const routed = routeInfo !== undefined

		// A `fragment` collection is rendered inside other pages and has no page of its own,
		// so every source below would fabricate a URL that 404s — including `entry.pathname`,
		// which `addPage()` set to whichever page happened to render the fragment. It gets
		// `previewOf` instead, which is a preview target and not a URL of its own.
		// Otherwise: a declarative `cms.pathname` rule is the highest-priority source — it wins
		// over the rendered-route pathname. resolvePathnameFromSpec is the same resolver
		// manifest-writer uses at build, so dev-preview and the built manifest agree.
		const resolvePathname = (entry: CollectionEntryInfo): string | undefined =>
			def.fragment
				? undefined
				: resolvePathnameFromSpec(def, entry.data)
					?? entry.pathname
					?? (routed ? declaredSitePathFromData(entry.data) : undefined)
					?? (routePrefix ? `${routePrefix}${entry.slug}` : undefined)

		// Only patch entries whose resolved pathname/preview target differs from what they
		// already have, so unchanged definitions keep their identity.
		const previewPathname = def.fragment ? def.previewOf : undefined
		const patchedEntries = def.entries?.map(e => {
			const pathname = resolvePathname(e)
			if (pathname === e.pathname && previewPathname === e.previewPathname) return e
			const { pathname: _oldPathname, previewPathname: _oldPreview, ...rest } = e
			const patched: CollectionEntryInfo = { ...rest }
			if (pathname) patched.pathname = pathname
			if (previewPathname) patched.previewPathname = previewPathname
			return patched
		})
		const changed = patchedEntries?.some((e, i) => e !== def.entries![i]) ?? false
		const projected = changed ? { ...def, entries: patchedEntries! } : def
		collectionDefinitions[name] = projected

		// A fragment collection contributes no pages: its `previewOf` page belongs to
		// whatever really renders it, and an entry must never shadow that page in the
		// manifest. Entries of a fragment collection have no pathname anyway — the `continue`
		// keeps that a property of the collection rather than of the resolver.
		if (projected.fragment) continue
		for (const entry of projected.entries ?? []) {
			if (entry.pathname) {
				entryPages.push({ pathname: entry.pathname, title: entry.title })
			}
		}
	}

	return { collectionDefinitions, entryPages }
}
