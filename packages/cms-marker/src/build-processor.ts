import type { AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import type { CmsMarkerOptions } from './types'

// Concurrency limit for parallel processing
const MAX_CONCURRENT = 10

/**
 * Get the page path from an HTML file path
 * For example: /about/index.html -> /about
 *              /index.html -> /
 *              /blog/post.html -> /blog/post
 */
function getPagePath(htmlPath: string, outDir: string): string {
	const relPath = path.relative(outDir, htmlPath)
	const parts = relPath.split(path.sep)

	// Handle index.html files
	if (parts[parts.length - 1] === 'index.html') {
		parts.pop()
		return '/' + parts.join('/')
	}

	// Handle other .html files (remove extension)
	const last = parts[parts.length - 1]
	if (last) {
		parts[parts.length - 1] = last.replace('.html', '')
	}
	return '/' + parts.join('/')
}

/**
 * Process a single HTML file
 */
async function processFile(
	filePath: string,
	outDir: string,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	idCounter: { value: number },
): Promise<number> {
	const relPath = path.relative(outDir, filePath)
	const pagePath = getPagePath(filePath, outDir)
	const html = await fs.readFile(filePath, 'utf-8')

	// Create ID generator - use atomic increment
	const pageIdStart = idCounter.value
	const idGenerator = () => `cms-${idCounter.value++}`

	const result = await processHtml(
		html,
		relPath,
		{
			attributeName: config.attributeName,
			includeTags: config.includeTags,
			excludeTags: config.excludeTags,
			includeEmptyText: config.includeEmptyText,
			generateManifest: config.generateManifest,
			markComponents: config.markComponents,
			componentDirs: config.componentDirs,
		},
		idGenerator,
	)

	// Note: Source locations are now extracted from Astro's compiler attributes
	// in html-processor.ts, so we don't need the expensive findSourceLocation calls

	// Add to manifest writer (handles per-page manifest writes)
	manifestWriter.addPage(pagePath, result.entries, result.components)

	// Write transformed HTML back
	await fs.writeFile(filePath, result.html, 'utf-8')

	return Object.keys(result.entries).length
}

/**
 * Process HTML files in parallel with concurrency limit
 */
async function processFilesInBatches(
	files: string[],
	outDir: string,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	idCounter: { value: number },
): Promise<number> {
	let totalEntries = 0

	// Process files in batches of MAX_CONCURRENT
	for (let i = 0; i < files.length; i += MAX_CONCURRENT) {
		const batch = files.slice(i, i + MAX_CONCURRENT)
		const results = await Promise.all(
			batch.map(file => processFile(file, outDir, config, manifestWriter, idCounter)),
		)
		totalEntries += results.reduce((sum, count) => sum + count, 0)
	}

	return totalEntries
}

/**
 * Process build output - processes all HTML files in parallel
 */
export async function processBuildOutput(
	dir: URL,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	idCounter: { value: number },
	logger?: AstroIntegrationLogger,
): Promise<void> {
	const outDir = fileURLToPath(dir)
	manifestWriter.setOutDir(outDir)

	const htmlFiles = await findHtmlFiles(outDir)

	if (htmlFiles.length === 0) {
		logger?.info('No HTML files found to process')
		return
	}

	const startTime = Date.now()

	// Process all files in parallel batches
	await processFilesInBatches(htmlFiles, outDir, config, manifestWriter, idCounter)

	// Finalize manifest (writes global manifest and waits for all per-page writes)
	const stats = await manifestWriter.finalize()

	const duration = Date.now() - startTime
	const msg = `Processed ${stats.totalPages} pages with ${stats.totalEntries} entries and ${stats.totalComponents} components in ${duration}ms`

	if (logger) {
		logger.info(msg)
	} else {
		console.log(`[astro-cms-marker] ${msg}`)
	}
}

/**
 * Recursively find all HTML files in a directory (parallel version)
 */
async function findHtmlFiles(dir: string): Promise<string[]> {
	const result: string[] = []

	async function scan(currentDir: string): Promise<void> {
		const entries = await fs.readdir(currentDir, { withFileTypes: true })

		await Promise.all(entries.map(async (entry) => {
			const fullPath = path.join(currentDir, entry.name)
			if (entry.isDirectory()) {
				await scan(fullPath)
			} else if (entry.isFile() && fullPath.endsWith('.html')) {
				result.push(fullPath)
			}
		}))
	}

	await scan(dir)
	return result
}
