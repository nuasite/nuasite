import { runAtProjectRoot } from '@nuasite/cms'
import type { AstroConfig, AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanCollectionsForPages } from './cms-marker'
import { htmlToMarkdown, type HtmlToMarkdownResult } from './html-to-markdown'
import { generateLlmMarkdown, type PageEntry, type SiteMetadata } from './llm-endpoint'
import { generateLlmsTxt } from './llms-txt-endpoint'
import { generateMarkdown } from './markdown-generator'
import { resolvePageMarkdown } from './page-markdown'
import { getHtmlPath, getLlmOutputPath, getLlmsTxtOutputPath, getMdOutputPath, injectMarkdownLink, normalizePath } from './paths'
import type { ResolvedOptions } from './types'

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
	return runAtProjectRoot(fileURLToPath(config.root), () => processPages(dir, pages, options, logger, config))
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
	// Scanned once for the whole build: resolving a page against a fresh scan made the build quadratic.
	const collections = await scanCollectionsForPages(options.contentDir, message => logger.warn(message))

	for (const page of pages) {
		const pagePath = normalizePath(page.pathname === '' ? '/' : `/${page.pathname}`)

		try {
			const mdPath = getMdOutputPath(distDir, pagePath)
			const htmlPath = getHtmlPath(distDir, pagePath)

			const resolved = await resolvePageMarkdown(pagePath, options, collections, () => readBuiltPage(htmlPath))
			if (!resolved) continue

			const markdown = generateMarkdown(resolved.output, {
				url: pagePath,
				type: resolved.type,
				sourcePath: resolved.sourcePath,
				baseUrl,
			}, options.includeFrontmatter)

			await writeMarkdownFile(mdPath, markdown)
			await injectLinkIntoHtml(htmlPath, pagePath)
			pageEntries.push({ pathname: pagePath, title: resolved.title, type: resolved.type })

			if (resolved.type === 'collection') {
				collectionCount++
				continue
			}

			// Extract site metadata from homepage
			if (pagePath === '/' && resolved.metadata) {
				siteMetadata = {
					title: resolved.metadata.title,
					description: resolved.metadata.description,
				}
			}

			staticCount++
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

async function injectLinkIntoHtml(htmlPath: string, pagePath: string): Promise<void> {
	try {
		const html = await fs.readFile(htmlPath, 'utf-8')
		await fs.writeFile(htmlPath, injectMarkdownLink(html, pagePath), 'utf-8')
	} catch {
		// File might not exist for some pages
	}
}

/** A built page converted to markdown, or `undefined` when the build wrote no HTML for it. */
async function readBuiltPage(htmlPath: string): Promise<HtmlToMarkdownResult | undefined> {
	let html: string
	try {
		html = await fs.readFile(htmlPath, 'utf-8')
	} catch {
		return undefined
	}
	return htmlToMarkdown(html)
}

async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content, 'utf-8')
}
