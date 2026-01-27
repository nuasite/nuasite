import type { AstroIntegrationLogger } from 'astro'
import { parse } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import {
	clearSourceFinderCache,
	findCollectionSource,
	findImageSourceLocation,
	findMarkdownSourceLocation,
	findSourceLocation,
	initializeSearchIndex,
	parseMarkdownContent,
} from './source-finder'
import type { CmsMarkerOptions, CollectionEntry } from './types'

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

	// First, try to detect if this page is from a content collection
	// We need to know this BEFORE processing HTML to skip marking markdown-rendered elements
	const collectionInfo = await findCollectionSource(pagePath, config.contentDir)
	const isCollectionPage = !!collectionInfo

	// Parse markdown content early if this is a collection page
	// We need the body content to find the wrapper element during HTML processing
	let mdContent: Awaited<ReturnType<typeof parseMarkdownContent>> | undefined
	if (collectionInfo) {
		mdContent = await parseMarkdownContent(collectionInfo)
	}

	// Get the first non-empty line of the markdown body for wrapper detection
	const bodyFirstLine = mdContent?.body
		?.split('\n')
		.find((line) => line.trim().length > 0)
		?.trim()

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

	// During build, source location attributes are not injected by astro-transform.ts
	// (disabled to avoid Vite parse errors). Use findSourceLocation to look up source files.

	let collectionEntry: CollectionEntry | undefined

	// Build collection entry if this is a collection page
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

	// Process entries in parallel for better performance
	const entryLookups = Object.values(result.entries).map(async (entry) => {
		// Skip entries that already have source info from component detection
		if (entry.sourcePath && !entry.sourcePath.endsWith('.html')) {
			return
		}

		// Handle image entries specially - search by image src
		if (entry.sourceType === 'image' && entry.imageMetadata?.src) {
			const imageSource = await findImageSourceLocation(entry.imageMetadata.src)
			if (imageSource) {
				entry.sourcePath = imageSource.file
				entry.sourceLine = imageSource.line
				entry.sourceSnippet = imageSource.snippet
				entry.sourceType = 'image'
			}
			return
		}

		// Try to find source in collection markdown frontmatter first
		if (collectionInfo) {
			const mdSource = await findMarkdownSourceLocation(entry.text, collectionInfo)
			if (mdSource) {
				entry.sourcePath = mdSource.file
				entry.sourceLine = mdSource.line
				entry.sourceSnippet = mdSource.snippet
				entry.sourceType = mdSource.type
				entry.variableName = mdSource.variableName
				entry.collectionName = mdSource.collectionName
				entry.collectionSlug = mdSource.collectionSlug
				return
			}
		}

		// Fall back to searching Astro files
		const sourceLocation = await findSourceLocation(entry.text, entry.tag)
		if (sourceLocation) {
			entry.sourcePath = sourceLocation.file
			entry.sourceLine = sourceLocation.line
			entry.sourceSnippet = sourceLocation.snippet
			entry.sourceType = sourceLocation.type
			entry.variableName = sourceLocation.variableName
		}
	})

	await Promise.all(entryLookups)

	// Filter out entries without sourcePath - these can't be edited
	const idsToRemove: string[] = []
	for (const [id, entry] of Object.entries(result.entries)) {
		// Keep collection wrapper entries even without sourcePath (they use contentPath)
		if (entry.sourceType === 'collection') continue
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

	// Add to manifest writer (handles per-page manifest writes)
	manifestWriter.addPage(pagePath, result.entries, result.components, collectionEntry)

	// Write transformed HTML back
	await fs.writeFile(filePath, finalHtml, 'utf-8')

	return Object.keys(result.entries).length
}

/** Result of batch processing with error aggregation */
interface BatchProcessingResult {
	totalEntries: number
	errors: Array<{ file: string; error: Error }>
}

/**
 * Process HTML files in parallel with concurrency limit and error aggregation.
 * Unlike Promise.all, this continues processing even if some files fail.
 */
async function processFilesInBatches(
	files: string[],
	outDir: string,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	idCounter: { value: number },
): Promise<BatchProcessingResult> {
	let totalEntries = 0
	const errors: Array<{ file: string; error: Error }> = []

	// Process files in batches of MAX_CONCURRENT
	for (let i = 0; i < files.length; i += MAX_CONCURRENT) {
		const batch = files.slice(i, i + MAX_CONCURRENT)
		const results = await Promise.allSettled(
			batch.map(file =>
				processFile(file, outDir, config, manifestWriter, idCounter)
					.then(count => ({ file, count }))
					.catch(err => Promise.reject({ file, error: err }))
			),
		)

		for (const result of results) {
			if (result.status === 'fulfilled') {
				totalEntries += result.value.count
			} else {
				const { file, error } = result.reason as { file: string; error: Error }
				errors.push({ file, error })
			}
		}
	}

	return { totalEntries, errors }
}

/**
 * Process build output - processes all HTML files in parallel.
 * Uses error aggregation to continue processing even if some files fail.
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

	// Clear caches from previous builds and initialize search index
	clearSourceFinderCache()

	const htmlFiles = await findHtmlFiles(outDir)

	if (htmlFiles.length === 0) {
		logger?.info('No HTML files found to process')
		return
	}

	const startTime = Date.now()

	// Pre-build search index for fast source lookups (single pass through all source files)
	await initializeSearchIndex()

	// Process all files in parallel batches with error aggregation
	const { totalEntries, errors } = await processFilesInBatches(htmlFiles, outDir, config, manifestWriter, idCounter)

	// Report any errors that occurred during processing
	if (errors.length > 0) {
		const errorLog = logger?.error?.bind(logger) ?? console.error.bind(console)
		errorLog(`[astro-cms-marker] ${errors.length} file(s) failed to process:`)
		for (const { file, error } of errors) {
			const relPath = path.relative(outDir, file)
			errorLog(`  - ${relPath}: ${error.message}`)
		}
	}

	// Finalize manifest (writes global manifest and waits for all per-page writes)
	const stats = await manifestWriter.finalize()

	const duration = Date.now() - startTime
	const successCount = htmlFiles.length - errors.length
	const msg =
		`Processed ${successCount}/${htmlFiles.length} pages with ${stats.totalEntries} entries and ${stats.totalComponents} components in ${duration}ms`

	if (logger) {
		if (errors.length > 0) {
			logger.warn(msg)
		} else {
			logger.info(msg)
		}
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
