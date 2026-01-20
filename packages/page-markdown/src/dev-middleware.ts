import type { ViteDevServer } from 'vite'
import { getCollectionContent } from './cms-marker'
import { htmlToMarkdown } from './html-to-markdown'
import { generateLlmMarkdown, type PageEntry, type SiteMetadata } from './llm-endpoint'
import { createCollectionOutput, createStaticOutput, generateMarkdown } from './markdown-generator'
import { injectMarkdownLink, LLM_ENDPOINT_PATH, mdUrlToPagePath, normalizePath } from './paths'
import type { ResolvedOptions } from './types'

const ASSET_PATTERN = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json)$/

/**
 * Generate markdown for a given page path
 */
async function generateMarkdownForPath(
	pagePath: string,
	host: string,
	options: ResolvedOptions,
): Promise<string | null> {
	// Try collection page first
	const content = await getCollectionContent(pagePath, options.contentDir)
	if (content) {
		const output = createCollectionOutput(content.frontmatter, content.body, content.file)
		return generateMarkdown(output, {
			url: pagePath,
			type: 'collection',
			sourcePath: content.file,
		}, options.includeFrontmatter)
	}

	// Fall back to static page handling
	if (!options.includeStaticPages) {
		return null
	}

	const response = await fetch(`http://${host}${pagePath}`, {
		headers: { Accept: 'text/html' },
	})

	if (!response.ok) return null

	const contentType = response.headers.get('content-type')
	if (!contentType?.includes('text/html')) return null

	const html = await response.text()
	const { metadata, body } = htmlToMarkdown(html)
	const output = createStaticOutput(metadata, body)

	return generateMarkdown(output, {
		url: pagePath,
		type: 'static',
	}, options.includeFrontmatter)
}

/**
 * Discover all pages and their metadata for the LLM endpoint
 */
async function discoverPages(host: string, options: ResolvedOptions): Promise<{ pages: PageEntry[]; siteMetadata: SiteMetadata }> {
	const pages: PageEntry[] = []
	let siteMetadata: SiteMetadata = {}

	// Fetch the sitemap or root to discover pages
	// First try to get homepage metadata
	try {
		const homeResponse = await fetch(`http://${host}/`, {
			headers: { Accept: 'text/html' },
		})
		if (homeResponse.ok) {
			const html = await homeResponse.text()
			const { metadata } = htmlToMarkdown(html)
			siteMetadata = {
				title: metadata.title,
				description: metadata.description,
			}
		}
	} catch {
		// Ignore errors
	}

	// Try to get pages from Astro's dev server manifest via __astro_dev_toolbar__
	// For now, we'll discover pages by checking common routes and the content directory
	// In dev mode, we just report what we can discover

	// Check if homepage exists
	try {
		const content = await getCollectionContent('/', options.contentDir)
		if (content) {
			pages.push({ pathname: '/', title: content.frontmatter.title as string | undefined, type: 'collection' })
		} else if (options.includeStaticPages) {
			const response = await fetch(`http://${host}/`, { headers: { Accept: 'text/html' } })
			if (response.ok) {
				const html = await response.text()
				const { metadata } = htmlToMarkdown(html)
				pages.push({ pathname: '/', title: metadata.title, type: 'static' })
			}
		}
	} catch {
		// Ignore
	}

	return { pages, siteMetadata }
}

/**
 * Create dev server middleware to handle markdown requests
 */
export function createDevMiddleware(server: ViteDevServer, options: ResolvedOptions) {
	// Serve /.well-known/llm.md endpoint
	const llmEndpointOptions = options.llmEndpoint
	if (llmEndpointOptions !== false) {
		server.middlewares.use(async (req, res, next) => {
			const url = req.url || ''

			if (url !== LLM_ENDPOINT_PATH) {
				return next()
			}

			try {
				const host = req.headers.host || 'localhost:4321'
				const { pages, siteMetadata } = await discoverPages(host, options)
				const markdown = generateLlmMarkdown(pages, siteMetadata, llmEndpointOptions)

				res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.end(markdown)
				return
			} catch (error) {
				console.error('[page-markdown] Error generating llm.md:', error)
			}

			return next()
		})
	}

	// Serve .md endpoints
	server.middlewares.use(async (req, res, next) => {
		const url = req.url || ''

		if (!url.endsWith('.md')) {
			return next()
		}

		const pagePath = mdUrlToPagePath(url)

		try {
			const host = req.headers.host || 'localhost:4321'
			const markdown = await generateMarkdownForPath(pagePath, host, options)

			if (markdown) {
				res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.end(markdown)
				return
			}
		} catch (error) {
			console.error('[page-markdown] Error generating markdown:', error)
		}

		return next()
	})

	// Inject alternate link into HTML responses
	server.middlewares.use((req, res, next) => {
		const url = req.url || ''

		if (url.endsWith('.md') || ASSET_PATTERN.test(url)) {
			return next()
		}

		const originalWrite = res.write
		const originalEnd = res.end
		const chunks: Buffer[] = []

		res.write = ((chunk: unknown) => {
			if (chunk) chunks.push(Buffer.from(chunk as Buffer))
			return true
		}) as typeof res.write

		res.end = ((chunk?: unknown, ...args: unknown[]) => {
			if (chunk) chunks.push(Buffer.from(chunk as Buffer))

			const contentType = res.getHeader('content-type')
			const isHtml = typeof contentType === 'string' && contentType.includes('text/html')

			res.write = originalWrite
			res.end = originalEnd

			if (isHtml && chunks.length > 0) {
				const html = Buffer.concat(chunks).toString('utf8')
				const pagePath = normalizePath(url)
				return res.end(injectMarkdownLink(html, pagePath), ...(args as []))
			}

			return chunks.length > 0
				? res.end(Buffer.concat(chunks), ...(args as []))
				: res.end(...(args as []))
		}) as typeof res.end

		next()
	})
}
