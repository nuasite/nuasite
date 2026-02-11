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
	getDirectoryCache,
	getImageSearchIndex,
	getTextSearchIndex,
	isSearchIndexInitialized,
	setSearchIndexInitialized,
} from './cache'
import { extractImageSnippet, extractInnerHtmlFromSnippet, normalizeText } from './snippet-utils'
import type { CachedParsedFile, SourceLocation } from './types'

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

/**
 * Initialize search index by pre-scanning all source files.
 * This is much faster than searching per-entry.
 */
export async function initializeSearchIndex(): Promise<void> {
	if (isSearchIndexInitialized()) return

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

	setSearchIndexInitialized(true)
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
 * Index all images from a parsed file
 */
export function indexFileImages(cached: CachedParsedFile, relFile: string): void {
	// For Astro files, use AST
	if (relFile.endsWith('.astro')) {
		function visit(node: AstroNode) {
			if (node.type === 'element') {
				const elemNode = node as ElementNode
				if (elemNode.name.toLowerCase() === 'img') {
					for (const attr of elemNode.attributes) {
						if (attr.type === 'attribute' && attr.name === 'src' && attr.value) {
							const srcLine = attr.position?.start.line ?? elemNode.position?.start.line ?? 0
							const snippet = extractImageSnippet(cached.lines, srcLine - 1)
							addToImageSearchIndex({
								file: relFile,
								line: srcLine,
								snippet,
								src: attr.value,
							})
						}
					}
				}
			}

			// Also index component nodes with src attributes (e.g., <Image src="..." />)
			// This captures image component usages where the actual src is defined
			if (node.type === 'component') {
				const compNode = node as ComponentNode
				for (const attr of compNode.attributes) {
					if (attr.type === 'attribute' && attr.name === 'src' && attr.value) {
						const srcLine = attr.position?.start.line ?? compNode.position?.start.line ?? 0
						const snippet = extractImageSnippet(cached.lines, srcLine - 1)
						addToImageSearchIndex({
							file: relFile,
							line: srcLine,
							snippet,
							src: attr.value,
						})
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
// Index Lookup
// ============================================================================

/**
 * Fast text lookup using pre-built index
 */
export function findInTextIndex(textContent: string, tag: string): SourceLocation | undefined {
	const normalizedSearch = normalizeText(textContent)
	const tagLower = tag.toLowerCase()
	const index = getTextSearchIndex()

	// First try exact match with same tag
	for (const entry of index) {
		if (entry.tag === tagLower && entry.normalizedText === normalizedSearch) {
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
	}

	// Then try partial match for longer text
	if (normalizedSearch.length > 10) {
		const textPreview = normalizedSearch.slice(0, Math.min(30, normalizedSearch.length))
		for (const entry of index) {
			if (entry.tag === tagLower && entry.normalizedText.includes(textPreview)) {
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
		}
	}

	// Try any tag match
	for (const entry of index) {
		if (entry.normalizedText === normalizedSearch) {
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
	}

	return undefined
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

	// Exact match first
	for (const entry of index) {
		if (entry.src === imageSrc) {
			return {
				file: entry.file,
				line: entry.line,
				snippet: entry.snippet,
				type: 'static',
			}
		}
	}

	// Fallback: path suffix matching for CDN-transformed URLs
	// e.g., rendered src "/cdn-cgi/image/.../assets/photo.webp" should match
	// authored src "https://cdn.nuasite.com/assets/photo.webp"
	const targetPath = extractPathname(imageSrc)
	for (const entry of index) {
		const entryPath = extractPathname(entry.src)
		if (entryPath.length > 5 && (targetPath.endsWith(entryPath) || entryPath.endsWith(targetPath))) {
			return {
				file: entry.file,
				line: entry.line,
				snippet: entry.snippet,
				type: 'static',
			}
		}
	}

	return undefined
}
