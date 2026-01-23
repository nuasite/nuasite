import type { IncomingMessage, ServerResponse } from 'node:http'
import { processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import { findCollectionSource, findImageSourceLocation, parseMarkdownContent } from './source-finder'
import type { CmsMarkerOptions, CollectionEntry, ComponentDefinition } from './types'

/** Minimal ViteDevServer interface to avoid version conflicts between Astro's bundled Vite and root Vite */
interface ViteDevServerLike {
	middlewares: {
		use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
	}
	transformIndexHtml: (url: string, html: string) => Promise<string>
}

/**
 * Get the normalized page path from a URL
 * For example: /about/ -> /about
 *              /about -> /about
 *              / -> /
 */
function normalizePagePath(url: string): string {
	// Remove query string and hash
	let pagePath = url.split('?')[0]?.split('#')[0] ?? ''
	// Remove trailing slash (but keep root /)
	if (pagePath.length > 1 && pagePath.endsWith('/')) {
		pagePath = pagePath.slice(0, -1)
	}
	return pagePath || '/'
}

export function createDevMiddleware(
	server: ViteDevServerLike,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	componentDefinitions: Record<string, ComponentDefinition>,
	idCounter: { value: number },
) {
	// Serve global CMS manifest (component definitions, available colors, and settings)
	server.middlewares.use((req, res, next) => {
		if (req.url === '/cms-manifest.json') {
			res.setHeader('Content-Type', 'application/json')
			res.setHeader('Access-Control-Allow-Origin', '*')
			res.end(JSON.stringify(
				{
					componentDefinitions,
					availableColors: manifestWriter.getAvailableColors(),
				},
				null,
				2,
			))
			return
		}
		next()
	})

	// Serve per-page manifest endpoints (e.g., /about.json for /about page)
	server.middlewares.use((req, res, next) => {
		const url = req.url || ''

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
				res.end(JSON.stringify(
					{
						page: pagePath,
						entries: pageData.entries,
						components: pageData.components,
						componentDefinitions,
					},
					null,
					2,
				))
				return
			}
		}
		next()
	})

	// Transform HTML responses
	server.middlewares.use((req, res, next) => {
		const originalWrite = res.write
		const originalEnd = res.end
		const chunks: Buffer[] = []
		const requestUrl = req.url || 'unknown'

		// Intercept response chunks
		res.write = ((chunk: any, ...args: any[]) => {
			if (chunk) {
				chunks.push(Buffer.from(chunk))
			}
			return true
		}) as any

		res.end = ((chunk: any, ...args: any[]) => {
			if (chunk) {
				chunks.push(Buffer.from(chunk))
			}

			// Check if this is an HTML response
			const contentType = res.getHeader('content-type')
			if (contentType && typeof contentType === 'string' && contentType.includes('text/html')) {
				const html = Buffer.concat(chunks).toString('utf8')
				const pagePath = normalizePagePath(requestUrl)

				// Process HTML asynchronously
				processHtmlForDev(html, pagePath, config, idCounter)
					.then(({ html: transformed, entries, components, collection }) => {
						// Store in manifest writer
						manifestWriter.addPage(pagePath, entries, components, collection)

						// Restore original methods and send transformed HTML
						res.write = originalWrite
						res.end = originalEnd

						return res.end(transformed, ...args)
					})
					.catch((error) => {
						console.error('[astro-cms-marker] Error transforming HTML:', error)

						// Restore original methods and send original content
						res.write = originalWrite
						res.end = originalEnd

						if (chunks.length > 0) {
							return res.end(Buffer.concat(chunks), ...args)
						}
						return res.end(...args)
					})
				return
			}

			// Restore original methods and send original content
			res.write = originalWrite
			res.end = originalEnd

			if (chunks.length > 0) {
				return res.end(Buffer.concat(chunks), ...args)
			}
			return res.end(...args)
		}) as any

		next()
	})
}

async function processHtmlForDev(
	html: string,
	pagePath: string,
	config: Required<CmsMarkerOptions>,
	idCounter: { value: number },
) {
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
				? { name: collectionInfo.name, slug: collectionInfo.slug, bodyFirstLine, contentPath: collectionInfo.file }
				: undefined,
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

	// In dev mode, we use the source info from Astro compiler attributes
	// which is already extracted by html-processor
	// However, images may not have source info if their ancestors don't have it
	// In that case, fall back to searching for the image src
	for (const entry of Object.values(result.entries)) {
		if (entry.sourceType === 'image' && entry.imageMetadata?.src && !entry.sourcePath) {
			const imageSource = await findImageSourceLocation(entry.imageMetadata.src)
			if (imageSource) {
				entry.sourcePath = imageSource.file
				entry.sourceLine = imageSource.line
				entry.sourceSnippet = imageSource.snippet
			}
		}
	}

	return {
		html: result.html,
		entries: result.entries,
		components: result.components,
		collection: collectionEntry,
	}
}
