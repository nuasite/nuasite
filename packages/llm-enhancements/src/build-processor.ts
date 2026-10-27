import type { AstroConfig, AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCollectionPages } from './cms-marker.ts'
import { cms } from './cms.ts'
import { htmlToMarkdown } from './html-to-markdown.ts'
import { generateLlmMarkdown, type PageEntry, type SiteMetadata } from './llm-endpoint.ts'
import { generateLlmsTxt } from './llms-txt-endpoint.ts'
import { generateMarkdown } from './markdown-generator.ts'
import { markdownSyntaxOf } from './mdx.ts'
import { resolvePageMarkdown } from './page-markdown.ts'
import { getHtmlPath, getLlmOutputPath, getLlmsTxtOutputPath, getMdOutputPath, injectMarkdownLink, normalizePath } from './paths.ts'
import type { ResolvedOptions } from './types.ts'

interface PageInfo {
	pathname: string
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
 * Process build output and generate .md files for all pages. Entries are read from Astro's project
 * root, which need not be the working directory (`astro build --root site`).
 */
export function processBuildOutput(
	dir: URL,
	pages: PageInfo[],
	options: ResolvedOptions,
	logger: AstroIntegrationLogger,
	config: AstroConfig,
): Promise<void> {
	const run = () => processPages(dir, pages, options, logger, config)
	return cms ? cms.runAtProjectRoot(fileURLToPath(config.root), run) : run()
}

async function processPages(
	dir: URL,
	pages: PageInfo[],
	options: ResolvedOptions,
	logger: AstroIntegrationLogger,
	config: AstroConfig,
) {
	const baseUrl = getBaseUrl(config)
	const distDir = fileURLToPath(dir)
	let collectionCount = 0
	let staticCount = 0
	const pageEntries: PageEntry[] = []
	let siteMetadata: SiteMetadata = {}
	// Found once for the whole build: resolving a page against a fresh scan made the build quadratic.
	const site = {
		pages: await findCollectionPages(options.contentDir, message => logger.warn(message)),
		syntax: markdownSyntaxOf(config),
	}

	for (const page of pages) {
		const pagePath = normalizePath(page.pathname === '' ? '/' : `/${page.pathname}`)

		try {
			const mdPath = getMdOutputPath(distDir, pagePath)
			const htmlPath = getHtmlPath(distDir, pagePath)

			// Read once, for the markdown and for the link injected into it.
			let html: Promise<string | undefined> | undefined
			const readHtml = () => (html ??= fs.readFile(htmlPath, 'utf-8').catch(() => undefined))

			const resolved = await resolvePageMarkdown(pagePath, options, site, async () => {
				const page = await readHtml()
				return page === undefined ? undefined : htmlToMarkdown(page)
			})
			if (!resolved) continue

			const markdown = generateMarkdown(resolved.output, {
				url: pagePath,
				type: resolved.type,
				sourcePath: resolved.sourcePath,
				baseUrl,
			}, options.includeFrontmatter)

			await writeMarkdownFile(mdPath, markdown)
			pageEntries.push({ pathname: pagePath, title: resolved.title, type: resolved.type })
			if (resolved.type === 'collection') collectionCount++
			else staticCount++

			// The site's title and description, from the rendered homepage, also when an entry tells it.
			if (pagePath === '/') {
				const page = resolved.metadata ? undefined : await readHtml()
				const metadata = resolved.metadata ?? (page === undefined ? undefined : htmlToMarkdown(page).metadata)
				if (metadata) siteMetadata = { title: metadata.title, description: metadata.description }
			}

			// The markdown is written whether or not its link can be added to the page.
			try {
				await injectLinkIntoHtml(htmlPath, pagePath, await readHtml())
			} catch (error) {
				logger.warn(`Failed to link ${pagePath} to its markdown: ${error}`)
			}
		} catch (error) {
			logger.warn(`Failed to process ${pagePath}: ${error}`)
		}
	}

	const total = collectionCount + staticCount
	if (total > 0) {
		logger.info(`Generated ${total} .md files (${collectionCount} collection, ${staticCount} static)`)
	}

	// Generate llm.md if enabled
	if (options.llmEndpoint !== false) {
		if (!baseUrl) {
			logger.warn('Skipping /.well-known/llm.md generation: no `site` configured in astro.config')
		} else {
			try {
				const llmContent = generateLlmMarkdown(pageEntries, { ...siteMetadata, baseUrl }, options.llmEndpoint)
				const llmPath = getLlmOutputPath(distDir)
				await writeMarkdownFile(llmPath, llmContent)
				logger.info('Generated /.well-known/llm.md')
			} catch (error) {
				logger.warn(`Failed to generate llm.md: ${error}`)
			}
		}
	}

	// Generate llms.txt if enabled
	if (options.llmsTxt !== false) {
		if (!baseUrl) {
			logger.warn('Skipping /llms.txt generation: no `site` configured in astro.config')
		} else {
			try {
				const llmsTxtContent = generateLlmsTxt(pageEntries, { ...siteMetadata, baseUrl }, options.llmsTxt)
				const llmsTxtPath = getLlmsTxtOutputPath(distDir)
				await writeMarkdownFile(llmsTxtPath, llmsTxtContent)
				logger.info('Generated /llms.txt')
			} catch (error) {
				logger.warn(`Failed to generate llms.txt: ${error}`)
			}
		}
	}
}

async function injectLinkIntoHtml(htmlPath: string, pagePath: string, html: string | undefined): Promise<void> {
	// Some pages have no HTML file
	if (html === undefined) return
	await fs.writeFile(htmlPath, injectMarkdownLink(html, pagePath), 'utf-8')
}

async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content, 'utf-8')
}
