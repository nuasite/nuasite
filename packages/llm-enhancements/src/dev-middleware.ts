import { createPublicStaticFileChecker } from '@nuasite/cms-core'
import type { AstroConfig } from 'astro'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViteDevServer } from 'vite'
import { cms } from './cms'
import { findCollectionPages } from './cms-marker'
import { htmlToMarkdown, type HtmlToMarkdownResult } from './html-to-markdown'
import { generateLlmMarkdown, type PageEntry, type SiteMetadata } from './llm-endpoint'
import { generateLlmsTxt } from './llms-txt-endpoint'
import { generateMarkdown } from './markdown-generator'
import { markdownSyntaxOf } from './mdx'
import { resolvePageMarkdown, type SiteContent } from './page-markdown'
import { injectMarkdownLink, LLM_ENDPOINT_PATH, LLMS_TXT_PATH, mdUrlToPagePath, normalizePath } from './paths'
import type { ResolvedOptions } from './types'

const ASSET_PATTERN = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json)$/

/**
 * Generate markdown for a given page path
 */
async function generateMarkdownForPath(
	pagePath: string,
	host: string,
	options: ResolvedOptions,
	baseUrl: string,
	site: SiteContent,
): Promise<string | null> {
	const resolved = await resolvePageMarkdown(pagePath, options, site, () => fetchPage(host, pagePath))
	if (!resolved) return null

	return generateMarkdown(resolved.output, {
		url: pagePath,
		type: resolved.type,
		sourcePath: resolved.sourcePath,
		baseUrl,
	}, options.includeFrontmatter)
}

/** The dev server's rendering of a page, converted to markdown, or `undefined` when it serves no HTML there. */
async function fetchPage(host: string, pagePath: string): Promise<HtmlToMarkdownResult | undefined> {
	const response = await fetch(`http://${host}${pagePath}`, {
		headers: { Accept: 'text/html' },
	})

	if (!response.ok) return undefined

	const contentType = response.headers.get('content-type')
	if (!contentType?.includes('text/html')) return undefined

	return htmlToMarkdown(await response.text())
}

/**
 * Discover all pages and their metadata for the LLM endpoint
 */
async function discoverPages(
	host: string,
	options: ResolvedOptions,
	site: SiteContent,
): Promise<{ pages: PageEntry[]; siteMetadata: SiteMetadata }> {
	const pages: PageEntry[] = []
	let siteMetadata: SiteMetadata = {}

	// For now, we discover only the homepage: the dev server has no list of routes to offer. A homepage
	// the dev server fails to render is still listed when its entry tells it.
	const home = fetchPage(host, '/').catch(() => undefined)
	const metadata = (await home)?.metadata
	if (metadata) siteMetadata = { title: metadata.title, description: metadata.description }

	try {
		const resolved = await resolvePageMarkdown('/', options, site, () => home)
		if (resolved) pages.push({ pathname: '/', title: resolved.title, type: resolved.type })
	} catch {
		// Ignore
	}

	return { pages, siteMetadata }
}

/**
 * Get base URL from Astro config, removing trailing slash
 */
function getBaseUrl(config: AstroConfig): string {
	const site = config.site
	if (!site) return ''
	return site.endsWith('/') ? site.slice(0, -1) : site
}

/**
 * Create dev server middleware to handle markdown requests
 */
export function createDevMiddleware(server: ViteDevServer, options: ResolvedOptions, config: AstroConfig) {
	const baseUrl = getBaseUrl(config)
	// Entries are read from Astro's root, as in the build, whatever the working directory is. The project
	// and the pages that render an entry are kept between requests, and replaced after a change to the
	// content, the routes or the content config. The routes are the ones the CMS reads, in `src/pages`.
	const root = fileURLToPath(config.root)
	const watched = [path.resolve(root, options.contentDir) + path.sep, path.join(root, 'src', 'pages') + path.sep]
	const syntax = markdownSyntaxOf(config)
	let project = cms?.projectAtRoot(root)
	let site: Promise<SiteContent> | undefined
	server.watcher?.on('all', (_event: string, file: string) => {
		const changed = path.resolve(file)
		if (watched.some(dir => changed.startsWith(dir)) || /content\.config\.[cm]?[jt]s$/.test(changed)) {
			project = cms?.projectAtRoot(root)
			site = undefined
		}
	})
	/** Run `resolve` in the project, against the pages that render an entry. */
	const withSite = <T>(resolve: (site: SiteContent) => Promise<T>): Promise<T> => {
		const run = async () => {
			site ??= findCollectionPages(options.contentDir, message => console.warn(`[llm-enhancements] ${message}`)).then(pages => ({ pages, syntax }))
			return resolve(await site)
		}
		return project ? project.run(run) : run()
	}

	const isPublicStaticFile = createPublicStaticFileChecker(
		config.publicDir ? fileURLToPath(config.publicDir) : undefined,
	)

	// Serve /llms.txt endpoint (only if site is configured)
	const llmsTxtOptions = options.llmsTxt
	if (llmsTxtOptions !== false && baseUrl) {
		server.middlewares.use(async (req, res, next) => {
			const url = req.url || ''

			if (url !== LLMS_TXT_PATH) {
				return next()
			}

			try {
				const host = req.headers.host || 'localhost:4321'
				const { pages, siteMetadata } = await withSite(site => discoverPages(host, options, site))
				const content = generateLlmsTxt(pages, { ...siteMetadata, baseUrl }, llmsTxtOptions)

				res.setHeader('Content-Type', 'text/plain; charset=utf-8')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.end(content)
				return
			} catch (error) {
				console.error('[llm-enhancements] Error generating llms.txt:', error)
			}

			return next()
		})
	}

	// Serve /.well-known/llm.md endpoint (only if site is configured)
	const llmEndpointOptions = options.llmEndpoint
	if (llmEndpointOptions !== false && baseUrl) {
		server.middlewares.use(async (req, res, next) => {
			const url = req.url || ''

			if (url !== LLM_ENDPOINT_PATH) {
				return next()
			}

			try {
				const host = req.headers.host || 'localhost:4321'
				const { pages, siteMetadata } = await withSite(site => discoverPages(host, options, site))
				const markdown = generateLlmMarkdown(pages, { ...siteMetadata, baseUrl }, llmEndpointOptions)

				res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.end(markdown)
				return
			} catch (error) {
				console.error('[llm-enhancements] Error generating llm.md:', error)
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

		// Decoded, as the pages that render an entry are keyed: `/aktuality/%C5%A1kola.md` is `/aktuality/škola`.
		let pagePath: string
		try {
			pagePath = mdUrlToPagePath(decodeURI(url))
		} catch {
			return next()
		}

		try {
			const host = req.headers.host || 'localhost:4321'
			const markdown = await withSite(site => generateMarkdownForPath(pagePath, host, options, baseUrl, site))

			if (markdown) {
				res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.end(markdown)
				return
			}
		} catch (error) {
			console.error('[llm-enhancements] Error generating markdown:', error)
		}

		return next()
	})

	// Inject alternate link into HTML responses
	server.middlewares.use((req, res, next) => {
		const url = req.url || ''

		if (url.endsWith('.md') || ASSET_PATTERN.test(url)) {
			return next()
		}

		// Skip vendor HTML served from publicDir — it has no .md counterpart, and
		// rewriting the body without updating content-length truncates the response.
		if (isPublicStaticFile(url)) {
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
				const transformed = injectMarkdownLink(html, pagePath)
				if (!res.headersSent) {
					res.removeHeader('content-length')
				}
				return res.end(transformed, ...(args as []))
			}

			return chunks.length > 0
				? res.end(Buffer.concat(chunks), ...(args as []))
				: res.end(...(args as []))
		}) as typeof res.end

		next()
	})
}
