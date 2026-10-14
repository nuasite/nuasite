import { type CmsCore, type CmsFileSystem, resolvePathnameFromSpec, scanRouteCollections } from '@nuasite/cms-core'
import path from 'node:path'
import type { CollectionOverrides } from './collection-overrides'
import { getProjectRoot } from './config'
import { handleCmsApiRequest } from './handlers/api-routes'
import { buildMapPattern, detectArrayPattern, extractArrayElementProps, parseInlineArrayName } from './handlers/array-ops'
import {
	extractPropsFromSource,
	findComponentInvocationLine,
	findFrontmatterEnd,
	getPageFileCandidates,
	normalizeFilePath,
} from './handlers/component-ops'
import { processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import type { MediaStorageAdapter } from './media/types'
import { currentProjectContext, type ProjectContext, projectFiles, runInProjectContext } from './project/context'
import type { CollectionRouteInfo } from './project/state'
import {
	declaredSitePathFromData,
	enhanceManifestWithSourceSnippets,
	findCollectionSource,
	findImageSourceLocation,
	findSourceLocation,
	parseMarkdownContent,
	reindexDirtyFiles,
} from './source-finder'
import { projectRelativeSource } from './source-finder/source-files'
import type { PageSources } from './source-finder/types'
import type {
	CmsMarkerOptions,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	ComponentInstance,
	ManifestEntry,
	PageSeoData,
} from './types'
import { firstNonEmptyLine } from './utils'

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
	/**
	 * Source resolution still running per page. A manifest request waits for it, so the editor
	 * never receives entries without `sourcePath`, which it would treat as locked.
	 */
	private readonly pendingPhase2 = new Map<string, Promise<void>>()

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
	 * Mark a rendered page and record its manifest. Returns the marked HTML as soon as the
	 * elements are marked; their source locations are resolved after that, and
	 * {@link pageManifest} waits for them.
	 */
	processPage(pagePath: string, html: string): Promise<string> {
		return runInProjectContext(this.context, async () => {
			const marked = await markHtml(html, pagePath, this.config, this.manifestWriter)
			this.manifestWriter.addPage(pagePath, marked.entries, marked.components, marked.collection, marked.seo)
			const phase2 = enhanceManifestInBackground(
				pagePath,
				marked.entries,
				marked.components,
				marked.collection,
				marked.seo,
				marked.collectionDefinitions,
				this.config,
				this.manifestWriter,
			)
			this.pendingPhase2.set(pagePath, phase2)
			phase2.finally(() => {
				if (this.pendingPhase2.get(pagePath) === phase2) this.pendingPhase2.delete(pagePath)
			})
			return marked.html
		})
	}

	/** The manifest of a page {@link processPage} has seen, once its sources are resolved. */
	async pageManifest(pagePath: string): Promise<PageManifestResponse | undefined> {
		const inFlight = this.pendingPhase2.get(pagePath)
		if (inFlight) {
			try {
				await inFlight
			} catch {
				// Serve whatever partial manifest there is.
			}
		}
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

/**
 * Phase 2 (background): Resolve source locations, enhance snippets, populate
 * component props, and update the manifest. Runs after the HTML response is sent.
 */
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
		// Populate component props from source invocations
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

		const pageFiles = getPageFileCandidates(pagePath)
		const page = pageSources(pageFiles, components)
		const enhanced = await enhanceManifestWithSourceSnippets(entries, collectionDefinitions, pageFiles, page)

		// Fallback for entries without sourcePath — search index can still find them
		for (const entry of Object.values(enhanced)) {
			if (entry.sourceSnippet || entry.sourcePath) continue
			if (entry.imageMetadata?.src) {
				const preferredLocation = entry.sourcePath || entry.imageMetadata.srcOccurrence !== undefined
					? {
						file: entry.sourcePath,
						line: entry.sourceLine,
						srcOccurrence: entry.imageMetadata.srcOccurrence,
					}
					: undefined
				const loc = await findImageSourceLocation(
					entry.imageMetadata.src,
					entry.imageMetadata.srcSet,
					pageFiles,
					preferredLocation,
				)
				if (loc) {
					entry.sourcePath = loc.file
					entry.sourceLine = loc.line
					entry.sourceSnippet = loc.snippet
				}
			} else if (entry.text && entry.tag) {
				const loc = await findSourceLocation(entry.text, entry.tag, pageFiles, page.renderedFiles)
				if (loc) {
					entry.sourcePath = loc.file
					entry.sourceLine = loc.line
					entry.sourceSnippet = loc.snippet
					if (loc.variableName) entry.variableName = loc.variableName
				}
			}
		}

		// Update the manifest with fully-resolved entries and component props
		manifestWriter.addPage(pagePath, enhanced, components, collection, seo)
	} catch (error) {
		console.error('[cms] Background enhancement failed:', error)
	}
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
