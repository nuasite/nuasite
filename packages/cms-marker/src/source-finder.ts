import { parse as parseAstro } from '@astrojs/compiler'
import type { ComponentNode, ElementNode, Node as AstroNode, TextNode } from '@astrojs/compiler/types'
import { parse as parseBabel } from '@babel/parser'
import type * as t from '@babel/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from './config'
import { getErrorCollector } from './error-collector'
import type { ManifestEntry } from './types'
import { generateSourceHash } from './utils'

// ============================================================================
// File Parsing Cache - Avoid re-parsing the same files
// ============================================================================

interface CachedParsedFile {
	content: string
	lines: string[]
	ast: AstroNode
	frontmatterContent: string | null
	frontmatterStartLine: number
	variableDefinitions: VariableDefinition[]
}

/** Cache for parsed Astro files - cleared between builds */
const parsedFileCache = new Map<string, CachedParsedFile>()

/** Cache for directory listings - cleared between builds */
const directoryCache = new Map<string, string[]>()

/** Cache for markdown file contents - cleared between builds */
const markdownFileCache = new Map<string, { content: string; lines: string[] }>()

/** Pre-built search index for fast lookups */
interface SearchIndexEntry {
	file: string
	line: number
	snippet: string
	type: 'static' | 'variable' | 'prop' | 'computed'
	variableName?: string
	definitionLine?: number
	normalizedText: string
	tag: string
}

interface ImageIndexEntry {
	file: string
	line: number
	snippet: string
	src: string
}

/** Search indexes built once per build */
let textSearchIndex: SearchIndexEntry[] = []
let imageSearchIndex: ImageIndexEntry[] = []
let searchIndexInitialized = false

/**
 * Clear all caches - call at start of each build
 */
export function clearSourceFinderCache(): void {
	parsedFileCache.clear()
	directoryCache.clear()
	markdownFileCache.clear()
	textSearchIndex = []
	imageSearchIndex = []
	searchIndexInitialized = false
}

/**
 * Initialize search index by pre-scanning all source files.
 * This is much faster than searching per-entry.
 */
export async function initializeSearchIndex(): Promise<void> {
	if (searchIndexInitialized) return

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

	searchIndexInitialized = true
}

/**
 * Collect all .astro files in a directory recursively
 */
async function collectAstroFiles(dir: string): Promise<string[]> {
	const cached = directoryCache.get(dir)
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

	directoryCache.set(dir, results)
	return results
}

/**
 * Get a cached parsed file, parsing it if not cached
 */
async function getCachedParsedFile(filePath: string): Promise<CachedParsedFile | null> {
	const cached = parsedFileCache.get(filePath)
	if (cached) return cached

	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		// Only parse .astro files with AST
		if (!filePath.endsWith('.astro')) {
			// For tsx/jsx, just cache content/lines for regex search
			const entry: CachedParsedFile = {
				content,
				lines,
				ast: { type: 'root', children: [] } as unknown as AstroNode,
				frontmatterContent: null,
				frontmatterStartLine: 0,
				variableDefinitions: [],
			}
			parsedFileCache.set(filePath, entry)
			return entry
		}

		const { ast, frontmatterContent, frontmatterStartLine } = await parseAstroFile(content)

		let variableDefinitions: VariableDefinition[] = []
		if (frontmatterContent) {
			const frontmatterAst = parseFrontmatter(frontmatterContent, filePath)
			if (frontmatterAst) {
				variableDefinitions = extractVariableDefinitions(frontmatterAst, frontmatterStartLine)
			}
		}

		const entry: CachedParsedFile = {
			content,
			lines,
			ast,
			frontmatterContent,
			frontmatterStartLine,
			variableDefinitions,
		}

		parsedFileCache.set(filePath, entry)
		return entry
	} catch {
		return null
	}
}

/**
 * Index all searchable text content from a parsed file
 */
function indexFileContent(cached: CachedParsedFile, relFile: string): void {
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
					for (const varName of exprInfo.varNames) {
						for (const def of cached.variableDefinitions) {
							if (def.name === varName || (def.parentName && def.name === varName)) {
								const normalizedDef = normalizeText(def.value)
								const completeSnippet = extractCompleteTagSnippet(cached.lines, line - 1, tag)
								const snippet = extractInnerHtmlFromSnippet(completeSnippet, tag) ?? completeSnippet

								textSearchIndex.push({
									file: relFile,
									line: def.line,
									snippet: cached.lines[def.line - 1] || '',
									type: 'variable',
									variableName: def.parentName ? `${def.parentName}.${def.name}` : def.name,
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

				textSearchIndex.push({
					file: relFile,
					line,
					snippet,
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
							textSearchIndex.push({
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
function indexFileImages(cached: CachedParsedFile, relFile: string): void {
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
							imageSearchIndex.push({
								file: relFile,
								line: srcLine,
								snippet,
								src: attr.value,
							})
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
					imageSearchIndex.push({
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

/**
 * Fast text lookup using pre-built index
 */
function findInTextIndex(textContent: string, tag: string): SourceLocation | undefined {
	const normalizedSearch = normalizeText(textContent)
	const tagLower = tag.toLowerCase()

	// First try exact match with same tag
	for (const entry of textSearchIndex) {
		if (entry.tag === tagLower && entry.normalizedText === normalizedSearch) {
			return {
				file: entry.file,
				line: entry.line,
				snippet: entry.snippet,
				type: entry.type,
				variableName: entry.variableName,
				definitionLine: entry.definitionLine,
			}
		}
	}

	// Then try partial match for longer text
	if (normalizedSearch.length > 10) {
		const textPreview = normalizedSearch.slice(0, Math.min(30, normalizedSearch.length))
		for (const entry of textSearchIndex) {
			if (entry.tag === tagLower && entry.normalizedText.includes(textPreview)) {
				return {
					file: entry.file,
					line: entry.line,
					snippet: entry.snippet,
					type: entry.type,
					variableName: entry.variableName,
					definitionLine: entry.definitionLine,
				}
			}
		}
	}

	// Try any tag match
	for (const entry of textSearchIndex) {
		if (entry.normalizedText === normalizedSearch) {
			return {
				file: entry.file,
				line: entry.line,
				snippet: entry.snippet,
				type: entry.type,
				variableName: entry.variableName,
				definitionLine: entry.definitionLine,
			}
		}
	}

	return undefined
}

/**
 * Fast image lookup using pre-built index
 */
function findInImageIndex(imageSrc: string): SourceLocation | undefined {
	for (const entry of imageSearchIndex) {
		if (entry.src === imageSrc) {
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

// Helper for indexing - get text content from node
function getTextContent(node: AstroNode): string {
	if (node.type === 'text') {
		return (node as TextNode).value
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
		const match = exprText.match(/^\s*(\w+)(?:\.(\w+))?\s*$/)
		if (match) {
			varNames.push(match[2] ?? match[1]!)
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

export interface SourceLocation {
	file: string
	line: number
	snippet?: string
	type?: 'static' | 'variable' | 'prop' | 'computed' | 'collection'
	variableName?: string
	definitionLine?: number
	/** Collection name for collection entries */
	collectionName?: string
	/** Entry slug for collection entries */
	collectionSlug?: string
}

export interface VariableReference {
	name: string
	pattern: string
	definitionLine: number
}

export interface CollectionInfo {
	name: string
	slug: string
	file: string
}

export interface MarkdownContent {
	/** Frontmatter fields as key-value pairs with line numbers */
	frontmatter: Record<string, { value: string; line: number }>
	/** The full markdown body content */
	body: string
	/** Line number where body starts */
	bodyStartLine: number
	/** File path relative to cwd */
	file: string
	/** Collection name */
	collectionName: string
	/** Collection slug */
	collectionSlug: string
}

// ============================================================================
// AST Parsing Utilities
// ============================================================================

interface ParsedAstroFile {
	ast: AstroNode
	frontmatterContent: string | null
	frontmatterStartLine: number
}

/**
 * Parse an Astro file and return both template AST and frontmatter content
 */
async function parseAstroFile(content: string): Promise<ParsedAstroFile> {
	const result = await parseAstro(content, { position: true })

	// Find frontmatter node
	let frontmatterContent: string | null = null
	let frontmatterStartLine = 0

	for (const child of result.ast.children) {
		if (child.type === 'frontmatter') {
			frontmatterContent = child.value
			frontmatterStartLine = child.position?.start.line ?? 1
			break
		}
	}

	return {
		ast: result.ast,
		frontmatterContent,
		frontmatterStartLine,
	}
}

/**
 * Parse frontmatter JavaScript/TypeScript with Babel
 * @param content - The frontmatter content to parse
 * @param filePath - Optional file path for error reporting
 */
function parseFrontmatter(content: string, filePath?: string): t.File | null {
	try {
		return parseBabel(content, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		})
	} catch (error) {
		// Record parse errors for aggregated reporting
		if (filePath) {
			getErrorCollector().addWarning(
				`Frontmatter parse: ${filePath}`,
				error instanceof Error ? error.message : String(error),
			)
		}
		return null
	}
}

interface VariableDefinition {
	name: string
	value: string
	line: number
	/** For object properties, the parent variable name */
	parentName?: string
}

/**
 * Extract variable definitions from Babel AST
 * Finds const/let/var declarations with string literal values
 *
 * Note: Babel parses the frontmatter content (without --- delimiters) starting at line 1.
 * frontmatterStartLine is the actual file line where the content begins (after first ---).
 * So we convert: file_line = (babel_line - 1) + frontmatterStartLine
 */
function extractVariableDefinitions(ast: t.File, frontmatterStartLine: number): VariableDefinition[] {
	const definitions: VariableDefinition[] = []

	function getStringValue(node: t.Node): string | null {
		if (node.type === 'StringLiteral') {
			return node.value
		}
		if (node.type === 'TemplateLiteral' && node.quasis.length === 1 && node.expressions.length === 0) {
			return node.quasis[0]?.value.cooked ?? null
		}
		return null
	}

	function babelLineToFileLine(babelLine: number): number {
		// Babel's line 1 = frontmatterStartLine in the actual file
		return (babelLine - 1) + frontmatterStartLine
	}

	function visitNode(node: t.Node) {
		if (node.type === 'VariableDeclaration') {
			for (const decl of node.declarations) {
				if (decl.id.type === 'Identifier' && decl.init) {
					const varName = decl.id.name
					const line = babelLineToFileLine(decl.loc?.start.line ?? 1)

					// Simple string value
					const stringValue = getStringValue(decl.init)
					if (stringValue !== null) {
						definitions.push({ name: varName, value: stringValue, line })
					}

					// Object expression - extract properties
					if (decl.init.type === 'ObjectExpression') {
						for (const prop of decl.init.properties) {
							if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier' && prop.value) {
								const propValue = getStringValue(prop.value)
								if (propValue !== null) {
									const propLine = babelLineToFileLine(prop.loc?.start.line ?? 1)
									definitions.push({
										name: prop.key.name,
										value: propValue,
										line: propLine,
										parentName: varName,
									})
								}
							}
						}
					}
				}
			}
		}

		// Recursively visit child nodes
		for (const key of Object.keys(node)) {
			const value = (node as unknown as Record<string, unknown>)[key]
			if (value && typeof value === 'object') {
				if (Array.isArray(value)) {
					for (const item of value) {
						if (item && typeof item === 'object' && 'type' in item) {
							visitNode(item as t.Node)
						}
					}
				} else if ('type' in value) {
					visitNode(value as t.Node)
				}
			}
		}
	}

	visitNode(ast.program)
	return definitions
}

interface TemplateMatch {
	line: number
	type: 'static' | 'variable' | 'computed'
	variableName?: string
	/** For variables, the definition line in frontmatter */
	definitionLine?: number
}

/**
 * Walk the Astro AST to find elements matching a tag with specific text content
 */
function findElementWithText(
	ast: AstroNode,
	tag: string,
	searchText: string,
	variableDefinitions: VariableDefinition[],
): TemplateMatch | null {
	const normalizedSearch = normalizeText(searchText)
	const tagLower = tag.toLowerCase()
	let bestMatch: TemplateMatch | null = null
	let bestScore = 0

	function getTextContent(node: AstroNode): string {
		if (node.type === 'text') {
			return (node as TextNode).value
		}
		if ('children' in node && Array.isArray(node.children)) {
			return node.children.map(getTextContent).join('')
		}
		return ''
	}

	function hasExpressionChild(node: AstroNode): { found: boolean; varNames: string[] } {
		const varNames: string[] = []
		if (node.type === 'expression') {
			// Try to extract variable name from expression
			// The expression node children contain the text representation
			const exprText = getTextContent(node)
			// Extract variable names like {foo} or {foo.bar}
			const match = exprText.match(/^\s*(\w+)(?:\.(\w+))?\s*$/)
			if (match) {
				varNames.push(match[2] ?? match[1]!)
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

	function visit(node: AstroNode) {
		// Check if this is an element or component matching our tag
		if ((node.type === 'element' || node.type === 'component') && node.name.toLowerCase() === tagLower) {
			const elemNode = node as ElementNode | ComponentNode
			const textContent = getTextContent(elemNode)
			const normalizedContent = normalizeText(textContent)
			const line = elemNode.position?.start.line ?? 0

			// Check for expression (variable reference)
			const exprInfo = hasExpressionChild(elemNode)
			if (exprInfo.found && exprInfo.varNames.length > 0) {
				// Look for matching variable definition
				for (const varName of exprInfo.varNames) {
					for (const def of variableDefinitions) {
						if (def.name === varName || (def.parentName && def.name === varName)) {
							const normalizedDef = normalizeText(def.value)
							if (normalizedDef === normalizedSearch) {
								// Found a variable match - this is highest priority
								if (bestScore < 100) {
									bestScore = 100
									bestMatch = {
										line,
										type: 'variable',
										variableName: def.parentName ? `${def.parentName}.${def.name}` : def.name,
										definitionLine: def.line,
									}
								}
								return
							}
						}
					}
				}
			}

			// Check for direct text match (static content)
			// Only match if there's meaningful text content (not just variable names/expressions)
			if (normalizedContent && normalizedContent.length >= 2 && normalizedSearch.length > 0) {
				// For short search text (<= 10 chars), require exact match
				if (normalizedSearch.length <= 10) {
					if (normalizedContent.includes(normalizedSearch)) {
						const score = 80
						if (score > bestScore) {
							bestScore = score
							const actualLine = findTextLine(elemNode, normalizedSearch)
							bestMatch = {
								line: actualLine ?? line,
								type: 'static',
							}
						}
					}
				} // For longer search text, check if content contains a significant portion
				else if (normalizedSearch.length > 10) {
					const textPreview = normalizedSearch.slice(0, Math.min(30, normalizedSearch.length))
					if (normalizedContent.includes(textPreview)) {
						const matchLength = Math.min(normalizedSearch.length, normalizedContent.length)
						const score = 50 + (matchLength / normalizedSearch.length) * 40
						if (score > bestScore) {
							bestScore = score
							const actualLine = findTextLine(elemNode, textPreview)
							bestMatch = {
								line: actualLine ?? line,
								type: 'static',
							}
						}
					} // Try matching first few words for very long text
					else if (normalizedSearch.length > 20) {
						const firstWords = normalizedSearch.split(' ').slice(0, 3).join(' ')
						if (firstWords && normalizedContent.includes(firstWords)) {
							const score = 40
							if (score > bestScore) {
								bestScore = score
								const actualLine = findTextLine(elemNode, firstWords)
								bestMatch = {
									line: actualLine ?? line,
									type: 'static',
								}
							}
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child)
			}
		}
	}

	function findTextLine(node: AstroNode, searchText: string): number | null {
		if (node.type === 'text') {
			const textNode = node as TextNode
			if (normalizeText(textNode.value).includes(searchText)) {
				return textNode.position?.start.line ?? null
			}
		}
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const line = findTextLine(child, searchText)
				if (line !== null) return line
			}
		}
		return null
	}

	visit(ast)
	return bestMatch
}

interface ComponentPropMatch {
	line: number
	propName: string
	propValue: string
}

/**
 * Walk the Astro AST to find component props with specific text value
 */
function findComponentProp(
	ast: AstroNode,
	searchText: string,
): ComponentPropMatch | null {
	const normalizedSearch = normalizeText(searchText)

	function visit(node: AstroNode): ComponentPropMatch | null {
		// Check component nodes (PascalCase names)
		if (node.type === 'component') {
			const compNode = node as ComponentNode
			for (const attr of compNode.attributes) {
				if (attr.type === 'attribute' && attr.kind === 'quoted') {
					const normalizedValue = normalizeText(attr.value)
					if (normalizedValue === normalizedSearch) {
						return {
							line: attr.position?.start.line ?? compNode.position?.start.line ?? 0,
							propName: attr.name,
							propValue: attr.value,
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const result = visit(child)
				if (result) return result
			}
		}

		return null
	}

	return visit(ast)
}

interface ImageMatch {
	line: number
	src: string
	snippet: string
}

/**
 * Walk the Astro AST to find img elements with specific src
 */
function findImageElement(
	ast: AstroNode,
	imageSrc: string,
	lines: string[],
): ImageMatch | null {
	function visit(node: AstroNode): ImageMatch | null {
		if (node.type === 'element') {
			const elemNode = node as ElementNode
			if (elemNode.name.toLowerCase() === 'img') {
				for (const attr of elemNode.attributes) {
					if (attr.type === 'attribute' && attr.name === 'src' && attr.value === imageSrc) {
						const srcLine = attr.position?.start.line ?? elemNode.position?.start.line ?? 0
						const snippet = extractImageSnippet(lines, srcLine - 1)
						return {
							line: srcLine,
							src: imageSrc,
							snippet,
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const result = visit(child)
				if (result) return result
			}
		}

		return null
	}

	return visit(ast)
}

/**
 * Find source file and line number for text content.
 * Uses pre-built search index for fast lookups.
 */
export async function findSourceLocation(
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	// Use index if available (much faster)
	if (searchIndexInitialized) {
		return findInTextIndex(textContent, tag)
	}

	// Fallback to slow search if index not initialized
	const srcDir = path.join(getProjectRoot(), 'src')

	try {
		const searchDirs = [
			path.join(srcDir, 'components'),
			path.join(srcDir, 'pages'),
			path.join(srcDir, 'layouts'),
		]

		for (const dir of searchDirs) {
			try {
				const result = await searchDirectory(dir, textContent, tag)
				if (result) {
					return result
				}
			} catch {
				// Directory doesn't exist, continue
			}
		}

		// If not found directly, try searching for prop values in parent components
		for (const dir of searchDirs) {
			try {
				const result = await searchForPropInParents(dir, textContent)
				if (result) {
					return result
				}
			} catch {
				// Directory doesn't exist, continue
			}
		}
	} catch {
		// Search failed
	}

	return undefined
}

/**
 * Find source file and line number for an image by its src attribute.
 * Uses pre-built search index for fast lookups.
 */
export async function findImageSourceLocation(
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	// Use index if available (much faster)
	if (searchIndexInitialized) {
		return findInImageIndex(imageSrc)
	}

	// Fallback to slow search if index not initialized
	const srcDir = path.join(getProjectRoot(), 'src')

	try {
		const searchDirs = [
			path.join(srcDir, 'pages'),
			path.join(srcDir, 'components'),
			path.join(srcDir, 'layouts'),
		]

		for (const dir of searchDirs) {
			try {
				const result = await searchDirectoryForImage(dir, imageSrc)
				if (result) {
					return result
				}
			} catch {
				// Directory doesn't exist, continue
			}
		}
	} catch {
		// Search failed
	}

	return undefined
}

/**
 * Recursively search directory for image with matching src
 */
async function searchDirectoryForImage(
	dir: string,
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchDirectoryForImage(fullPath, imageSrc)
				if (result) return result
			} else if (entry.isFile() && (entry.name.endsWith('.astro') || entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
				const result = await searchFileForImage(fullPath, imageSrc)
				if (result) return result
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
}

/**
 * Search a single file for an image with matching src.
 * Uses caching for better performance.
 */
async function searchFileForImage(
	filePath: string,
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	try {
		// Use cached parsed file
		const cached = await getCachedParsedFile(filePath)
		if (!cached) return undefined

		const { lines, ast } = cached

		// Use AST parsing for Astro files
		if (filePath.endsWith('.astro')) {
			const imageMatch = findImageElement(ast, imageSrc, lines)

			if (imageMatch) {
				return {
					file: path.relative(getProjectRoot(), filePath),
					line: imageMatch.line,
					snippet: imageMatch.snippet,
					type: 'static',
				}
			}
		}

		// Regex fallback for TSX/JSX files or if AST parsing failed
		const srcPatterns = [
			`src="${imageSrc}"`,
			`src='${imageSrc}'`,
		]

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (!line) continue

			for (const pattern of srcPatterns) {
				if (line.includes(pattern)) {
					// Found the image, extract the full <img> tag as snippet
					const snippet = extractImageSnippet(lines, i)

					return {
						file: path.relative(getProjectRoot(), filePath),
						line: i + 1,
						snippet,
						type: 'static',
					}
				}
			}
		}
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Extract the full <img> tag snippet from source lines
 */
function extractImageSnippet(lines: string[], startLine: number): string {
	const snippetLines: string[] = []
	let foundClosing = false

	for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
		const line = lines[i]
		if (!line) continue

		snippetLines.push(line)

		// Check if this line contains the closing of the img tag
		// img tags can be self-closing /> or just >
		if (line.includes('/>') || (line.includes('<img') && line.includes('>'))) {
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
 * Recursively search directory for matching content
 */
async function searchDirectory(
	dir: string,
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchDirectory(fullPath, textContent, tag)
				if (result) return result
			} else if (entry.isFile() && entry.name.endsWith('.astro')) {
				const result = await searchAstroFile(fullPath, textContent, tag)
				if (result) return result
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
}

/**
 * Search a single Astro file for matching content using AST parsing.
 * Uses caching for better performance.
 */
async function searchAstroFile(
	filePath: string,
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	try {
		// Use cached parsed file
		const cached = await getCachedParsedFile(filePath)
		if (!cached) return undefined

		const { lines, ast, variableDefinitions } = cached

		// Find matching element in template AST
		const match = findElementWithText(ast, tag, textContent, variableDefinitions)

		if (match) {
			// Determine the editable line (definition for variables, usage for static)
			const editableLine = match.type === 'variable' && match.definitionLine
				? match.definitionLine
				: match.line

			// Get the source snippet - innerHTML for static content, definition line for variables
			let snippet: string
			if (match.type === 'static') {
				// For static content, extract only the innerHTML (not the wrapper element)
				const completeSnippet = extractCompleteTagSnippet(lines, editableLine - 1, tag)
				snippet = extractInnerHtmlFromSnippet(completeSnippet, tag) ?? completeSnippet
			} else {
				// For variables/props, just the definition line with indentation
				snippet = lines[editableLine - 1] || ''
			}

			return {
				file: path.relative(getProjectRoot(), filePath),
				line: editableLine,
				snippet,
				type: match.type,
				variableName: match.variableName,
				definitionLine: match.type === 'variable' ? match.definitionLine : undefined,
			}
		}
	} catch {
		// Error reading/parsing file
	}

	return undefined
}

/**
 * Search for prop values passed to components using AST parsing.
 * Uses caching for better performance.
 */
async function searchForPropInParents(dir: string, textContent: string): Promise<SourceLocation | undefined> {
	const entries = await fs.readdir(dir, { withFileTypes: true })

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)

		if (entry.isDirectory()) {
			const result = await searchForPropInParents(fullPath, textContent)
			if (result) return result
		} else if (entry.isFile() && entry.name.endsWith('.astro')) {
			try {
				// Use cached parsed file
				const cached = await getCachedParsedFile(fullPath)
				if (!cached) continue

				const { lines, ast } = cached

				// Find component props matching our text
				const propMatch = findComponentProp(ast, textContent)

				if (propMatch) {
					// Extract component snippet for context
					const componentStart = propMatch.line - 1
					const snippetLines: string[] = []
					let depth = 0

					for (let i = componentStart; i < Math.min(componentStart + 10, lines.length); i++) {
						const line = lines[i]
						if (!line) continue
						snippetLines.push(line)

						// Check for self-closing or end of opening tag
						if (line.includes('/>')) {
							break
						}
						if (line.includes('>') && !line.includes('/>')) {
							// Count opening tags
							const opens = (line.match(/<[A-Z]/g) || []).length
							const closes = (line.match(/\/>/g) || []).length
							depth += opens - closes
							if (depth <= 0 || (i > componentStart && line.includes('>'))) {
								break
							}
						}
					}

					return {
						file: path.relative(getProjectRoot(), fullPath),
						line: propMatch.line,
						snippet: snippetLines.join('\n'),
						type: 'prop',
						variableName: propMatch.propName,
					}
				}
			} catch {
				// Error parsing file, continue
			}
		}
	}

	return undefined
}

/**
 * Extract complete tag snippet including content and indentation.
 * Exported for use in html-processor to populate sourceSnippet.
 *
 * When startLine points to a line inside the element (e.g., the text content line),
 * this function searches backwards to find the opening tag first.
 */
export function extractCompleteTagSnippet(lines: string[], startLine: number, tag: string): string {
	// Pattern to match opening tag - either followed by whitespace/>, or at end of line (multi-line tag)
	const openTagPattern = new RegExp(`<${tag}(?:[\\s>]|$)`, 'gi')

	// Check if the start line contains the opening tag
	let actualStartLine = startLine
	const startLineContent = lines[startLine] || ''
	if (!openTagPattern.test(startLineContent)) {
		// Search backwards to find the opening tag
		for (let i = startLine - 1; i >= Math.max(0, startLine - 20); i--) {
			const line = lines[i]
			if (!line) continue

			// Reset regex lastIndex for fresh test
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

	// Start from the opening tag line
	for (let i = actualStartLine; i < Math.min(actualStartLine + 30, lines.length); i++) {
		const line = lines[i]

		if (!line) {
			continue
		}

		snippetLines.push(line)

		// Count opening and closing tags
		// Opening tag can be followed by whitespace, >, or end of line (multi-line tag)
		const openTags = (line.match(new RegExp(`<${tag}(?:[\\s>]|$)`, 'gi')) || []).length
		const selfClosing = (line.match(new RegExp(`<${tag}[^>]*/>`, 'gi')) || []).length
		const closeTags = (line.match(new RegExp(`</${tag}>`, 'gi')) || []).length

		depth += openTags - selfClosing - closeTags

		// If we found a self-closing tag or closed all tags, we're done
		if (selfClosing > 0 || (depth <= 0 && (closeTags > 0 || openTags > 0))) {
			foundClosing = true
			break
		}
	}

	// If we didn't find closing tag, just return the first line
	if (!foundClosing && snippetLines.length > 1) {
		return snippetLines[0]!
	}

	return snippetLines.join('\n')
}

/**
 * Extract innerHTML from a complete tag snippet.
 * Given `<p class="foo">content here</p>`, returns `content here`.
 *
 * @param snippet - The complete tag snippet from source
 * @param tag - The tag name (e.g., 'p', 'h1')
 * @returns The innerHTML portion, or undefined if can't extract
 */
export function extractInnerHtmlFromSnippet(snippet: string, tag: string): string | undefined {
	// Match opening tag (with any attributes) and extract content until closing tag
	// Handle both single-line and multi-line cases
	const openTagPattern = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'i')
	const closeTagPattern = new RegExp(`</${tag}>`, 'i')

	const openMatch = snippet.match(openTagPattern)
	if (!openMatch) return undefined

	const openTagEnd = openMatch.index! + openMatch[0].length
	const closeMatch = snippet.match(closeTagPattern)
	if (!closeMatch) return undefined

	const closeTagStart = closeMatch.index!

	// Extract content between opening and closing tags
	if (closeTagStart > openTagEnd) {
		return snippet.substring(openTagEnd, closeTagStart)
	}

	return undefined
}

/**
 * Read source file and extract the innerHTML at the specified line.
 *
 * @param sourceFile - Path to source file (relative to cwd)
 * @param sourceLine - 1-indexed line number
 * @param tag - The tag name
 * @returns The innerHTML from source, or undefined if can't extract
 */
export async function extractSourceInnerHtml(
	sourceFile: string,
	sourceLine: number,
	tag: string,
): Promise<string | undefined> {
	try {
		const filePath = path.isAbsolute(sourceFile)
			? sourceFile
			: path.join(getProjectRoot(), sourceFile)

		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		// Extract the complete tag snippet
		const snippet = extractCompleteTagSnippet(lines, sourceLine - 1, tag)

		// Extract innerHTML from the snippet
		return extractInnerHtmlFromSnippet(snippet, tag)
	} catch {
		return undefined
	}
}

/**
 * Normalize text for comparison (handles escaping and entities)
 */
function normalizeText(text: string): string {
	return text
		.trim()
		.replace(/\\'/g, "'") // Escaped single quotes
		.replace(/\\"/g, '"') // Escaped double quotes
		.replace(/&#39;/g, "'") // HTML entity for apostrophe
		.replace(/&quot;/g, '"') // HTML entity for quote
		.replace(/&apos;/g, "'") // HTML entity for apostrophe (alternative)
		.replace(/&amp;/g, '&') // HTML entity for ampersand
		.replace(/\s+/g, ' ') // Normalize whitespace
		.toLowerCase()
}

/**
 * Find markdown collection file for a given page path
 * @param pagePath - The URL path of the page (e.g., '/services/3d-tisk')
 * @param contentDir - The content directory (default: 'src/content')
 * @returns Collection info if found, undefined otherwise
 */
export async function findCollectionSource(
	pagePath: string,
	contentDir: string = 'src/content',
): Promise<CollectionInfo | undefined> {
	// Remove leading/trailing slashes
	const cleanPath = pagePath.replace(/^\/+|\/+$/g, '')
	const pathParts = cleanPath.split('/')

	if (pathParts.length < 2) {
		// Need at least collection/slug
		return undefined
	}

	const contentPath = path.join(getProjectRoot(), contentDir)

	try {
		// Check if content directory exists
		await fs.access(contentPath)
	} catch {
		return undefined
	}

	// Try different collection/slug combinations
	// Strategy 1: First segment is collection, rest is slug
	// e.g., /services/3d-tisk -> collection: services, slug: 3d-tisk
	const collectionName = pathParts[0]
	const slug = pathParts.slice(1).join('/')

	if (!collectionName || !slug) {
		return undefined
	}

	const collectionPath = path.join(contentPath, collectionName)

	try {
		await fs.access(collectionPath)
		const stat = await fs.stat(collectionPath)
		if (!stat.isDirectory()) {
			return undefined
		}
	} catch {
		return undefined
	}

	// Look for markdown files matching the slug
	const mdFile = await findMarkdownFile(collectionPath, slug)
	if (mdFile) {
		return {
			name: collectionName,
			slug,
			file: path.relative(getProjectRoot(), mdFile),
		}
	}

	return undefined
}

/**
 * Find a markdown file in a collection directory by slug
 */
async function findMarkdownFile(collectionPath: string, slug: string): Promise<string | undefined> {
	// Try direct match: slug.md or slug.mdx
	const directPaths = [
		path.join(collectionPath, `${slug}.md`),
		path.join(collectionPath, `${slug}.mdx`),
	]

	for (const p of directPaths) {
		try {
			await fs.access(p)
			return p
		} catch {
			// File doesn't exist, continue
		}
	}

	// Try nested path for slugs with slashes
	const slugParts = slug.split('/')
	if (slugParts.length > 1) {
		const nestedPath = path.join(collectionPath, ...slugParts.slice(0, -1))
		const fileName = slugParts[slugParts.length - 1]
		const nestedPaths = [
			path.join(nestedPath, `${fileName}.md`),
			path.join(nestedPath, `${fileName}.mdx`),
		]
		for (const p of nestedPaths) {
			try {
				await fs.access(p)
				return p
			} catch {
				// File doesn't exist, continue
			}
		}
	}

	// Try index file in slug directory
	const indexPaths = [
		path.join(collectionPath, slug, 'index.md'),
		path.join(collectionPath, slug, 'index.mdx'),
	]

	for (const p of indexPaths) {
		try {
			await fs.access(p)
			return p
		} catch {
			// File doesn't exist, continue
		}
	}

	return undefined
}

/**
 * Get cached markdown file content
 */
async function getCachedMarkdownFile(filePath: string): Promise<{ content: string; lines: string[] } | null> {
	const cached = markdownFileCache.get(filePath)
	if (cached) return cached

	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')
		const entry = { content, lines }
		markdownFileCache.set(filePath, entry)
		return entry
	} catch {
		return null
	}
}

/**
 * Find text content in a markdown file and return source location
 * Only matches frontmatter fields, not body content (body is handled separately as a whole)
 * @param textContent - The text content to search for
 * @param collectionInfo - Collection information (name, slug, file path)
 * @returns Source location if found in frontmatter
 */
export async function findMarkdownSourceLocation(
	textContent: string,
	collectionInfo: CollectionInfo,
): Promise<SourceLocation | undefined> {
	try {
		const filePath = path.join(getProjectRoot(), collectionInfo.file)
		const cached = await getCachedMarkdownFile(filePath)
		if (!cached) return undefined

		const { lines } = cached
		const normalizedSearch = normalizeText(textContent)

		// Parse frontmatter
		let frontmatterEnd = -1
		let inFrontmatter = false

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim()
			if (line === '---') {
				if (!inFrontmatter) {
					inFrontmatter = true
				} else {
					frontmatterEnd = i
					break
				}
			}
		}

		// Search in frontmatter only (for title, subtitle, etc.)
		if (frontmatterEnd > 0) {
			for (let i = 1; i < frontmatterEnd; i++) {
				const line = lines[i]
				if (!line) continue

				// Extract value from YAML key: value
				const match = line.match(/^\s*(\w+):\s*(.+)$/)
				if (match) {
					const key = match[1]
					let value = match[2]?.trim() || ''

					// Handle quoted strings
					if (
						(value.startsWith('"') && value.endsWith('"'))
						|| (value.startsWith("'") && value.endsWith("'"))
					) {
						value = value.slice(1, -1)
					}

					if (normalizeText(value) === normalizedSearch) {
						return {
							file: collectionInfo.file,
							line: i + 1,
							snippet: line,
							type: 'collection',
							variableName: key,
							collectionName: collectionInfo.name,
							collectionSlug: collectionInfo.slug,
						}
					}
				}
			}
		}

		// Body content is not searched line-by-line anymore
		// Use parseMarkdownContent to get the full body as one entry
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Parse markdown file and extract frontmatter fields and full body content.
 * Uses caching for better performance.
 * @param collectionInfo - Collection information (name, slug, file path)
 * @returns Parsed markdown content with frontmatter and body
 */
export async function parseMarkdownContent(
	collectionInfo: CollectionInfo,
): Promise<MarkdownContent | undefined> {
	try {
		const filePath = path.join(getProjectRoot(), collectionInfo.file)
		const cached = await getCachedMarkdownFile(filePath)
		if (!cached) return undefined

		const { lines } = cached

		// Parse frontmatter
		let frontmatterStart = -1
		let frontmatterEnd = -1

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim()
			if (line === '---') {
				if (frontmatterStart === -1) {
					frontmatterStart = i
				} else {
					frontmatterEnd = i
					break
				}
			}
		}

		const frontmatter: Record<string, { value: string; line: number }> = {}

		// Extract frontmatter fields
		if (frontmatterEnd > 0) {
			for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
				const line = lines[i]
				if (!line) continue

				// Extract value from YAML key: value (simple single-line values only)
				const match = line.match(/^\s*(\w+):\s*(.+)$/)
				if (match) {
					const key = match[1]
					let value = match[2]?.trim() || ''

					// Handle quoted strings
					if (
						(value.startsWith('"') && value.endsWith('"'))
						|| (value.startsWith("'") && value.endsWith("'"))
					) {
						value = value.slice(1, -1)
					}

					if (key && value) {
						frontmatter[key] = { value, line: i + 1 }
					}
				}
			}
		}

		// Extract body (everything after frontmatter)
		const bodyStartLine = frontmatterEnd > 0 ? frontmatterEnd + 1 : 0
		const bodyLines = lines.slice(bodyStartLine)
		const body = bodyLines.join('\n').trim()

		return {
			frontmatter,
			body,
			bodyStartLine: bodyStartLine + 1, // 1-indexed
			file: collectionInfo.file,
			collectionName: collectionInfo.name,
			collectionSlug: collectionInfo.slug,
		}
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Strip markdown syntax for text comparison
 */
function stripMarkdownSyntax(text: string): string {
	return text
		.replace(/^#+\s+/, '') // Headers
		.replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
		.replace(/\*([^*]+)\*/g, '$1') // Italic
		.replace(/__([^_]+)__/g, '$1') // Bold (underscore)
		.replace(/_([^_]+)_/g, '$1') // Italic (underscore)
		.replace(/`([^`]+)`/g, '$1') // Inline code
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
		.replace(/^\s*[-*+]\s+/, '') // List items
		.replace(/^\s*\d+\.\s+/, '') // Numbered lists
		.trim()
}

/**
 * Enhance manifest entries with actual source snippets from source files.
 * This reads the source files and extracts the innerHTML at the specified locations.
 * For images, it finds the correct line containing the src attribute.
 *
 * @param entries - Manifest entries to enhance
 * @returns Enhanced entries with sourceSnippet populated
 */
export async function enhanceManifestWithSourceSnippets(
	entries: Record<string, ManifestEntry>,
): Promise<Record<string, ManifestEntry>> {
	const enhanced: Record<string, ManifestEntry> = {}

	// Process entries in parallel for better performance
	const entryPromises = Object.entries(entries).map(async ([id, entry]) => {
		// Handle image entries specially - find the line with src attribute
		if (entry.sourceType === 'image' && entry.imageMetadata?.src) {
			const imageLocation = await findImageSourceLocation(entry.imageMetadata.src)
			if (imageLocation) {
				const sourceHash = generateSourceHash(imageLocation.snippet || entry.imageMetadata.src)
				return [id, {
					...entry,
					sourcePath: imageLocation.file,
					sourceLine: imageLocation.line,
					sourceSnippet: imageLocation.snippet,
					sourceHash,
				}] as const
			}
			return [id, entry] as const
		}

		// Skip if already has sourceSnippet or missing source info
		if (entry.sourceSnippet || !entry.sourcePath || !entry.sourceLine || !entry.tag) {
			return [id, entry] as const
		}

		// Extract the actual source innerHTML
		const sourceSnippet = await extractSourceInnerHtml(
			entry.sourcePath,
			entry.sourceLine,
			entry.tag,
		)

		if (sourceSnippet) {
			// Generate hash of source snippet for conflict detection
			const sourceHash = generateSourceHash(sourceSnippet)
			return [id, { ...entry, sourceSnippet, sourceHash }] as const
		}

		return [id, entry] as const
	})

	const results = await Promise.all(entryPromises)
	for (const [id, entry] of results) {
		enhanced[id] = entry
	}

	return enhanced
}
