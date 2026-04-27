import type { ComponentNode, ElementNode, Node as AstroNode, TextNode } from '@astrojs/compiler/types'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import { escapeRegex } from '../utils'
import { buildDefinitionPath, parseExpressionPath } from './ast-extractors'
import { getCachedParsedFile } from './ast-parser'
import {
	addToImageSearchIndex,
	addToTextSearchIndex,
	clearDirtyFiles,
	getDirectoryCache,
	getDirtyFiles,
	getImageSearchIndex,
	getMarkdownFileCache,
	getTextSearchIndex,
	getTranslationKeyIndex,
	isSearchIndexInitialized,
	removeFileFromIndexes,
	setCollectionTextIndex,
	setSearchIndexInitialized,
} from './cache'
import { extractAstroImageOriginalUrl, extractImageSnippet, extractInnerHtmlFromSnippet, normalizeText } from './snippet-utils'
import type { CachedParsedFile, SearchIndexEntry, SourceLocation } from './types'

/** Collection data files live under this path — used to prefer them over templates */
const CONTENT_DIR_PREFIX = 'src/content/'

function isCollectionFile(file: string): boolean {
	return file.includes(CONTENT_DIR_PREFIX)
}

// ============================================================================
// File Collection
// ============================================================================

/**
 * Collect all .astro files in a directory recursively
 */
export async function collectAstroFiles(dir: string): Promise<string[]> {
	const cache = getDirectoryCache()
	const cached = cache.get(dir)
	if (cached) return cached

	const results: string[] = []

	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		await Promise.all(entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				const subFiles = await collectAstroFiles(fullPath)
				results.push(...subFiles)
			} else if (entry.isFile() && (entry.name.endsWith('.astro') || entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
				results.push(fullPath)
			}
		}))
	} catch {
		// Directory doesn't exist
	}

	cache.set(dir, results)
	return results
}

// ============================================================================
// Index Initialization
// ============================================================================

/** Shared promise so concurrent callers wait for the same initialization */
let initPromise: Promise<void> | null = null

/**
 * Initialize search index by pre-scanning all source files.
 * This is much faster than searching per-entry.
 * Safe to call concurrently — all callers share the same initialization.
 */
export async function initializeSearchIndex(): Promise<void> {
	if (isSearchIndexInitialized()) return
	if (initPromise) return initPromise
	initPromise = doInitializeSearchIndex()
	try {
		await initPromise
	} finally {
		initPromise = null
	}
}

async function doInitializeSearchIndex(): Promise<void> {
	const srcDir = path.join(getProjectRoot(), 'src')
	const searchDirs = [
		path.join(srcDir, 'components'),
		path.join(srcDir, 'pages'),
		path.join(srcDir, 'layouts'),
	]

	// Collect all Astro files first
	const allFiles: string[] = []
	for (const dir of searchDirs) {
		try {
			const files = await collectAstroFiles(dir)
			allFiles.push(...files)
		} catch {
			// Directory doesn't exist
		}
	}

	// Parse all files in parallel and build indexes
	await Promise.all(allFiles.map(async (filePath) => {
		try {
			const cached = await getCachedParsedFile(filePath)
			if (!cached) return

			const relFile = path.relative(getProjectRoot(), filePath)

			// Index all text content from this file
			indexFileContent(cached, relFile)

			// Index all images from this file
			indexFileImages(cached, relFile)
		} catch {
			// Skip files that fail to parse
		}
	}))

	// Index image-like values from content collection data files (JSON/YAML)
	await indexContentCollectionImages()

	// Index text values from translation dictionary files (JSON) under i18n/locales folders.
	// Enables lookups for `{t(locale, 'key')}`-rendered content whose text lives in JSON.
	await indexTranslationFiles()

	setSearchIndexInitialized(true)
}

// ============================================================================
// Incremental Re-indexing
// ============================================================================

/** Shared promise so concurrent callers wait for the same re-indexing */
let reindexPromise: Promise<void> | null = null

/**
 * Re-index only files that changed since the last indexing.
 * Much faster than a full rebuild — only re-parses dirty files.
 * Safe to call concurrently — all callers share the same operation.
 *
 * Also clears the markdown file cache so collection content is re-read.
 */
export async function reindexDirtyFiles(): Promise<void> {
	const dirty = getDirtyFiles()
	if (dirty.size === 0) return
	if (reindexPromise) return reindexPromise
	reindexPromise = doReindexDirtyFiles()
	try {
		await reindexPromise
	} finally {
		reindexPromise = null
	}
}

async function doReindexDirtyFiles(): Promise<void> {
	const dirty = getDirtyFiles()
	if (dirty.size === 0) return

	const projectRoot = getProjectRoot()
	const filesToReindex = [...dirty]
	clearDirtyFiles()

	// Also clear the markdown file cache and collection text index
	// so collection content is re-read and re-indexed from disk
	getMarkdownFileCache().clear()
	setCollectionTextIndex(null)

	for (const absPath of filesToReindex) {
		const relFile = path.relative(projectRoot, absPath)

		// Remove old entries for this file
		removeFileFromIndexes(relFile)

		// Re-parse and re-index if it's a source file
		if (absPath.endsWith('.astro') || absPath.endsWith('.tsx') || absPath.endsWith('.jsx')) {
			try {
				const cached = await getCachedParsedFile(absPath)
				if (cached) {
					indexFileContent(cached, relFile)
					indexFileImages(cached, relFile)
				}
			} catch {
				// Skip files that fail to parse
			}
		} else if (/\.(json|ya?ml|mdx?)$/.test(absPath)) {
			// Content collection data file — re-index images from it
			try {
				const content = await fs.readFile(absPath, 'utf-8')
				if (absPath.endsWith('.json')) {
					indexJsonImages(content, relFile)
					if (isTranslationFilePath(absPath)) {
						indexJsonTextValues(content, relFile)
					}
				} else if (absPath.endsWith('.yaml') || absPath.endsWith('.yml')) {
					indexYamlImages(content, relFile)
				} else if (absPath.endsWith('.md') || absPath.endsWith('.mdx')) {
					indexFrontmatterImages(content, relFile)
				}
			} catch {
				// Skip unreadable files
			}
		}
	}
}

// ============================================================================
// Content Indexing
// ============================================================================

// Helper for indexing - get text content from node
// Treats <br> elements as whitespace to match rendered HTML behavior
function getTextContent(node: AstroNode): string {
	if (node.type === 'text') {
		return (node as TextNode).value
	}
	// Treat <br> elements as whitespace (they create line breaks in rendered HTML)
	if (node.type === 'element' && (node as ElementNode).name.toLowerCase() === 'br') {
		return ' '
	}
	// Treat <wbr> elements as empty (word break opportunity, no visible content)
	if (node.type === 'element' && (node as ElementNode).name.toLowerCase() === 'wbr') {
		return ''
	}
	if ('children' in node && Array.isArray(node.children)) {
		return node.children.map(getTextContent).join('')
	}
	return ''
}

// Helper for indexing - check for expression children
function hasExpressionChild(node: AstroNode): { found: boolean; varNames: string[] } {
	const varNames: string[] = []
	if (node.type === 'expression') {
		const exprText = getTextContent(node)
		const fullPath = parseExpressionPath(exprText)
		if (fullPath) {
			varNames.push(fullPath)
		}
		return { found: true, varNames }
	}
	if ('children' in node && Array.isArray(node.children)) {
		for (const child of node.children) {
			const result = hasExpressionChild(child)
			if (result.found) {
				varNames.push(...result.varNames)
			}
		}
	}
	return { found: varNames.length > 0, varNames }
}

/**
 * Extract complete tag snippet including content and indentation.
 * Local version for indexing (to avoid circular dependency)
 */
function extractCompleteTagSnippet(lines: string[], startLine: number, tag: string): string {
	const escapedTag = escapeRegex(tag)
	const openTagPattern = new RegExp(`<${escapedTag}(?:[\\s>]|$)`, 'gi')

	let actualStartLine = startLine
	const startLineContent = lines[startLine] || ''
	if (!openTagPattern.test(startLineContent)) {
		for (let i = startLine - 1; i >= Math.max(0, startLine - 20); i--) {
			const line = lines[i]
			if (!line) continue
			openTagPattern.lastIndex = 0
			if (openTagPattern.test(line)) {
				actualStartLine = i
				break
			}
		}
	}

	const snippetLines: string[] = []
	let depth = 0
	let foundClosing = false

	for (let i = actualStartLine; i < Math.min(actualStartLine + 30, lines.length); i++) {
		const line = lines[i]
		if (!line) continue

		snippetLines.push(line)

		const openTags = (line.match(new RegExp(`<${escapedTag}(?:[\\s>]|$)`, 'gi')) || []).length
		const selfClosing = (line.match(new RegExp(`<${escapedTag}[^>]*/>`, 'gi')) || []).length
		const closeTags = (line.match(new RegExp(`</${escapedTag}>`, 'gi')) || []).length

		depth += openTags - selfClosing - closeTags

		if (selfClosing > 0 || (depth <= 0 && (closeTags > 0 || openTags > 0))) {
			foundClosing = true
			break
		}
	}

	if (!foundClosing && snippetLines.length > 1) {
		return snippetLines[0]!
	}

	return snippetLines.join('\n')
}

/**
 * Extract the opening tag from source lines with its start line number.
 * Local version for indexing (to avoid circular dependency)
 */
function extractOpeningTagWithLine(
	lines: string[],
	startLine: number,
	tag: string,
): { snippet: string; startLine: number } | undefined {
	const escapedTag = escapeRegex(tag)
	const openTagPattern = new RegExp(`<${escapedTag}(?:[\\s>]|$)`, 'gi')

	let actualStartLine = startLine
	const startLineContent = lines[startLine] || ''
	if (!openTagPattern.test(startLineContent)) {
		for (let i = startLine - 1; i >= Math.max(0, startLine - 20); i--) {
			const line = lines[i]
			if (!line) continue
			openTagPattern.lastIndex = 0
			if (openTagPattern.test(line)) {
				actualStartLine = i
				break
			}
		}
	}

	const snippetLines: string[] = []
	for (let i = actualStartLine; i < Math.min(actualStartLine + 10, lines.length); i++) {
		const line = lines[i]
		if (!line) continue

		snippetLines.push(line)
		const combined = snippetLines.join('\n')

		const openTagMatch = combined.match(new RegExp(`<${escapedTag}[^>]*>`, 'i'))
		if (openTagMatch) {
			return { snippet: openTagMatch[0], startLine: actualStartLine }
		}

		const selfClosingMatch = combined.match(new RegExp(`<${escapedTag}[^>]*/\\s*>`, 'i'))
		if (selfClosingMatch) {
			return { snippet: selfClosingMatch[0], startLine: actualStartLine }
		}
	}

	return undefined
}

/**
 * Index all searchable text content from a parsed file
 */
export function indexFileContent(cached: CachedParsedFile, relFile: string): void {
	// Walk AST and collect all text elements
	function visit(node: AstroNode) {
		if ((node.type === 'element' || node.type === 'component')) {
			const elemNode = node as ElementNode | ComponentNode
			const tag = elemNode.name.toLowerCase()
			const textContent = getTextContent(elemNode)
			const normalizedText = normalizeText(textContent)
			const line = elemNode.position?.start.line ?? 0

			if (normalizedText && normalizedText.length >= 2) {
				// Check for variable references
				const exprInfo = hasExpressionChild(elemNode)
				if (exprInfo.found && exprInfo.varNames.length > 0) {
					for (const exprPath of exprInfo.varNames) {
						for (const def of cached.variableDefinitions) {
							// Build the full definition path for comparison
							// For array indices (numeric names), use bracket notation
							const defPath = buildDefinitionPath(def)
							// Check if the expression path matches the definition path
							// e.g., 'config.nav.title' matches def with parentName='config.nav', name='title'
							// or 'items[0]' matches def with parentName='items', name='0'
							if (defPath === exprPath) {
								const normalizedDef = normalizeText(def.value)
								const completeSnippet = extractCompleteTagSnippet(cached.lines, line - 1, tag)
								const snippet = extractInnerHtmlFromSnippet(completeSnippet, tag) ?? completeSnippet

								addToTextSearchIndex({
									file: relFile,
									line: def.line,
									snippet: cached.lines[def.line - 1] || '',
									type: 'variable',
									variableName: defPath,
									definitionLine: def.line,
									normalizedText: normalizedDef,
									tag,
								})
							}
						}
					}
				}

				// Index static text content
				const completeSnippet = extractCompleteTagSnippet(cached.lines, line - 1, tag)
				const snippet = extractInnerHtmlFromSnippet(completeSnippet, tag) ?? completeSnippet
				const openingTagInfo = extractOpeningTagWithLine(cached.lines, line - 1, tag)

				addToTextSearchIndex({
					file: relFile,
					line,
					snippet,
					openingTagSnippet: openingTagInfo?.snippet,
					type: 'static',
					normalizedText,
					tag,
				})
			}

			// Also index component props
			if (node.type === 'component') {
				for (const attr of elemNode.attributes) {
					if (attr.type === 'attribute' && attr.kind === 'quoted' && attr.value) {
						const normalizedValue = normalizeText(attr.value)
						if (normalizedValue && normalizedValue.length >= 2) {
							addToTextSearchIndex({
								file: relFile,
								line: attr.position?.start.line ?? line,
								snippet: cached.lines[(attr.position?.start.line ?? line) - 1] || '',
								type: 'prop',
								variableName: attr.name,
								normalizedText: normalizedValue,
								tag,
							})
						}
					}
				}
			}
		}

		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child)
			}
		}
	}

	visit(cached.ast)
}

/**
 * Resolve a .map() callback parameter back to the source array path.
 *
 * Given expression text like:
 *   "categories.map((cat) => (\n  cat.images.map((img, i) => (\n    "
 * and a parameter name like "img", returns "categories[*].images" — the
 * array path that the parameter iterates over.
 *
 * Supports chained .map() calls (nested loops).
 */
export function resolveMapChain(exprTexts: string[], paramName: string): string | null {
	const fullText = exprTexts.join('')

	// Find all .map() calls: <arrayExpr>.map((<param>, ...) =>
	// Capture: [1] = array expression, [2] = first callback parameter
	const mapPattern = /([\w.[\]]+)\.map\(\s*\(\s*(\w+)/g
	const maps: Array<{ arrayExpr: string; param: string }> = []
	let match: RegExpExecArray | null
	while ((match = mapPattern.exec(fullText)) !== null) {
		maps.push({ arrayExpr: match[1]!, param: match[2]! })
	}

	if (maps.length === 0) return null

	// Find which .map() provides our paramName
	const directMap = maps.find(m => m.param === paramName)
	if (!directMap) return null

	// Resolve the array expression by substituting outer .map() params
	// e.g., "cat.images" where "cat" comes from "categories.map((cat) => ...)"
	let arrayPath = directMap.arrayExpr
	for (const outerMap of maps) {
		if (outerMap === directMap) continue
		// If arrayPath starts with an outer param name, substitute it
		// e.g., "cat.images" and cat comes from "categories" → "categories[*].images"
		if (arrayPath === outerMap.param || arrayPath.startsWith(outerMap.param + '.')) {
			const suffix = arrayPath.slice(outerMap.param.length) // ".images" or ""
			const resolvedOuter = resolveMapChain(exprTexts, outerMap.param)
			if (resolvedOuter) {
				arrayPath = resolvedOuter + '[*]' + suffix
			} else {
				arrayPath = outerMap.arrayExpr + '[*]' + suffix
			}
		}
	}

	return arrayPath
}

/**
 * Build a map of locally-imported asset bindings (e.g. `import hero from './x.png'`)
 * to their absolute on-disk paths. Only relative imports with an image extension are
 * included — these are the bindings that can appear as `<Image src={hero} />`.
 */
function buildImportedAssetMap(imports: CachedParsedFile['imports'], relFile: string): Map<string, string> {
	const map = new Map<string, string>()
	const fromDir = path.dirname(path.join(getProjectRoot(), relFile))
	for (const imp of imports) {
		if (!imp.source.startsWith('.') || !IMAGE_EXTENSIONS.test(imp.source)) continue
		map.set(imp.localName, path.resolve(fromDir, imp.source))
	}
	return map
}

/**
 * Index images from an expression-based src={variable} by tracing
 * the variable through .map() calls back to the data source array,
 * then adding each array element to the image search index.
 */
function indexExpressionImageSrc(
	exprValue: string,
	parentExpression: AstroNode,
	cached: CachedParsedFile,
	relFile: string,
): void {
	// Collect text content from the expression node (contains the .map() calls)
	const exprTexts: string[] = []
	if ('children' in parentExpression && Array.isArray(parentExpression.children)) {
		for (const child of parentExpression.children) {
			if (child.type === 'text' && (child as TextNode).value) {
				exprTexts.push((child as TextNode).value)
			}
		}
	}

	if (exprTexts.length === 0) return

	// Resolve the .map() chain to find the source array path
	const arrayPath = resolveMapChain(exprTexts, exprValue)
	if (!arrayPath) return

	for (const def of cached.variableDefinitions) {
		const defPath = buildDefinitionPath(def)
		// Match definitions that are direct children of the array
		// e.g., for "images" match "images[0]", "images[1]"
		// e.g., for "categories[*].images" match "categories[0].images[0]", etc.
		if (isChildOfArray(defPath, arrayPath)) {
			const snippet = cached.lines[def.line - 1]?.trim() || ''
			addToImageSearchIndex({
				file: relFile,
				line: def.line,
				snippet,
				src: def.value,
			})
		}
	}
}

/**
 * Check if a definition path is a direct element of the given array path.
 * Converts the arrayPath pattern (with optional [*] wildcards) into a regex
 * that matches concrete indices.
 *
 * e.g., "images[0]" is a child of "images"
 * e.g., "categories[0].images[1]" is a child of "categories[*].images"
 * e.g., "categories[0].images[1].url" is NOT a child (too deep)
 */
export function isChildOfArray(defPath: string, arrayPath: string): boolean {
	// Split arrayPath on [*] to get segments, then build a regex
	// "categories[*].images" → ["categories", ".images"] → /^categories\[\d+\]\.images\[\d+\]$/
	const segments = arrayPath.split('[*]')
	let regexStr = '^'
	for (let i = 0; i < segments.length; i++) {
		regexStr += escapeRegex(segments[i]!)
		if (i < segments.length - 1) {
			regexStr += '\\[\\d+\\]'
		}
	}
	regexStr += '\\[\\d+\\]$'
	return new RegExp(regexStr).test(defPath)
}

/**
 * Index all images from a parsed file
 */
export function indexFileImages(cached: CachedParsedFile, relFile: string): void {
	// For Astro files, use AST
	if (relFile.endsWith('.astro')) {
		// Map locally-imported asset bindings (e.g. `import hero from './hero.png'`)
		// to the absolute on-disk path so dev-mode optimized URLs that embed that
		// path (e.g. `/@image/...?f=/abs/path/hero.png`) can resolve back to the
		// `<Image src={hero} />` JSX site.
		const importedAssetAbsPath = buildImportedAssetMap(cached.imports, relFile)

		function visit(node: AstroNode, parentExpression: AstroNode | null) {
			// Track the nearest ancestor expression node (contains .map() context)
			const currentExpr = node.type === 'expression' ? node : parentExpression

			if (node.type === 'element' || node.type === 'component') {
				const elemNode = node as ElementNode | ComponentNode
				const isImg = node.type === 'element' && elemNode.name.toLowerCase() === 'img'
				const isImageComponent = node.type === 'component' && elemNode.name === 'Image'

				if (isImg || isImageComponent) {
					for (const attr of elemNode.attributes) {
						if (attr.type !== 'attribute' || attr.name !== 'src' || !attr.value) continue

						const isExpression = (attr as any).kind === 'expression'
						const srcLine = attr.position?.start.line ?? elemNode.position?.start.line ?? 0

						if (isExpression) {
							const importedAbs = importedAssetAbsPath.get(attr.value)
							if (importedAbs) {
								const snippet = extractImageSnippet(cached.lines, srcLine - 1)
								addToImageSearchIndex({ file: relFile, line: srcLine, snippet, src: importedAbs })
							}
							if (currentExpr) {
								// `.map()`-driven src={item.foo} — trace through to data source
								indexExpressionImageSrc(attr.value, currentExpr, cached, relFile)
							}
						} else {
							// Static src="..." — index directly
							const snippet = extractImageSnippet(cached.lines, srcLine - 1)
							addToImageSearchIndex({ file: relFile, line: srcLine, snippet, src: attr.value })
						}
					}
				}
			}

			if ('children' in node && Array.isArray(node.children)) {
				for (const child of node.children) {
					visit(child, currentExpr)
				}
			}
		}
		visit(cached.ast, null)
	} else {
		// For tsx/jsx, use regex
		const srcPatterns = [/src="([^"]+)"/g, /src='([^']+)'/g]
		for (let i = 0; i < cached.lines.length; i++) {
			const line = cached.lines[i]
			if (!line) continue

			for (const pattern of srcPatterns) {
				pattern.lastIndex = 0
				let match: RegExpExecArray | null
				while ((match = pattern.exec(line)) !== null) {
					const snippet = extractImageSnippet(cached.lines, i)
					addToImageSearchIndex({
						file: relFile,
						line: i + 1,
						snippet,
						src: match[1]!,
					})
				}
			}
		}
	}
}

// ============================================================================
// Content Collection Data File Indexing
// ============================================================================

/** Image-like file extensions to match in data file values */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?)$/i

/**
 * Index image paths found in content collection data files (JSON/YAML).
 * These are values like `"image": "/assets/photo.webp"` that get rendered
 * through template expressions (e.g., `src={person.image}`).
 */
async function indexContentCollectionImages(): Promise<void> {
	const contentDir = path.join(getProjectRoot(), 'src', 'content')
	const entries = await fs.readdir(contentDir, { withFileTypes: true }).catch(() => null)
	if (!entries) return // No content directory

	const dataFiles: string[] = []
	for (const entry of entries) {
		if (entry.isDirectory()) {
			await collectDataFiles(path.join(contentDir, entry.name), dataFiles)
		}
	}

	await Promise.all(dataFiles.map(async (filePath) => {
		try {
			const content = await fs.readFile(filePath, 'utf-8')
			const relFile = path.relative(getProjectRoot(), filePath)

			if (filePath.endsWith('.json')) {
				indexJsonImages(content, relFile)
			} else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
				indexYamlImages(content, relFile)
			} else if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
				indexFrontmatterImages(content, relFile)
			}
		} catch {
			// Skip unreadable files
		}
	}))
}

const DATA_FILE_PATTERN = /\.(json|ya?ml|mdx?)$/

async function collectDataFiles(dir: string, results: string[]): Promise<void> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		await Promise.all(entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				await collectDataFiles(fullPath, results)
			} else if (entry.isFile() && DATA_FILE_PATTERN.test(entry.name)) {
				results.push(fullPath)
			}
		}))
	} catch {
		// Directory doesn't exist
	}
}

function indexJsonImages(content: string, relFile: string): void {
	const lines = content.split('\n')
	// Match JSON string values that look like image paths
	const pattern = /:\s*"([^"]+)"/g
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		let match
		pattern.lastIndex = 0
		while ((match = pattern.exec(line)) !== null) {
			const value = match[1]!
			if (IMAGE_EXTENSIONS.test(value)) {
				addToImageSearchIndex({
					file: relFile,
					line: i + 1,
					snippet: line.trim(),
					src: value,
				})
			}
		}
	}
}

function indexYamlImages(content: string, relFile: string): void {
	indexYamlLikeLines(content.split('\n'), relFile, 0)
}

function indexFrontmatterImages(content: string, relFile: string): void {
	// Only scan YAML frontmatter (between --- markers)
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!fmMatch) return
	indexYamlLikeLines(fmMatch[1]!.split('\n'), relFile, 1)
}

/** Shared YAML key-value image scanner used by both indexYamlImages and indexFrontmatterImages */
function indexYamlLikeLines(lines: string[], relFile: string, lineOffset: number): void {
	const pattern = /^\s*[\w-]+:\s*(.+)/
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i]!.match(pattern)
		if (!match) continue
		const value = match[1]!.trim().replace(/^['"]|['"]$/g, '')
		if (IMAGE_EXTENSIONS.test(value)) {
			addToImageSearchIndex({
				file: relFile,
				line: i + 1 + lineOffset,
				snippet: lines[i]!.trim(),
				src: value,
			})
		}
	}
}

// ============================================================================
// Translation Dictionary Indexing (i18n JSON files)
// ============================================================================

/** Directory names conventionally used for translation dictionaries */
const I18N_DIR_NAMES = new Set(['i18n', 'locales', 'locale', 'translations', 'dictionaries'])

/** Tag marker for entries that have no single originating template tag */
const TRANSLATION_TAG_MARKER = '*'

/**
 * Return true if `absPath` lives under a directory commonly used for
 * translation dictionaries (i18n, locales, translations, dictionaries).
 */
export function isTranslationFilePath(absPath: string): boolean {
	if (!absPath.endsWith('.json')) return false
	const segments = absPath.split(path.sep)
	return segments.some((segment) => I18N_DIR_NAMES.has(segment.toLowerCase()))
}

/**
 * Index text string values from JSON dictionaries under `src/i18n`, `src/locales`, etc.
 * These cover templates that render strings through helpers like `{t(locale, 'key')}` —
 * the rendered text lives in a JSON file rather than the template itself, so without
 * this index the source finder has no way to associate the two.
 */
async function indexTranslationFiles(): Promise<void> {
	const srcDir = path.join(getProjectRoot(), 'src')
	const translationFiles: string[] = []
	await collectTranslationFiles(srcDir, translationFiles)

	await Promise.all(translationFiles.map(async (filePath) => {
		try {
			const content = await fs.readFile(filePath, 'utf-8')
			const relFile = path.relative(getProjectRoot(), filePath)
			indexJsonTextValues(content, relFile)
		} catch {
			// Skip unreadable files
		}
	}))
}

/**
 * Walk `dir` and push any .json files that live inside a conventional i18n folder
 * (at any depth) into `results`.
 */
async function collectTranslationFiles(dir: string, results: string[]): Promise<void> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		await Promise.all(entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (I18N_DIR_NAMES.has(entry.name.toLowerCase())) {
					await collectJsonFilesRecursive(fullPath, results)
				} else if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
					await collectTranslationFiles(fullPath, results)
				}
			}
		}))
	} catch {
		// Directory doesn't exist
	}
}

async function collectJsonFilesRecursive(dir: string, results: string[]): Promise<void> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		await Promise.all(entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				await collectJsonFilesRecursive(fullPath, results)
			} else if (entry.isFile() && entry.name.endsWith('.json')) {
				results.push(fullPath)
			}
		}))
	} catch {
		// Directory doesn't exist
	}
}

/** JSON escape sequences that decode to a single character */
const JSON_ESCAPE_MAP: Record<string, string> = {
	'\\"': '"',
	'\\\\': '\\',
	'\\/': '/',
	'\\n': '\n',
	'\\r': '\r',
	'\\t': '\t',
	'\\b': '\b',
	'\\f': '\f',
}

function unescapeJsonString(raw: string): string {
	return raw.replace(/\\["\\/nrtbf]|\\u[0-9a-fA-F]{4}/g, (match) => {
		if (match.startsWith('\\u')) {
			return String.fromCharCode(parseInt(match.slice(2), 16))
		}
		return JSON_ESCAPE_MAP[match] ?? match
	})
}

/**
 * Find a template element with the given tag whose descendant expression
 * references the given string literal (e.g. a translation key passed to
 * `t(locale, 'nav.key')` or an object lookup like `cs['nav.key']`).
 *
 * Used to recover the template source location for an element whose rendered
 * text came from a translation dictionary — class/attribute edits need to
 * point at the template even when text edits point at the JSON.
 */
export async function findTemplateElementUsingStringLiteral(
	stringLiteral: string,
	tag: string,
): Promise<{ file: string; line: number; lines: string[] } | undefined> {
	const srcDir = path.join(getProjectRoot(), 'src')
	const searchDirs = [
		path.join(srcDir, 'components'),
		path.join(srcDir, 'layouts'),
		path.join(srcDir, 'pages'),
	]

	for (const dir of searchDirs) {
		const result = await searchDirForStringLiteral(dir, stringLiteral, tag)
		if (result) return result
	}
	return undefined
}

async function searchDirForStringLiteral(
	dir: string,
	stringLiteral: string,
	tag: string,
): Promise<{ file: string; line: number; lines: string[] } | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				const result = await searchDirForStringLiteral(fullPath, stringLiteral, tag)
				if (result) return result
			} else if (entry.isFile() && entry.name.endsWith('.astro')) {
				const cached = await getCachedParsedFile(fullPath)
				if (!cached) continue
				const line = findElementLineUsingStringLiteral(cached.ast, stringLiteral, tag)
				if (line !== undefined) {
					return {
						file: path.relative(getProjectRoot(), fullPath),
						line,
						lines: cached.lines,
					}
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}
	return undefined
}

function findElementLineUsingStringLiteral(
	ast: AstroNode,
	stringLiteral: string,
	tag: string,
): number | undefined {
	const tagLower = tag.toLowerCase()
	const quotedPatterns = [`'${stringLiteral}'`, `"${stringLiteral}"`, `\`${stringLiteral}\``]

	let result: number | undefined

	function visit(node: AstroNode) {
		if (result !== undefined) return
		if ((node.type === 'element' || node.type === 'component') && node.name.toLowerCase() === tagLower) {
			const elemNode = node as ElementNode | ComponentNode
			const exprText = getExpressionText(elemNode)
			if (exprText && quotedPatterns.some((p) => exprText.includes(p))) {
				result = elemNode.position?.start.line
				return
			}
		}
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				if (result !== undefined) break
				visit(child)
			}
		}
	}

	visit(ast)
	return result
}

/** Collect the combined text of every expression descendant of `node`. */
function getExpressionText(node: AstroNode): string {
	let text = ''
	function visit(n: AstroNode) {
		if (n.type === 'expression') {
			text += getTextContent(n)
			return
		}
		if ('children' in n && Array.isArray(n.children)) {
			for (const child of n.children) visit(child)
		}
	}
	visit(node)
	return text
}

/**
 * Extract the JSON dictionary key from a translation-file snippet.
 * Expects a line shaped like `  "nav.whatsHappening": "Co se děje v EduArt?",`
 * and returns `"nav.whatsHappening"`.
 */
export function extractTranslationKeyFromSnippet(snippet: string): string | undefined {
	const match = snippet.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/)
	return match?.[1]
}

/**
 * Extract all string key/value pairs from a JSON file and add each one to the
 * text search index with a wildcard tag. The dictionary key is retained on
 * each entry so a template expression like `{t(locale, 'nav.prague4')}` can
 * resolve directly to the JSON line via the literal key. Non-user-facing
 * values (paths, URLs, image assets, single characters) are skipped.
 */
export function indexJsonTextValues(content: string, relFile: string): void {
	const lines = content.split('\n')
	// Match `"key": "value"` pairs on a single line, handling backslash escapes.
	// Nested objects aren't matched (their `"key":` is followed by `{`, not `"`).
	const pattern = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		pattern.lastIndex = 0
		let match: RegExpExecArray | null
		while ((match = pattern.exec(line)) !== null) {
			const key = unescapeJsonString(match[1]!)
			const value = unescapeJsonString(match[2]!)
			if (!value) continue
			if (IMAGE_EXTENSIONS.test(value)) continue
			if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) continue
			if (/^https?:\/\//.test(value)) continue

			const normalized = normalizeText(value)
			if (normalized.length < 2) continue

			addToTextSearchIndex({
				file: relFile,
				line: i + 1,
				snippet: line,
				type: 'static',
				normalizedText: normalized,
				tag: TRANSLATION_TAG_MARKER,
				translationKey: key,
			})
		}
	}
}

// ============================================================================
// Index Lookup
// ============================================================================

/** Helper to build SourceLocation from a text index entry */
function textEntryToLocation(entry: SearchIndexEntry): SourceLocation {
	return {
		file: entry.file,
		line: entry.line,
		snippet: entry.snippet,
		openingTagSnippet: entry.openingTagSnippet,
		type: entry.type,
		variableName: entry.variableName,
		definitionLine: entry.definitionLine,
	}
}

/**
 * Look up an i18n dictionary entry by its literal key (e.g. `nav.prague4`),
 * preferring the match whose value equals `normalizedText` so the right locale
 * wins when multiple dictionaries share the same key.
 */
export function findTranslationByKeyAndText(key: string, normalizedText: string): SourceLocation | undefined {
	const entries = getTranslationKeyIndex().get(key)
	if (!entries) return undefined
	let fallback: SourceLocation | undefined
	for (const entry of entries) {
		if (entry.normalizedText === normalizedText) return textEntryToLocation(entry)
		fallback ??= textEntryToLocation(entry)
	}
	return fallback
}

/**
 * Fast text lookup using pre-built index
 */
export function findInTextIndex(textContent: string, tag: string): SourceLocation | undefined {
	const normalizedSearch = normalizeText(textContent)
	const tagLower = tag.toLowerCase()
	const index = getTextSearchIndex()

	// Single pass for exact matches: collect the best same-tag template hit
	// *and* any i18n dictionary hit at once. A JSON dictionary entry is an
	// authoritative translatable signal, so it beats a non-collection
	// template match (which is often a coincidental same-text element).
	let bestMatch: SourceLocation | undefined
	let translationHit: SourceLocation | undefined
	for (const entry of index) {
		if (entry.normalizedText !== normalizedSearch) continue
		if (entry.tag === tagLower) {
			const result = textEntryToLocation(entry)
			if (isCollectionFile(entry.file)) return result
			bestMatch ??= result
		} else if (entry.tag === TRANSLATION_TAG_MARKER) {
			translationHit ??= textEntryToLocation(entry)
		}
	}
	if (translationHit) return translationHit
	if (bestMatch) return bestMatch

	// Then try partial match for longer text — prefer collection data files
	if (normalizedSearch.length > 10) {
		const textPreview = normalizedSearch.slice(0, Math.min(30, normalizedSearch.length))
		for (const entry of index) {
			if (entry.tag === tagLower && entry.normalizedText.includes(textPreview)) {
				const result = textEntryToLocation(entry)
				if (isCollectionFile(entry.file)) return result
				bestMatch ??= result
			}
		}
		if (bestMatch) return bestMatch
	}

	// Try any tag match — prefer collection data files
	for (const entry of index) {
		if (entry.normalizedText === normalizedSearch) {
			const result = textEntryToLocation(entry)
			if (isCollectionFile(entry.file)) return result
			bestMatch ??= result
		}
	}

	return bestMatch
}

/**
 * Extract the pathname from a src value (handles both absolute URLs and relative paths)
 */
function extractPathname(src: string): string {
	try {
		return new URL(src).pathname
	} catch {
		return (src.split('?')[0] ?? src)
	}
}

/**
 * Fast image lookup using pre-built index
 */
export function findInImageIndex(imageSrc: string): SourceLocation | undefined {
	const index = getImageSearchIndex()

	// Dev-mode optimized URLs (`/_image?href=...`, `/@image/...?f=...`) embed the source
	// path; try both the raw URL and the decoded path so callers don't need to pre-decode.
	const decoded = extractAstroImageOriginalUrl(imageSrc)
	const candidates = decoded && decoded !== imageSrc ? [imageSrc, decoded] : [imageSrc]

	// Exact match — prefer collection data files (src/content/) over templates.
	// The same image URL can appear in both a collection data file and a template
	// that statically renders the collection. The data file is the authoritative source.
	let bestMatch: SourceLocation | undefined
	for (const entry of index) {
		if (!candidates.includes(entry.src)) continue
		const result: SourceLocation = {
			file: entry.file,
			line: entry.line,
			snippet: entry.snippet,
			type: 'static',
		}
		if (isCollectionFile(entry.file)) {
			return result // Collection data file — always preferred
		}
		bestMatch ??= result // Keep first non-collection match as fallback
	}
	if (bestMatch) return bestMatch

	// Fallback: path suffix matching for CDN-transformed URLs
	// e.g., rendered src "/cdn-cgi/image/.../assets/photo.webp" should match
	// authored src "https://cdn.nuasite.com/assets/photo.webp"
	const targetPath = extractPathname(imageSrc)
	for (const entry of index) {
		const entryPath = extractPathname(entry.src)
		if (entryPath.length > 5 && (targetPath.endsWith(entryPath) || entryPath.endsWith(targetPath))) {
			const result: SourceLocation = {
				file: entry.file,
				line: entry.line,
				snippet: entry.snippet,
				type: 'static',
			}
			if (isCollectionFile(entry.file)) {
				return result
			}
			bestMatch ??= result
		}
	}

	return bestMatch
}
