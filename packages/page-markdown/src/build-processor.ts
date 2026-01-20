import type { AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getCollectionContent } from './cms-marker'
import { htmlToMarkdown } from './html-to-markdown'
import { createCollectionOutput, createStaticOutput, generateMarkdown } from './markdown-generator'
import { getHtmlPath, getMdOutputPath, injectMarkdownLink, normalizePath } from './paths'
import type { ResolvedOptions } from './types'

interface PageInfo {
	pathname: string
}

/**
 * Process build output and generate .md files for all pages
 */
export async function processBuildOutput(
	dir: URL,
	pages: PageInfo[],
	options: ResolvedOptions,
	logger: AstroIntegrationLogger,
) {
	const distDir = dir.pathname
	let collectionCount = 0
	let staticCount = 0

	for (const page of pages) {
		const pagePath = normalizePath(page.pathname === '' ? '/' : `/${page.pathname}`)

		try {
			const mdPath = getMdOutputPath(distDir, pagePath)
			const htmlPath = getHtmlPath(distDir, pagePath)

			// Try collection page first
			const content = await getCollectionContent(pagePath, options.contentDir)
			if (content) {
				const output = createCollectionOutput(content.frontmatter, content.body, content.file)
				const markdown = generateMarkdown(output, {
					url: pagePath,
					type: 'collection',
					sourcePath: content.file,
				}, options.includeFrontmatter)

				await writeMarkdownFile(mdPath, markdown)
				await injectLinkIntoHtml(htmlPath, pagePath)
				collectionCount++
				continue
			}

			// Fall back to static page handling
			if (!options.includeStaticPages) continue

			const htmlExists = await fileExists(htmlPath)
			if (!htmlExists) continue

			const html = await fs.readFile(htmlPath, 'utf-8')
			const { metadata, body } = htmlToMarkdown(html)
			const output = createStaticOutput(metadata, body)

			const markdown = generateMarkdown(output, {
				url: pagePath,
				type: 'static',
			}, options.includeFrontmatter)

			await writeMarkdownFile(mdPath, markdown)
			await injectLinkIntoHtml(htmlPath, pagePath)
			staticCount++
		} catch (error) {
			logger.warn(`Failed to process ${pagePath}: ${error}`)
		}
	}

	const total = collectionCount + staticCount
	if (total > 0) {
		logger.info(`Generated ${total} .md files (${collectionCount} collection, ${staticCount} static)`)
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

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content, 'utf-8')
}
