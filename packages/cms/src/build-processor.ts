import type { AstroIntegrationLogger } from 'astro'
import { parse } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getProjectRoot } from './config'
import { extractPropsFromSource, findComponentInvocationLine } from './handlers/component-ops'
import { extractComponentName, processHtml } from './html-processor'
import type { ManifestWriter } from './manifest-writer'
import { generateComponentPreviews } from './preview-generator'
import {
	clearSourceFinderCache,
	extractOpeningTagWithLine,
	findCollectionSource,
	findImageSourceLocation,
	findMarkdownSourceLocation,
	findSourceLocation,
	initializeSearchIndex,
	parseMarkdownContent,
	updateAttributeSources,
	updateColorClassSources,
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
 * Cluster entries from the same source file into separate component instances.
 * When a component is used multiple times on a page, its entries are in different
 * subtrees. We partition by finding which direct child of the LCA each entry belongs to.
 */
export function clusterComponentEntries<T>(
	elements: T[],
	entryIds: string[],
	findLCA: (els: T[]) => T | null,
): Array<{ clusterEntryIds: string[]; clusterElements: T[] }> {
	if (elements.length <= 1) {
		return [{ clusterEntryIds: [...entryIds], clusterElements: [...elements] }]
	}

	const lca = findLCA(elements)
	if (!lca) {
		return [{ clusterEntryIds: [...entryIds], clusterElements: [...elements] }]
	}

	// If any entry is a direct child of the LCA, the LCA is the component
	// root itself — don't split its content into separate instances.
	// Only split when ALL entries are behind intermediate wrapper elements.
	const anyDirectChild = elements.some(
		(el: any) => el.parentNode === lca,
	)
	if (anyDirectChild) {
		return [{ clusterEntryIds: [...entryIds], clusterElements: [...elements] }]
	}

	// Group entries by which direct child of the LCA they fall under.
	// Entries under different intermediate subtrees belong to different instances.
	const childGroups = new Map<unknown, { clusterEntryIds: string[]; clusterElements: T[] }>()

	for (let i = 0; i < elements.length; i++) {
		let current: any = elements[i]
		while (current && current.parentNode !== lca) {
			current = current.parentNode
		}
		if (!current) continue

		const existing = childGroups.get(current)
		if (existing) {
			existing.clusterEntryIds.push(entryIds[i]!)
			existing.clusterElements.push(elements[i]!)
		} else {
			childGroups.set(current, {
				clusterEntryIds: [entryIds[i]!],
				clusterElements: [elements[i]!],
			})
		}
	}

	if (childGroups.size > 1) {
		// Multiple subtrees → each is a separate component instance
		return Array.from(childGroups.values())
	}

	// All entries are in the same subtree → single instance
	return [{ clusterEntryIds: [...entryIds], clusterElements: [...elements] }]
}

interface PageComponentInvocation {
	componentName: string
	sourceFile: string
	/** Template offset for ordering invocations */
	offset: number
}

/**
 * Find the .astro source file for a page given its URL path.
 */
async function findPageSource(pagePath: string): Promise<string | null> {
	const projectRoot = getProjectRoot()
	const candidates: string[] = []

	if (pagePath === '/' || pagePath === '') {
		candidates.push(path.join(projectRoot, 'src/pages/index.astro'))
	} else {
		const cleanPath = pagePath.replace(/^\//, '')
		candidates.push(
			path.join(projectRoot, `src/pages/${cleanPath}.astro`),
			path.join(projectRoot, `src/pages/${cleanPath}/index.astro`),
		)
	}

	for (const candidate of candidates) {
		try {
			await fs.access(candidate)
			return candidate
		} catch {}
	}
	return null
}

/**
 * Parse an .astro page source file to find component invocations.
 * Returns an ordered list of component usages (including duplicates).
 */
async function parseComponentInvocations(
	pageSourcePath: string,
	componentDirs: string[],
): Promise<PageComponentInvocation[]> {
	const content = await fs.readFile(pageSourcePath, 'utf-8')
	const projectRoot = getProjectRoot()
	const pageDir = path.dirname(pageSourcePath)

	// Split frontmatter from template
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!fmMatch) return []
	const frontmatter = fmMatch[1]!
	const templateStart = fmMatch[0].length
	const template = content.slice(templateStart)

	// Parse import statements to map component names to source files
	const imports = new Map<string, string>() // componentName -> relative source path
	const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
	let match: RegExpMatchArray | null
	while ((match = importRegex.exec(frontmatter)) !== null) {
		const name = match[1]!
		const importPath = match[2]!

		// Resolve the import path relative to the page file
		const resolved = path.resolve(pageDir, importPath)
		const relToProject = path.relative(projectRoot, resolved)

		// Check if it's in a component directory
		const isComponent = componentDirs.some(dir => {
			const d = dir.replace(/^\/+|\/+$/g, '')
			return relToProject.startsWith(d + '/') || relToProject.startsWith(d + path.sep)
		})
		if (isComponent) {
			imports.set(name, relToProject)
		}
	}

	if (imports.size === 0) return []

	// Find component invocations in the template (both self-closing and paired tags)
	const invocations: PageComponentInvocation[] = []
	for (const [componentName, sourceFile] of imports) {
		const tagRegex = new RegExp(`<${componentName}[\\s/>]`, 'g')
		let tagMatch: RegExpExecArray | null
		while ((tagMatch = tagRegex.exec(template)) !== null) {
			invocations.push({
				componentName,
				sourceFile,
				offset: tagMatch.index,
			})
		}
	}

	// Sort by position in template (invocation order)
	invocations.sort((a, b) => a.offset - b.offset)

	return invocations
}

/**
 * Detect components that have no text entries by parsing the page source file.
 * After entry-based components are detected, this finds any remaining component
 * invocations and assigns them to unclaimed DOM elements using invocation order.
 */
async function detectEntrylessComponents(
	pagePath: string,
	root: ReturnType<typeof parse>,
	components: Record<string, import('./types').ComponentInstance>,
	componentDirs: string[],
	relPath: string,
	idGenerator: () => string,
	markComponentRoot: (el: any, sourceFile: string, entryIds: string[]) => void,
): Promise<void> {
	const pageSourcePath = await findPageSource(pagePath)
	if (!pageSourcePath) return

	const invocations = await parseComponentInvocations(pageSourcePath, componentDirs)
	if (invocations.length === 0) return

	// Collect all detected component root elements in DOM order
	const detectedRoots: Array<{ el: any; componentName: string }> = []
	const compEls = root.querySelectorAll('[data-cms-component-id]')
	for (const el of compEls) {
		const compId = el.getAttribute('data-cms-component-id')
		if (compId && components[compId]) {
			detectedRoots.push({ el, componentName: components[compId].componentName })
		}
	}

	if (detectedRoots.length === 0 && invocations.length === 0) return

	// Find the container: parent of all detected component roots
	// If no components detected yet, we can't determine the container
	if (detectedRoots.length === 0) return

	const container = detectedRoots[0]?.el.parentNode
	if (!container || !container.childNodes) return

	// Verify all detected roots share the same parent
	const allSameParent = detectedRoots.every(r => r.el.parentNode === container)
	if (!allSameParent) return

	// Get the container's element children in DOM order
	const containerChildren: any[] = []
	for (const child of container.childNodes) {
		// Only consider element nodes (nodeType 1)
		if (child.nodeType === 1) {
			containerChildren.push(child)
		}
	}

	// Build a paired mapping between invocations and container children.
	// Detected components serve as anchor points; undetected children between
	// anchors are assigned to the corresponding unmatched invocations in order.

	// First, find anchor points: container children that are already detected
	const anchorMap = new Map<number, string>() // childIdx → componentName
	for (let ci = 0; ci < containerChildren.length; ci++) {
		const compId = containerChildren[ci].getAttribute?.('data-cms-component-id')
		if (compId && components[compId]) {
			anchorMap.set(ci, components[compId].componentName)
		}
	}

	// Walk both lists, using anchors to stay in sync
	let invIdx = 0
	for (let ci = 0; ci < containerChildren.length && invIdx < invocations.length; ci++) {
		const anchorName = anchorMap.get(ci)

		if (anchorName) {
			// This child is a detected component. Find the matching invocation.
			while (invIdx < invocations.length && invocations[invIdx]!.componentName !== anchorName) {
				invIdx++
			}
			if (invIdx < invocations.length) {
				invIdx++ // consume the matched invocation
			}
		} else {
			// Undetected child - assign it to the current invocation
			const inv = invocations[invIdx]!
			// Only assign if the invocation's component isn't already detected at a later anchor
			markComponentRoot(containerChildren[ci], inv.sourceFile, [])
			invIdx++
		}
	}
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
				? { name: collectionInfo.name, slug: collectionInfo.slug, bodyFirstLine, bodyText: mdContent?.body, contentPath: collectionInfo.file }
				: undefined,
			// Pass SEO options
			seo: config.seo,
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
		// Handle image entries specially - always search by image src
		// The sourcePath from HTML attributes may point to a shared Image component
		// rather than the file that actually uses the component with the src value
		if (entry.imageMetadata?.src) {
			const imageSource = await findImageSourceLocation(entry.imageMetadata.src, entry.imageMetadata.srcSet)
			if (imageSource) {
				entry.sourcePath = imageSource.file
				entry.sourceLine = imageSource.line
				entry.sourceSnippet = imageSource.snippet
			}
			return
		}

		// Skip entries that already have source info from component detection
		if (entry.sourcePath && !entry.sourcePath.endsWith('.html')) {
			return
		}

		// Try to find source in collection markdown frontmatter first
		if (collectionInfo) {
			const mdSource = await findMarkdownSourceLocation(entry.text, collectionInfo)
			if (mdSource) {
				entry.sourcePath = mdSource.file
				entry.sourceLine = mdSource.line
				entry.sourceSnippet = mdSource.snippet
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
			entry.variableName = sourceLocation.variableName

			// Update attribute and colorClasses source information if we have an opening tag
			if (sourceLocation.openingTagSnippet) {
				const filePath = path.isAbsolute(sourceLocation.file)
					? sourceLocation.file
					: path.join(getProjectRoot(), sourceLocation.file)
				try {
					const content = await fs.readFile(filePath, 'utf-8')
					const lines = content.split('\n')
					const tagInfo = extractOpeningTagWithLine(lines, sourceLocation.line - 1, entry.tag)
					const startLine = tagInfo ? tagInfo.startLine + 1 : undefined

					if (entry.attributes) {
						entry.attributes = await updateAttributeSources(
							sourceLocation.openingTagSnippet,
							entry.attributes,
							sourceLocation.file,
							startLine,
							lines,
						)
					}
					if (entry.colorClasses) {
						entry.colorClasses = updateColorClassSources(
							sourceLocation.openingTagSnippet,
							entry.colorClasses,
							sourceLocation.file,
							startLine,
							lines,
						)
					}
				} catch {
					// Couldn't read file - still update without source lines
					if (entry.attributes) {
						entry.attributes = await updateAttributeSources(
							sourceLocation.openingTagSnippet,
							entry.attributes,
							sourceLocation.file,
						)
					}
					if (entry.colorClasses) {
						entry.colorClasses = updateColorClassSources(
							sourceLocation.openingTagSnippet,
							entry.colorClasses,
							sourceLocation.file,
						)
					}
				}
			}
		}
	})

	await Promise.all(entryLookups)

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

	// Post-process: detect component roots from resolved entry source paths
	// In production builds, data-astro-source-file is not available so processHtml
	// cannot detect components. We infer them from the resolved sourcePath of entries.
	const componentDirs = config.componentDirs ?? ['src/components']
	const excludeComponentDirs = ['src/pages', 'src/layouts', 'src/layout']

	if (config.markComponents) {
		// Group entries by their source file (only component files)
		const entriesBySourceFile = new Map<string, string[]>()
		for (const [id, entry] of Object.entries(result.entries)) {
			if (!entry.sourcePath) continue
			const sp = entry.sourcePath

			const isExcluded = excludeComponentDirs.some(dir => {
				const d = dir.replace(/^\/+|\/+$/g, '')
				return sp.startsWith(d + '/') || sp.includes('/' + d + '/')
			})
			if (isExcluded) continue

			const isComponent = componentDirs.some(dir => {
				const d = dir.replace(/^\/+|\/+$/g, '')
				return sp.startsWith(d + '/') || sp.includes('/' + d + '/')
			})
			if (!isComponent) continue

			const existing = entriesBySourceFile.get(sp)
			if (existing) {
				existing.push(id)
			} else {
				entriesBySourceFile.set(sp, [id])
			}
		}

		const root = parse(result.html, {
			lowerCaseTagName: false,
			comment: true,
		})

		// Helper: find lowest common ancestor of DOM elements
		type HTMLNode = ReturnType<typeof root.querySelector>
		const findLCA = (elements: NonNullable<HTMLNode>[]): HTMLNode => {
			if (elements.length === 0) return null
			if (elements.length === 1) return elements[0]!

			const getAncestors = (el: HTMLNode): HTMLNode[] => {
				const ancestors: HTMLNode[] = []
				let current = el?.parentNode as HTMLNode
				while (current) {
					ancestors.unshift(current)
					current = current.parentNode as HTMLNode
				}
				return ancestors
			}

			const chains = elements.map(el => getAncestors(el))
			const minLen = Math.min(...chains.map(c => c.length))
			let lcaIdx = 0
			for (let i = 0; i < minLen; i++) {
				if (chains.every(chain => chain[i] === chains[0]![i])) {
					lcaIdx = i
				} else {
					break
				}
			}
			return chains[0]![lcaIdx] ?? null
		}

		// Helper: mark an element as a component root and register the instance
		const markComponentRoot = (
			lca: NonNullable<HTMLNode>,
			sourceFile: string,
			instanceEntryIds: string[],
		) => {
			if (!('setAttribute' in lca) || !('getAttribute' in lca)) return
			if (lca.getAttribute?.('data-cms-component-id')) return

			const compId = idGenerator()
			lca.setAttribute('data-cms-component-id', compId)

			const componentName = extractComponentName(sourceFile)
			const firstEntry = instanceEntryIds.length > 0 ? result.entries[instanceEntryIds[0]!] : undefined

			result.components[compId] = {
				id: compId,
				componentName,
				file: relPath,
				sourcePath: sourceFile,
				sourceLine: firstEntry?.sourceLine ?? 1,
				props: {},
			}

			for (const eid of instanceEntryIds) {
				const entry = result.entries[eid]
				if (entry) {
					entry.parentComponentId = compId
				}
			}
		}

		// For each component source file, cluster entries into separate instances
		// by partitioning them based on which subtree of their common ancestor they belong to
		if (entriesBySourceFile.size > 0) {
			for (const [sourceFile, entryIds] of entriesBySourceFile) {
				const elements = entryIds
					.map(id => root.querySelector(`[${config.attributeName}="${id}"]`))
					.filter((el): el is NonNullable<HTMLNode> => el !== null)

				if (elements.length === 0) continue

				// Cluster entries into separate component instances
				const clusters = clusterComponentEntries(elements, entryIds, findLCA)

				for (const { clusterEntryIds, clusterElements } of clusters) {
					let lca = findLCA(clusterElements)

					// If the LCA is a text element itself (only one entry),
					// use its parent so the component wraps the element
					if (lca && clusterElements.length === 1 && lca === clusterElements[0]) {
						lca = lca.parentNode as HTMLNode
					}

					if (!lca) continue
					markComponentRoot(lca, sourceFile, clusterEntryIds)
				}
			}
		}

		// Detect components without text entries by parsing the page source file
		await detectEntrylessComponents(
			pagePath,
			root,
			result.components,
			componentDirs,
			relPath,
			idGenerator,
			markComponentRoot,
		)

		// Re-serialize HTML with component markers
		result.html = root.toString()
	}

	// Populate component props from page source invocations
	if (Object.keys(result.components).length > 0) {
		const pageSourcePath = await findPageSource(pagePath)
		if (pageSourcePath) {
			try {
				const pageContent = await fs.readFile(pageSourcePath, 'utf-8')
				const pageLines = pageContent.split('\n')

				// Track per-component-name occurrence counter
				const occurrenceCounts = new Map<string, number>()

				for (const comp of Object.values(result.components)) {
					const idx = occurrenceCounts.get(comp.componentName) ?? 0
					occurrenceCounts.set(comp.componentName, idx + 1)

					const invLine = findComponentInvocationLine(pageLines, comp.componentName, idx)
					if (invLine >= 0) {
						comp.props = extractPropsFromSource(pageLines, invLine, comp.componentName)
					}
				}
			} catch {
				// Could not read page source — leave props empty
			}
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
	manifestWriter.addPage(pagePath, result.entries, result.components, collectionEntry, result.seo)

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
		errorLog(`[cms] ${errors.length} file(s) failed to process:`)
		for (const { file, error } of errors) {
			const relPath = path.relative(outDir, file)
			errorLog(`  - ${relPath}: ${error.message}`)
		}
	}

	// Generate component preview pages before finalizing manifest
	// (preview URLs are written into componentDefinitions in-place)
	await generateComponentPreviews(
		outDir,
		manifestWriter.getPageDataForPreviews(),
		manifestWriter.getComponentDefinitions(),
	)

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
		console.log(`[cms] ${msg}`)
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
