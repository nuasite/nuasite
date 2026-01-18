import type { ViteDevServer } from 'vite'
import { getCollectionContent } from './cms-marker'
import { htmlToMarkdown } from './html-to-markdown'
import { createCollectionOutput, createStaticOutput, generateMarkdown } from './markdown-generator'
import { injectMarkdownLink, mdUrlToPagePath, normalizePath } from './paths'
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
 * Create dev server middleware to handle markdown requests
 */
export function createDevMiddleware(server: ViteDevServer, options: ResolvedOptions) {
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

		res.write = function (chunk: unknown) {
			if (chunk) chunks.push(Buffer.from(chunk as Buffer))
			return true
		} as typeof res.write

		res.end = function (chunk?: unknown, ...args: unknown[]) {
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
		} as typeof res.end

		next()
	})
}
