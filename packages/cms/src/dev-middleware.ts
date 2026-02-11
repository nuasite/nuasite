import { parse } from 'node-html-parser'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { getProjectRoot } from './config'
import { handleAddArrayItem, handleRemoveArrayItem } from './handlers/array-ops'
import {
	extractPropsFromSource,
	findComponentInvocationLine,
	getPageFileCandidates,
	handleInsertComponent,
	handleRemoveComponent,
	normalizeFilePath,
} from './handlers/component-ops'
import { handleCreateMarkdown, handleGetMarkdownContent, handleUpdateMarkdown } from './handlers/markdown-ops'
import { handleCors, parseJsonBody, parseMultipartFile, readBody, sendError, sendJson } from './handlers/request-utils'
import { handleUpdate } from './handlers/source-writer'
import { processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import type { MediaStorageAdapter } from './media/types'
import { clearSourceFinderCache, findCollectionSource, findImageSourceLocation, initializeSearchIndex, parseMarkdownContent } from './source-finder'
import type { CmsMarkerOptions, CollectionEntry, ComponentDefinition, PageSeoData } from './types'
import { normalizePagePath } from './utils'

/** Minimal ViteDevServer interface to avoid version conflicts between Astro's bundled Vite and root Vite */
interface ViteDevServerLike {
	middlewares: {
		use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
	}
	transformIndexHtml: (url: string, html: string) => Promise<string>
}

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

			handleCmsApiRoute(route, req, res, manifestWriter, options.mediaAdapter).catch(
				(error) => {
					console.error('[astro-cms] API error:', error)
					sendError(res, 'Internal server error', 500)
				},
			)
		})
	}

	// Serve global CMS manifest (component definitions, available colors, collection definitions, and settings)
	server.middlewares.use((req, res, next) => {
		const pathname = (req.url || '').split('?')[0]
		if (pathname === '/cms-manifest.json') {
			res.setHeader('Content-Type', 'application/json')
			res.setHeader('Access-Control-Allow-Origin', '*')
			res.setHeader('Cache-Control', 'no-store')
			const manifest: Record<string, unknown> = {
				componentDefinitions,
				availableColors: manifestWriter.getAvailableColors(),
				availableTextStyles: manifestWriter.getAvailableTextStyles(),
			}
			const collectionDefs = manifestWriter.getCollectionDefinitions()
			if (Object.keys(collectionDefs).length > 0) {
				manifest.collectionDefinitions = collectionDefs
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

			// Process HTML asynchronously
			processHtmlForDev(html, pagePath, config, idCounter)
				.then(({ html: transformed, entries, components, collection, seo }) => {
					manifestWriter.addPage(pagePath, entries, components, collection, seo)

					res.write = originalWrite
					res.end = originalEnd
					if (!res.headersSent) {
						res.removeHeader('content-length')
					}

					return res.end(transformed, ...args)
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

async function handleCmsApiRoute(
	route: string,
	req: IncomingMessage,
	res: ServerResponse,
	manifestWriter: ManifestWriter,
	mediaAdapter?: MediaStorageAdapter,
): Promise<void> {
	// POST /_nua/cms/update
	if (route === 'update' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleUpdate>[0]>(req)
		const result = await handleUpdate(body, manifestWriter)
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/insert-component
	if (route === 'insert-component' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleInsertComponent>[0]>(req)
		const result = await handleInsertComponent(body, manifestWriter)
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/remove-component
	if (route === 'remove-component' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleRemoveComponent>[0]>(req)
		const result = await handleRemoveComponent(body, manifestWriter)
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/add-array-item
	if (route === 'add-array-item' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleAddArrayItem>[0]>(req)
		const result = await handleAddArrayItem(body, manifestWriter)
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/remove-array-item
	if (route === 'remove-array-item' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleRemoveArrayItem>[0]>(req)
		const result = await handleRemoveArrayItem(body, manifestWriter)
		sendJson(res, result)
		return
	}

	// GET /_nua/cms/markdown/content?filePath=...
	if (route === 'markdown/content' && req.method === 'GET') {
		const urlObj = new URL(req.url!, `http://${req.headers.host}`)
		const filePath = urlObj.searchParams.get('filePath')
		if (!filePath) {
			sendError(res, 'filePath query parameter required')
			return
		}
		const result = await handleGetMarkdownContent(filePath)
		if (!result) {
			sendError(res, 'File not found', 404)
			return
		}
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/markdown/update
	if (route === 'markdown/update' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleUpdateMarkdown>[0]>(req)
		const result = await handleUpdateMarkdown(body)
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/markdown/create
	if (route === 'markdown/create' && req.method === 'POST') {
		const body = await parseJsonBody<Parameters<typeof handleCreateMarkdown>[0]>(req)
		const result = await handleCreateMarkdown(body)
		sendJson(res, result, result.success ? 200 : 400)
		return
	}

	// GET /_nua/cms/media/list
	if (route === 'media/list' && req.method === 'GET') {
		if (!mediaAdapter) {
			sendError(res, 'Media storage not configured', 501)
			return
		}
		const urlObj = new URL(req.url!, `http://${req.headers.host}`)
		const parsedLimit = parseInt(urlObj.searchParams.get('limit') ?? '50', 10)
		const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 1000)
		const cursor = urlObj.searchParams.get('cursor') ?? undefined
		const result = await mediaAdapter.list({ limit, cursor })
		sendJson(res, result)
		return
	}

	// POST /_nua/cms/media/upload
	if (route === 'media/upload' && req.method === 'POST') {
		if (!mediaAdapter) {
			sendError(res, 'Media storage not configured', 501)
			return
		}
		const contentType = req.headers['content-type'] ?? ''
		if (!contentType.includes('multipart/form-data')) {
			sendError(res, 'Expected multipart/form-data')
			return
		}
		// 50 MB limit for file uploads
		const body = await readBody(req, 50 * 1024 * 1024)
		const file = parseMultipartFile(body, contentType)
		if (!file) {
			sendError(res, 'No file found in request')
			return
		}

		// Validate file content type — allow images, videos, PDFs, and common web assets
		const allowedTypes = [
			'image/jpeg',
			'image/png',
			'image/gif',
			'image/webp',
			'image/avif',
			'image/x-icon',
			'video/mp4',
			'video/webm',
			'application/pdf',
		]
		// Block SVG (can contain scripts) unless explicitly served with safe headers
		if (!allowedTypes.includes(file.contentType)) {
			sendError(res, `File type not allowed: ${file.contentType}`)
			return
		}

		const result = await mediaAdapter.upload(file.buffer, file.filename, file.contentType)
		sendJson(res, result)
		return
	}

	// DELETE /_nua/cms/media/<id> — only match paths with an actual ID segment
	if (route.startsWith('media/') && req.method === 'DELETE') {
		if (!mediaAdapter) {
			sendError(res, 'Media storage not configured', 501)
			return
		}
		const id = route.slice('media/'.length)
		// Don't match known sub-routes like 'list' or 'upload'
		if (!id || id === 'list' || id === 'upload') {
			sendError(res, 'Not found', 404)
			return
		}
		const result = await mediaAdapter.delete(decodeURIComponent(id))
		sendJson(res, result)
		return
	}

	// GET /_nua/cms/deployment/status
	if (route === 'deployment/status' && req.method === 'GET') {
		sendJson(res, { currentDeployment: null, pendingCount: 0 })
		return
	}

	sendError(res, 'Not found', 404)
}

async function processHtmlForDev(
	html: string,
	pagePath: string,
	config: Required<CmsMarkerOptions>,
	idCounter: { value: number },
) {
	// Clear cached parsed files so variable definitions reflect the latest source
	clearSourceFinderCache()

	// In dev mode, reset counter per page for consistent IDs during HMR
	let pageCounter = 0
	const idGenerator = () => `cms-${pageCounter++}`

	// Check if this is a collection page (e.g., /services/example -> services collection, example slug)
	const collectionInfo = await findCollectionSource(pagePath, config.contentDir)
	const isCollectionPage = !!collectionInfo

	// Parse markdown content if this is a collection page
	let mdContent: Awaited<ReturnType<typeof parseMarkdownContent>> | undefined
	if (collectionInfo) {
		mdContent = await parseMarkdownContent(collectionInfo)
	}

	// Get the first non-empty line of the markdown body for wrapper detection
	const bodyFirstLine = mdContent?.body
		?.split('\n')
		.find((line) => line.trim().length > 0)
		?.trim()

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
			// Skip marking markdown-rendered content on collection pages
			// The markdown body is treated as a single editable unit
			skipMarkdownContent: isCollectionPage,
			// Pass collection info for wrapper element marking
			collectionInfo: collectionInfo
				? { name: collectionInfo.name, slug: collectionInfo.slug, bodyFirstLine, bodyText: mdContent?.body, contentPath: collectionInfo.file }
				: undefined,
			// Pass SEO options
			seo: config.seo,
		},
		idGenerator,
	)

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

	for (const comp of Object.values(result.components)) {
		let found = false

		// Try invocationSourcePath first (may point to a layout, not the page)
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

		// Fallback: search page source file candidates
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

	// Ensure the search index is initialized for image source lookups
	// (idempotent - only scans files on first call)
	await initializeSearchIndex()

	// In dev mode, we use the source info from Astro compiler attributes
	// which is already extracted by html-processor
	// Always search for image source by src value - the sourcePath from HTML attributes
	// may point to a shared Image component rather than the actual usage site
	for (const entry of Object.values(result.entries)) {
		if (entry.imageMetadata?.src) {
			const imageSource = await findImageSourceLocation(entry.imageMetadata.src, entry.imageMetadata.srcSet)
			if (imageSource) {
				entry.sourcePath = imageSource.file
				entry.sourceLine = imageSource.line
				entry.sourceSnippet = imageSource.snippet
			}
		}
	}

	// Filter out entries without sourcePath - these can't be edited
	const idsToRemove: string[] = []
	for (const [id, entry] of Object.entries(result.entries)) {
		// Keep collection wrapper entries even without sourcePath (they use contentPath)
		if (entry.collectionName) continue
		// Remove entries that don't have a resolved sourcePath
		if (!entry.sourcePath) {
			idsToRemove.push(id)
			delete result.entries[id]
		}
	}

	// Remove CMS ID attributes from HTML for entries that were filtered out
	let finalHtml = result.html
	if (idsToRemove.length > 0) {
		const root = parse(result.html, {
			lowerCaseTagName: false,
			comment: true,
		})
		for (const id of idsToRemove) {
			const element = root.querySelector(`[${config.attributeName}="${id}"]`)
			if (element) {
				element.removeAttribute(config.attributeName)
				// Also remove related CMS attributes
				element.removeAttribute('data-cms-img')
				element.removeAttribute('data-cms-markdown')
			}
		}
		finalHtml = root.toString()
	}

	return {
		html: finalHtml,
		entries: result.entries,
		components: result.components,
		collection: collectionEntry,
		seo: result.seo,
	}
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
