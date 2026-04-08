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
	findCollectionSource,
	findImageSourceLocation,
	findSourceLocation,
	initializeSearchIndex,
	parseMarkdownContent,
	reindexDirtyFiles,
} from './source-finder'
import type {
	CmsMarkerOptions,
	CollectionDefinition,
	CollectionEntry,
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
}

export function createDevMiddleware(
	server: ViteDevServerLike,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	componentDefinitions: Record<string, ComponentDefinition>,
	idCounter: { value: number },
	options: DevMiddlewareOptions = {},
) {
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
		server.middlewares.use((req, res, next) => {
			const url = req.url || ''
			if (!url.startsWith('/_nua/cms/')) {
				next()
				return
			}

			if (handleCors(req, res)) return

			const route = url.replace('/_nua/cms/', '').split('?')[0]!

			handleCmsApiRoute(route, req, res, manifestWriter, config.contentDir, options.mediaAdapter)
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

			// 2. Add collection entry pages from collection definitions
			const collectionDefs = manifestWriter.getCollectionDefinitions()
			for (const def of Object.values(collectionDefs)) {
				if (def.entries) {
					for (const entry of def.entries) {
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
			if (Object.keys(collectionDefs).length > 0) {
				manifest.collectionDefinitions = collectionDefs
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
	server.middlewares.use((req, res, next) => {
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
		const originalWrite = res.write
		const originalEnd = res.end
		const requestUrl = req.url || 'unknown'
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

					// Phase 2 (background): resolve source locations and enhance manifest
					// This runs after the page is already visible to the user
					enhanceManifestInBackground(pagePath, entries, components, collection, seo, colDefs, config, manifestWriter)
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
async function enhanceManifestInBackground(
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

		// Ensure the search index is initialized
		await initializeSearchIndex()

		// Re-resolve sources with the search index
		for (const entry of Object.values(entries)) {
			if (entry.imageMetadata?.src) {
				const imageSource = await findImageSourceLocation(entry.imageMetadata.src, entry.imageMetadata.srcSet)
				if (imageSource) {
					entry.sourcePath = imageSource.file
					entry.sourceLine = imageSource.line
					entry.sourceSnippet = imageSource.snippet
				}
			} else if (entry.text && entry.tag) {
				const textSource = await findSourceLocation(entry.text, entry.tag)
				if (textSource) {
					entry.sourcePath = textSource.file
					entry.sourceLine = textSource.line
					entry.sourceSnippet = textSource.snippet
					if (textSource.variableName) entry.variableName = textSource.variableName
				}
			}
		}

		// Update the manifest with fully-resolved entries and component props
		manifestWriter.addPage(pagePath, entries, components, collection, seo)
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
