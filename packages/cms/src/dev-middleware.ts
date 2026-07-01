import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { getProjectRoot } from './config'
import { handleCmsApiRoute } from './handlers/api-routes'
import { buildMapPattern, detectArrayPattern, extractArrayElementProps, parseInlineArrayName } from './handlers/array-ops'
import {
	extractPropsFromSource,
	findComponentInvocationLine,
	findFrontmatterEnd,
	getPageFileCandidates,
	normalizeFilePath,
} from './handlers/component-ops'
import { handleCors, sendError } from './handlers/request-utils'
import { processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import type { MediaStorageAdapter } from './media/types'
import {
	declaredSitePathFromData,
	enhanceManifestWithSourceSnippets,
	findCollectionSource,
	findImageSourceLocation,
	findSourceLocation,
	parseMarkdownContent,
	reindexDirtyFiles,
} from './source-finder'
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
import { firstNonEmptyLine, normalizePagePath } from './utils'

/** Minimal ViteDevServer interface to avoid version conflicts between Astro's bundled Vite and root Vite */
interface ViteDevServerLike {
	middlewares: {
		use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
	}
	transformIndexHtml: (url: string, html: string) => Promise<string>
	watcher?: {
		on: (event: string, listener: (...args: any[]) => void) => any
		removeListener: (event: string, listener: (...args: any[]) => void) => any
		emit: (event: string, ...args: any[]) => boolean
	}
}

/**
 * Set of absolute file paths that the CMS expects to be deleted.
 * When Vite/Astro detects an unlink for one of these files, the CMS
 * intercepts the event and prevents a full page reload.
 */
export const expectedDeletions = new Set<string>()

export interface DevMiddlewareOptions {
	enableCmsApi?: boolean
	mediaAdapter?: MediaStorageAdapter
	/**
	 * Predicate that returns true for request URLs which should bypass CMS rewriting
	 * (typically vendor HTML under Astro's publicDir whose inline scripts can be
	 * corrupted by injected markers).
	 */
	isPublicStaticFile?: (urlPath: string) => boolean
	/** Maximum upload size in bytes for /_nua/cms/media/upload. */
	maxUploadSize: number
}

export function createDevMiddleware(
	server: ViteDevServerLike,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	componentDefinitions: Record<string, ComponentDefinition>,
	idCounter: { value: number },
	options: DevMiddlewareOptions,
) {
	const isPublicStaticFile = options.isPublicStaticFile ?? (() => false)

	// Tracks in-flight Phase 2 enhancement promises per page so that requests for the
	// page manifest can await source-path resolution before responding. Without this,
	// hosts that serve HTML faster than the source-finder pipeline completes (e.g.
	// pletivo, sandbox runtimes) leak a partial manifest where entries have tag/text
	// but no sourcePath, which the editor then treats as locked elements.
	const pendingPhase2: Map<string, Promise<void>> = new Map()

	// Serve uploaded media files directly from disk.
	// Vite's public dir middleware caches file listings, so newly uploaded files
	// may not be available immediately. This middleware bypasses that cache.
	if (options.mediaAdapter?.staticFiles) {
		const { urlPrefix, dir } = options.mediaAdapter.staticFiles
		const prefix = urlPrefix.endsWith('/') ? urlPrefix : `${urlPrefix}/`

		server.middlewares.use((req, res, next) => {
			const pathname = (req.url || '').split('?')[0] || ''
			if (!pathname.startsWith(prefix)) {
				next()
				return
			}

			const filename = path.basename(pathname)
			if (!filename || filename.includes('..')) {
				next()
				return
			}

			const filePath = path.join(dir, filename)
			fs.readFile(filePath)
				.then((data) => {
					const ext = path.extname(filename).toLowerCase()
					res.setHeader('Content-Type', mediaMimeFromExt(ext))
					res.setHeader('Cache-Control', 'no-store')
					res.end(data)
				})
				.catch(() => next())
		})
	}

	// CMS API endpoints (local dev server backend)
	if (options.enableCmsApi) {
		// One cms-core instance per project root. Structural routes (entry/page/redirect
		// CRUD, media) delegate to this brain over a node:fs adapter; the media adapter
		// and component dirs mirror the selection @nuasite/cms makes for the dev server.
		const cmsFs = createNodeFs(getProjectRoot())
		const core = createCmsCore(cmsFs, {
			contentDir: config.contentDir,
			media: options.mediaAdapter,
			componentDirs: config.componentDirs,
		})

		server.middlewares.use((req, res, next) => {
			const url = req.url || ''
			if (!url.startsWith('/_nua/cms/')) {
				next()
				return
			}

			if (handleCors(req, res)) return

			const route = url.replace('/_nua/cms/', '').split('?')[0]!

			handleCmsApiRoute({
				req,
				res,
				route,
				manifestWriter,
				core,
				fs: cmsFs,
				contentDir: config.contentDir,
				mediaAdapter: options.mediaAdapter,
				maxUploadSize: options.maxUploadSize,
			})
				.catch((error) => {
					console.error('[astro-cms] API error:', error)
					sendError(res, 'Internal server error', 500)
				})
		})
	}

	// Serve global CMS manifest (component definitions, available colors, collection definitions, and settings)
	server.middlewares.use(async (req, res, next) => {
		const pathname = (req.url || '').split('?')[0]
		if (pathname === '/cms-manifest.json') {
			res.setHeader('Content-Type', 'application/json')
			res.setHeader('Access-Control-Allow-Origin', '*')
			res.setHeader('Cache-Control', 'no-store')

			// Build pages from visited pages (have titles from SEO) + filesystem scan
			const pageMap = new Map<string, { pathname: string; title?: string }>()

			// 1. Add pages discovered from filesystem (src/pages)
			const discoveredPages = await discoverPagesFromFilesystem()
			for (const pagePath of discoveredPages) {
				pageMap.set(pagePath, { pathname: pagePath })
			}

			// 2. Add collection entry pages from collection definitions,
			//    pre-populating pathnames so the collections browser can redirect to
			//    detail pages without visiting them first. Prefer the entry's own
			//    declared URL (urlPath/permalink/…) from frontmatter, which is
			//    correct even when the collection is served under a *dynamic* route
			//    prefix (e.g. `[topic]/[slug]`) that discoverCollectionRoutes can't
			//    map to a static prefix. Fall back to the discovered static route
			//    prefix + slug. We build patched copies rather than mutating the
			//    originals so that heuristic pathnames don't persist if the route
			//    file is later removed.
			const collectionDefs = manifestWriter.getCollectionDefinitions()
			const collectionRoutes = await discoverCollectionRoutes()
			const responseCollectionDefs: Record<string, CollectionDefinition> = {}

			for (const [name, def] of Object.entries(collectionDefs)) {
				const routePrefix = collectionRoutes.get(def.name)
				const resolvePathname = (entry: CollectionEntryInfo): string | undefined =>
					declaredSitePathFromData(entry.data) ?? (routePrefix ? `${routePrefix}${entry.slug}` : undefined)
				const needsPatching = def.entries?.some(e => !e.pathname && resolvePathname(e))

				if (!needsPatching) {
					responseCollectionDefs[name] = def
				} else {
					responseCollectionDefs[name] = {
						...def,
						entries: def.entries!.map(e => e.pathname ? e : { ...e, pathname: resolvePathname(e) ?? e.pathname }),
					}
				}

				const entries = responseCollectionDefs[name].entries
				if (entries) {
					for (const entry of entries) {
						if (entry.pathname) {
							pageMap.set(entry.pathname, { pathname: entry.pathname, title: entry.title })
						}
					}
				}
			}

			// 3. Overlay visited pages (they have SEO titles)
			for (const [pagePath, data] of manifestWriter.getPageDataForPreviews()) {
				const existing = pageMap.get(pagePath)
				const title = data.seo?.title?.content || existing?.title
				pageMap.set(pagePath, { pathname: pagePath, ...(title ? { title } : {}) })
			}

			const pages = Array.from(pageMap.values())
				.sort((a, b) => a.pathname.localeCompare(b.pathname))

			const manifest: Record<string, unknown> = {
				componentDefinitions,
				availableColors: manifestWriter.getAvailableColors(),
				availableTextStyles: manifestWriter.getAvailableTextStyles(),
				pages,
			}
			if (Object.keys(responseCollectionDefs).length > 0) {
				manifest.collectionDefinitions = responseCollectionDefs
			}
			const mdxComponents = manifestWriter.getMdxComponents()
			if (mdxComponents) {
				manifest.mdxComponents = mdxComponents
			}
			res.end(JSON.stringify(manifest, null, 2))
			return
		}
		next()
	})

	// Serve per-page manifest endpoints (e.g., /about.json for /about page)
	server.middlewares.use(async (req, res, next) => {
		const url = (req.url || '').split('?')[0]!

		// Match /*.json pattern (but not files that actually exist)
		const match = url.match(/^\/(.*)\.json$/)
		if (match) {
			// Convert manifest path to page path
			// e.g., /about.json -> /about
			//       /index.json -> /
			//       /blog/post.json -> /blog/post
			let pagePath = '/' + match[1]
			if (pagePath === '/index') {
				pagePath = '/'
			}

			// If Phase 2 source resolution is still in flight for this page, wait for it
			// so the response includes full sourcePath data — avoids the race where the
			// editor fetches a partial manifest and locks elements it can't yet edit.
			const inFlight = pendingPhase2.get(pagePath)
			if (inFlight) {
				try {
					await inFlight
				} catch {
					// fall through — serve whatever partial manifest we have
				}
			}

			const pageData = manifestWriter.getPageManifest(pagePath)

			// Only serve if we have manifest data for this page
			if (pageData) {
				res.setHeader('Content-Type', 'application/json')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.setHeader('Cache-Control', 'no-store')
				const responseData: Record<string, unknown> = {
					page: pagePath,
					entries: pageData.entries,
					components: pageData.components,
					componentDefinitions,
				}
				if (pageData.collection) {
					responseData.collection = pageData.collection
				}
				if (pageData.seo) {
					responseData.seo = pageData.seo
				}
				res.end(JSON.stringify(responseData, null, 2))
				return
			}
		}
		next()
	})

	// Transform HTML responses — only buffer when Content-Type is text/html
	server.middlewares.use((req, res, next) => {
		const requestUrl = req.url || 'unknown'

		// Vendor HTML under publicDir is passed through untouched — the CMS rewriter
		// can corrupt files with inline-script patterns it doesn't expect.
		if (isPublicStaticFile(requestUrl)) {
			next()
			return
		}

		const originalWrite = res.write
		const originalEnd = res.end
		let chunks: Buffer[] | null = null
		let isHtml: boolean | null = null

		const checkIfHtml = (): boolean => {
			if (isHtml !== null) return isHtml
			const contentType = res.getHeader('content-type')
			isHtml = !!(contentType && typeof contentType === 'string' && contentType.includes('text/html'))
			if (isHtml) {
				chunks = []
			}
			return isHtml
		}

		// Intercept response chunks — only buffer for HTML
		res.write = ((chunk: any, encodingOrCb?: any, cb?: any) => {
			if (!checkIfHtml()) {
				// Not HTML — pass through immediately, preserving backpressure
				return originalWrite.call(res, chunk, encodingOrCb, cb)
			}
			if (chunk) {
				chunks!.push(
					typeof chunk === 'string' ? Buffer.from(chunk, typeof encodingOrCb === 'string' ? encodingOrCb as BufferEncoding : 'utf-8') : Buffer.from(chunk),
				)
			}
			if (typeof encodingOrCb === 'function') encodingOrCb()
			else if (typeof cb === 'function') cb()
			return true
		}) as any

		res.end = ((chunk: any, ...args: any[]) => {
			if (!checkIfHtml()) {
				// Not HTML — pass through
				res.write = originalWrite
				res.end = originalEnd
				return res.end(chunk, ...args)
			}

			// Skip CMS processing for internal preview pages
			if (requestUrl.startsWith('/_nua/preview')) {
				res.write = originalWrite
				res.end = originalEnd
				return (res.end as any)(chunk, ...args)
			}

			if (chunk) {
				chunks!.push(Buffer.from(chunk))
			}

			const html = Buffer.concat(chunks!).toString('utf8')
			const pagePath = normalizePagePath(requestUrl)

			// Phase 1 (fast): mark HTML with CMS IDs and build basic entries
			markHtmlForDev(html, pagePath, config, idCounter, manifestWriter)
				.then(({ html: transformed, entries, components, collection, seo, collectionDefinitions: colDefs }) => {
					// Store basic manifest immediately so editor toolbar has data
					manifestWriter.addPage(pagePath, entries, components, collection, seo)

					// Send the marked HTML to the browser without waiting for source resolution
					res.write = originalWrite
					res.end = originalEnd
					if (!res.headersSent) {
						res.removeHeader('content-length')
					}
					res.end(transformed, ...args)

					// Phase 2 runs after the HTML is sent so the page renders without waiting on
					// source resolution. The manifest endpoint awaits this promise (via
					// pendingPhase2) so it never returns entries with missing sourcePath.
					const phase2 = enhanceManifestInBackground(
						pagePath,
						entries,
						components,
						collection,
						seo,
						colDefs,
						config,
						manifestWriter,
					)
					pendingPhase2.set(pagePath, phase2)
					phase2.finally(() => {
						if (pendingPhase2.get(pagePath) === phase2) {
							pendingPhase2.delete(pagePath)
						}
					})
				})
				.catch((error) => {
					console.error('[cms] Error transforming HTML:', error)

					res.write = originalWrite
					res.end = originalEnd

					if (chunks!.length > 0) {
						return res.end(Buffer.concat(chunks!), ...args)
					}
					return res.end(...args)
				})
			return
		}) as any

		next()
	})
}

/**
 * Phase 1 (fast): Mark HTML with CMS IDs and build basic manifest entries.
 * Returns quickly so the page can be sent to the browser without delay.
 * Source resolution and snippet enhancement are deferred to Phase 2.
 */
async function markHtmlForDev(
	html: string,
	pagePath: string,
	config: Required<CmsMarkerOptions>,
	idCounter: { value: number },
	manifestWriter: ManifestWriter,
) {
	// Re-index only files that changed since last page load (tracked by Vite watcher).
	await reindexDirtyFiles()

	// In dev mode, reset counter per page for consistent IDs during HMR
	let pageCounter = 0
	const idGenerator = () => `cms-${pageCounter++}`

	// Check if this is a collection page
	const collectionInfo = await findCollectionSource(pagePath, config.contentDir)
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
				const content = await fs.readFile(filePath, 'utf-8')
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
		const enhanced = await enhanceManifestWithSourceSnippets(entries, collectionDefinitions, pageFiles)

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
				const loc = await findSourceLocation(entry.text, entry.tag, pageFiles)
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
		await fs.access(pagesDir)
	} catch {
		return []
	}

	const pages: string[] = []

	async function walk(dir: string, urlPrefix: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true })
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

/** Cached result of collection route discovery; invalidated by file watcher */
let collectionRoutesCache: Map<string, string> | null = null

/** Invalidate the cached collection routes (called from vite-plugin when route files change) */
export function invalidateCollectionRoutesCache() {
	collectionRoutesCache = null
}

/**
 * Discover collection route patterns by scanning src/pages for dynamic route files
 * (e.g. [slug].astro) that call getCollection(). Returns a map from collection name
 * to the URL prefix (e.g. 'blog' → '/blog/'). Result is cached after first call.
 */
async function discoverCollectionRoutes(): Promise<Map<string, string>> {
	if (collectionRoutesCache) return collectionRoutesCache

	const projectRoot = getProjectRoot()
	const pagesDir = path.join(projectRoot, 'src', 'pages')
	const routes = new Map<string, string>()

	try {
		await fs.access(pagesDir)
	} catch {
		collectionRoutesCache = routes
		return routes
	}

	async function walk(dir: string, urlPrefix: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true })
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
				// Only interested in dynamic route files
				if (!entry.name.includes('[')) continue

				try {
					const content = await fs.readFile(fullPath, 'utf-8')
					const match = content.match(/getCollection\(\s*['"](\w+)['"]\s*\)/)
					if (match?.[1]) {
						routes.set(match[1], urlPrefix)
					}
				} catch { /* skip unreadable files */ }
			}
		}
	}

	await walk(pagesDir, '/')
	collectionRoutesCache = routes
	return routes
}

function mediaMimeFromExt(ext: string): string {
	const map: Record<string, string> = {
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.avif': 'image/avif',
		'.ico': 'image/x-icon',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.pdf': 'application/pdf',
	}
	return map[ext] ?? 'application/octet-stream'
}
