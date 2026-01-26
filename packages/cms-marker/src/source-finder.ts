import { parse as parseAstro } from '@astrojs/compiler'
import type { ComponentNode, ElementNode, Node as AstroNode, TextNode } from '@astrojs/compiler/types'
import { parse as parseBabel } from '@babel/parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from './config'
import { getErrorCollector } from './error-collector'
import type { ManifestEntry } from './types'
import { generateSourceHash } from './utils'

// ============================================================================
// File Parsing Cache - Avoid re-parsing the same files
// ============================================================================

/** Import information from frontmatter */
interface ImportInfo {
	/** Local name of the imported binding */
	localName: string
	/** Original exported name (or 'default' for default imports) */
	importedName: string
	/** The import source path (e.g., './config', '../data/nav') */
	source: string
}

interface CachedParsedFile {
	content: string
	lines: string[]
	ast: AstroNode
	frontmatterContent: string | null
	frontmatterStartLine: number
	variableDefinitions: VariableDefinition[]
	/** Mapping of local variable names to prop names from Astro.props destructuring
	 *  e.g., { navItems: 'items' } for `const { items: navItems } = Astro.props` */
	propAliases: Map<string, string>
	/** Import information from frontmatter */
	imports: ImportInfo[]
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
				propAliases: new Map(),
				imports: [],
			}
			parsedFileCache.set(filePath, entry)
			return entry
		}

		const { ast, frontmatterContent, frontmatterStartLine } = await parseAstroFile(content)

		let variableDefinitions: VariableDefinition[] = []
		let propAliases = new Map<string, string>()
		let imports: ImportInfo[] = []
		if (frontmatterContent) {
			const frontmatterAst = parseFrontmatter(frontmatterContent, filePath)
			if (frontmatterAst) {
				variableDefinitions = extractVariableDefinitions(frontmatterAst, frontmatterStartLine)
				propAliases = extractPropAliases(frontmatterAst)
				imports = extractImports(frontmatterAst)
			}
		}

		const entry: CachedParsedFile = {
			content,
			lines,
			ast,
			frontmatterContent,
			frontmatterStartLine,
			variableDefinitions,
			propAliases,
			imports,
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

								textSearchIndex.push({
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

/**
 * Parse an expression path and extract the full path for variable lookup.
 * Handles patterns like: varName, obj.prop, items[0], config.nav.title, links[0].text
 * @returns The full expression path or null if not a simple variable reference
 */
function parseExpressionPath(exprText: string): string | null {
	// Match patterns like: varName, obj.prop, items[0], config.nav.title, links[0].text
	// Pattern breakdown: word characters, dots, and bracket notation with numbers
	const match = exprText.match(/^\s*([\w]+(?:\.[\w]+|\[\d+\])*(?:\.[\w]+)?)\s*$/)
	if (match) {
		return match[1]!
	}
	return null
}

/**
 * Build the full path for a variable definition.
 * For array indices (numeric names), uses bracket notation: items[0]
 * For object properties, uses dot notation: config.nav.title
 */
function buildDefinitionPath(def: VariableDefinition): string {
	if (!def.parentName) {
		return def.name
	}
	// Check if the name is a numeric index (for arrays)
	if (/^\d+$/.test(def.name)) {
		return `${def.parentName}[${def.name}]`
	}
	return `${def.parentName}.${def.name}`
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

/** Minimal Babel AST node type for our usage */
interface BabelNode {
	type: string
	[key: string]: unknown
}

/** Minimal Babel File type */
interface BabelFile {
	type: 'File'
	program: BabelNode & { body: BabelNode[] }
}

/**
 * Parse frontmatter JavaScript/TypeScript with Babel
 * @param content - The frontmatter content to parse
 * @param filePath - Optional file path for error reporting
 */
function parseFrontmatter(content: string, filePath?: string): BabelFile | null {
	try {
		return parseBabel(content, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		}) as unknown as BabelFile
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
function extractVariableDefinitions(ast: BabelFile, frontmatterStartLine: number): VariableDefinition[] {
	const definitions: VariableDefinition[] = []

	function getStringValue(node: BabelNode): string | null {
		if (node.type === 'StringLiteral') {
			return node.value as string
		}
		if (node.type === 'TemplateLiteral') {
			const quasis = node.quasis as Array<{ value: { cooked: string | null } }> | undefined
			const expressions = node.expressions as unknown[] | undefined
			if (quasis?.length === 1 && expressions?.length === 0) {
				return quasis[0]?.value.cooked ?? null
			}
		}
		return null
	}

	function babelLineToFileLine(babelLine: number): number {
		// Babel's line 1 = frontmatterStartLine in the actual file
		return (babelLine - 1) + frontmatterStartLine
	}

	/**
	 * Recursively extract properties from an object expression
	 * @param objNode - The ObjectExpression node
	 * @param parentPath - The full path to this object (e.g., 'config' or 'config.nav')
	 */
	function extractObjectProperties(objNode: BabelNode, parentPath: string): void {
		const properties = objNode.properties as BabelNode[] | undefined
		for (const prop of properties ?? []) {
			if (prop.type !== 'ObjectProperty') continue
			const key = prop.key as BabelNode | undefined
			const value = prop.value as BabelNode | undefined
			if (!key || key.type !== 'Identifier' || !value) continue

			const propName = key.name as string
			const fullPath = `${parentPath}.${propName}`
			const propLoc = prop.loc as { start: { line: number } } | undefined
			const propLine = babelLineToFileLine(propLoc?.start.line ?? 1)

			const stringValue = getStringValue(value)
			if (stringValue !== null) {
				definitions.push({
					name: propName,
					value: stringValue,
					line: propLine,
					parentName: parentPath,
				})
			}

			// Recurse for nested objects
			if (value.type === 'ObjectExpression') {
				extractObjectProperties(value, fullPath)
			}

			// Handle arrays within objects
			if (value.type === 'ArrayExpression') {
				extractArrayElements(value, fullPath, propLine)
			}
		}
	}

	/**
	 * Extract elements from an array expression
	 * @param arrNode - The ArrayExpression node
	 * @param parentPath - The full path to this array (e.g., 'items' or 'config.items')
	 * @param defaultLine - Fallback line if element has no location
	 */
	function extractArrayElements(arrNode: BabelNode, parentPath: string, defaultLine: number): void {
		const elements = arrNode.elements as BabelNode[] | undefined
		for (let i = 0; i < (elements?.length ?? 0); i++) {
			const elem = elements![i]
			if (!elem) continue

			const elemLoc = elem.loc as { start: { line: number } } | undefined
			const elemLine = babelLineToFileLine(elemLoc?.start.line ?? defaultLine)
			const indexPath = `${parentPath}[${i}]`

			// Handle string values in array
			const elemValue = getStringValue(elem)
			if (elemValue !== null) {
				definitions.push({
					name: String(i),
					value: elemValue,
					line: elemLine,
					parentName: parentPath,
				})
			}

			// Handle array of objects: [{ text: 'Home' }]
			if (elem.type === 'ObjectExpression') {
				const objProperties = elem.properties as BabelNode[] | undefined
				for (const prop of objProperties ?? []) {
					if (prop.type !== 'ObjectProperty') continue
					const key = prop.key as BabelNode | undefined
					const value = prop.value as BabelNode | undefined
					if (!key || key.type !== 'Identifier' || !value) continue

					const propName = key.name as string
					const propLoc = prop.loc as { start: { line: number } } | undefined
					const propLine = babelLineToFileLine(propLoc?.start.line ?? elemLine)

					const stringValue = getStringValue(value)
					if (stringValue !== null) {
						definitions.push({
							name: propName,
							value: stringValue,
							line: propLine,
							parentName: indexPath,
						})
					}

					// Recurse for nested objects within array elements
					if (value.type === 'ObjectExpression') {
						extractObjectProperties(value, `${indexPath}.${propName}`)
					}
				}
			}
		}
	}

	function visitNode(node: BabelNode) {
		if (node.type === 'VariableDeclaration') {
			const declarations = node.declarations as BabelNode[] | undefined
			for (const decl of declarations ?? []) {
				const id = decl.id as BabelNode | undefined
				const init = decl.init as BabelNode | undefined
				if (id?.type === 'Identifier' && init) {
					const varName = id.name as string
					const loc = decl.loc as { start: { line: number } } | undefined
					const line = babelLineToFileLine(loc?.start.line ?? 1)

					// Simple string value
					const stringValue = getStringValue(init)
					if (stringValue !== null) {
						definitions.push({ name: varName, value: stringValue, line })
					}

					// Object expression - extract properties recursively
					if (init.type === 'ObjectExpression') {
						extractObjectProperties(init, varName)
					}

					// Array expression - extract elements
					if (init.type === 'ArrayExpression') {
						extractArrayElements(init, varName, line)
					}
				}
			}
		}

		// Recursively visit child nodes
		for (const key of Object.keys(node)) {
			const value = node[key]
			if (value && typeof value === 'object') {
				if (Array.isArray(value)) {
					for (const item of value) {
						if (item && typeof item === 'object' && 'type' in item) {
							visitNode(item as BabelNode)
						}
					}
				} else if ('type' in value) {
					visitNode(value as BabelNode)
				}
			}
		}
	}

	visitNode(ast.program)
	return definitions
}

/**
 * Extract prop aliases from Astro.props destructuring patterns.
 * Returns a Map of local variable name -> prop name.
 * Examples:
 *   const { title } = Astro.props         -> Map { 'title' => 'title' }
 *   const { items: navItems } = Astro.props -> Map { 'navItems' => 'items' }
 */
function extractPropAliases(ast: BabelFile): Map<string, string> {
	const propAliases = new Map<string, string>()

	function visitNode(node: BabelNode) {
		if (node.type === 'VariableDeclaration') {
			const declarations = node.declarations as BabelNode[] | undefined
			for (const decl of declarations ?? []) {
				const id = decl.id as BabelNode | undefined
				const init = decl.init as BabelNode | undefined

				// Check for destructuring from Astro.props
				// Pattern: const { x, y } = Astro.props;
				if (id?.type === 'ObjectPattern' && init?.type === 'MemberExpression') {
					const object = init.object as BabelNode | undefined
					const property = init.property as BabelNode | undefined

					if (
						object?.type === 'Identifier'
						&& (object.name as string) === 'Astro'
						&& property?.type === 'Identifier'
						&& (property.name as string) === 'props'
					) {
						// Extract property names from the destructuring pattern
						const properties = id.properties as BabelNode[] | undefined
						for (const prop of properties ?? []) {
							if (prop.type === 'ObjectProperty') {
								const key = prop.key as BabelNode | undefined
								const value = prop.value as BabelNode | undefined

								if (key?.type === 'Identifier') {
									const propName = key.name as string
									// Check for renaming: { items: navItems }
									// key is the prop name (items), value is the local name (navItems)
									if (value?.type === 'Identifier') {
										const localName = value.name as string
										propAliases.set(localName, propName)
									} else if (value?.type === 'AssignmentPattern') {
										// Handle default values: { items: navItems = [] } or { items = [] }
										const left = value.left as BabelNode | undefined
										if (left?.type === 'Identifier') {
											propAliases.set(left.name as string, propName)
										}
									} else {
										// Simple case: { items } - key and value are the same
										propAliases.set(propName, propName)
									}
								}
							} else if (prop.type === 'RestElement') {
								// Handle rest pattern: const { x, ...rest } = Astro.props;
								const argument = prop.argument as BabelNode | undefined
								if (argument?.type === 'Identifier') {
									// Rest element captures all remaining props
									propAliases.set(argument.name as string, '...')
								}
							}
						}
					}
				}
			}
		}

		// Recursively visit child nodes
		for (const key of Object.keys(node)) {
			const value = node[key]
			if (value && typeof value === 'object') {
				if (Array.isArray(value)) {
					for (const item of value) {
						if (item && typeof item === 'object' && 'type' in item) {
							visitNode(item as BabelNode)
						}
					}
				} else if ('type' in value) {
					visitNode(value as BabelNode)
				}
			}
		}
	}

	visitNode(ast.program)
	return propAliases
}

/**
 * Extract import information from Babel AST.
 * Handles:
 *   import { foo } from './file'           -> { localName: 'foo', importedName: 'foo', source: './file' }
 *   import { foo as bar } from './file'    -> { localName: 'bar', importedName: 'foo', source: './file' }
 *   import foo from './file'               -> { localName: 'foo', importedName: 'default', source: './file' }
 *   import * as foo from './file'          -> { localName: 'foo', importedName: '*', source: './file' }
 */
function extractImports(ast: BabelFile): ImportInfo[] {
	const imports: ImportInfo[] = []

	for (const node of ast.program.body) {
		if (node.type === 'ImportDeclaration') {
			const source = (node.source as BabelNode)?.value as string
			if (!source) continue

			const specifiers = node.specifiers as BabelNode[] | undefined
			for (const spec of specifiers ?? []) {
				if (spec.type === 'ImportSpecifier') {
					// Named import: import { foo } from './file' or import { foo as bar } from './file'
					const imported = spec.imported as BabelNode | undefined
					const local = spec.local as BabelNode | undefined
					if (imported?.type === 'Identifier' && local?.type === 'Identifier') {
						imports.push({
							localName: local.name as string,
							importedName: imported.name as string,
							source,
						})
					}
				} else if (spec.type === 'ImportDefaultSpecifier') {
					// Default import: import foo from './file'
					const local = spec.local as BabelNode | undefined
					if (local?.type === 'Identifier') {
						imports.push({
							localName: local.name as string,
							importedName: 'default',
							source,
						})
					}
				} else if (spec.type === 'ImportNamespaceSpecifier') {
					// Namespace import: import * as foo from './file'
					const local = spec.local as BabelNode | undefined
					if (local?.type === 'Identifier') {
						imports.push({
							localName: local.name as string,
							importedName: '*',
							source,
						})
					}
				}
			}
		}
	}

	return imports
}

/**
 * Resolve an import source path to an absolute file path.
 * Handles relative paths and tries common extensions.
 */
async function resolveImportPath(source: string, fromFile: string): Promise<string | null> {
	// Only handle relative imports
	if (!source.startsWith('.')) {
		return null
	}

	const fromDir = path.dirname(fromFile)
	const basePath = path.resolve(fromDir, source)

	// Try different extensions
	const extensions = ['.ts', '.js', '.astro', '.tsx', '.jsx', '']
	for (const ext of extensions) {
		const fullPath = basePath + ext
		try {
			await fs.access(fullPath)
			return fullPath
		} catch {
			// File doesn't exist with this extension
		}
	}

	// Try index files
	for (const ext of ['.ts', '.js', '.tsx', '.jsx']) {
		const indexPath = path.join(basePath, `index${ext}`)
		try {
			await fs.access(indexPath)
			return indexPath
		} catch {
			// File doesn't exist
		}
	}

	return null
}

/**
 * Parse a TypeScript/JavaScript file and extract exported variable definitions.
 */
async function getExportedDefinitions(filePath: string): Promise<VariableDefinition[]> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const ast = parseBabel(content, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		}) as unknown as BabelFile

		const definitions: VariableDefinition[] = []
		const lines = content.split('\n')

		function getStringValue(node: BabelNode): string | null {
			if (node.type === 'StringLiteral') {
				return node.value as string
			}
			if (node.type === 'TemplateLiteral') {
				const quasis = node.quasis as Array<{ value: { cooked: string | null } }> | undefined
				const expressions = node.expressions as unknown[] | undefined
				if (quasis?.length === 1 && expressions?.length === 0) {
					return quasis[0]?.value.cooked ?? null
				}
			}
			return null
		}

		function extractObjectProperties(objNode: BabelNode, parentPath: string, line: number): void {
			const properties = objNode.properties as BabelNode[] | undefined
			for (const prop of properties ?? []) {
				if (prop.type !== 'ObjectProperty') continue
				const key = prop.key as BabelNode | undefined
				const value = prop.value as BabelNode | undefined
				if (!key || key.type !== 'Identifier' || !value) continue

				const propName = key.name as string
				const fullPath = `${parentPath}.${propName}`
				const propLoc = prop.loc as { start: { line: number } } | undefined
				const propLine = propLoc?.start.line ?? line

				const stringValue = getStringValue(value)
				if (stringValue !== null) {
					definitions.push({
						name: propName,
						value: stringValue,
						line: propLine,
						parentName: parentPath,
					})
				}

				if (value.type === 'ObjectExpression') {
					extractObjectProperties(value, fullPath, propLine)
				}

				if (value.type === 'ArrayExpression') {
					extractArrayElements(value, fullPath, propLine)
				}
			}
		}

		function extractArrayElements(arrNode: BabelNode, parentPath: string, defaultLine: number): void {
			const elements = arrNode.elements as BabelNode[] | undefined
			for (let i = 0; i < (elements?.length ?? 0); i++) {
				const elem = elements![i]
				if (!elem) continue

				const elemLoc = elem.loc as { start: { line: number } } | undefined
				const elemLine = elemLoc?.start.line ?? defaultLine
				const indexPath = `${parentPath}[${i}]`

				const elemValue = getStringValue(elem)
				if (elemValue !== null) {
					definitions.push({
						name: String(i),
						value: elemValue,
						line: elemLine,
						parentName: parentPath,
					})
				}

				if (elem.type === 'ObjectExpression') {
					const objProperties = elem.properties as BabelNode[] | undefined
					for (const prop of objProperties ?? []) {
						if (prop.type !== 'ObjectProperty') continue
						const key = prop.key as BabelNode | undefined
						const value = prop.value as BabelNode | undefined
						if (!key || key.type !== 'Identifier' || !value) continue

						const propName = key.name as string
						const propLoc = prop.loc as { start: { line: number } } | undefined
						const propLine = propLoc?.start.line ?? elemLine

						const stringValue = getStringValue(value)
						if (stringValue !== null) {
							definitions.push({
								name: propName,
								value: stringValue,
								line: propLine,
								parentName: indexPath,
							})
						}

						if (value.type === 'ObjectExpression') {
							extractObjectProperties(value, `${indexPath}.${propName}`, propLine)
						}
					}
				}
			}
		}

		for (const node of ast.program.body) {
			// Handle: export const foo = 'value'
			if (node.type === 'ExportNamedDeclaration') {
				const declaration = node.declaration as BabelNode | undefined
				if (declaration?.type === 'VariableDeclaration') {
					const declarations = declaration.declarations as BabelNode[] | undefined
					for (const decl of declarations ?? []) {
						const id = decl.id as BabelNode | undefined
						const init = decl.init as BabelNode | undefined
						if (id?.type === 'Identifier' && init) {
							const varName = id.name as string
							const loc = decl.loc as { start: { line: number } } | undefined
							const line = loc?.start.line ?? 1

							const stringValue = getStringValue(init)
							if (stringValue !== null) {
								definitions.push({ name: varName, value: stringValue, line })
							}

							if (init.type === 'ObjectExpression') {
								extractObjectProperties(init, varName, line)
							}

							if (init.type === 'ArrayExpression') {
								extractArrayElements(init, varName, line)
							}
						}
					}
				}
			}

			// Handle: const foo = 'value'; export { foo }
			// First collect all variable declarations
			if (node.type === 'VariableDeclaration') {
				const declarations = node.declarations as BabelNode[] | undefined
				for (const decl of declarations ?? []) {
					const id = decl.id as BabelNode | undefined
					const init = decl.init as BabelNode | undefined
					if (id?.type === 'Identifier' && init) {
						const varName = id.name as string
						const loc = decl.loc as { start: { line: number } } | undefined
						const line = loc?.start.line ?? 1

						const stringValue = getStringValue(init)
						if (stringValue !== null) {
							definitions.push({ name: varName, value: stringValue, line })
						}

						if (init.type === 'ObjectExpression') {
							extractObjectProperties(init, varName, line)
						}

						if (init.type === 'ArrayExpression') {
							extractArrayElements(init, varName, line)
						}
					}
				}
			}
		}

		return definitions
	} catch {
		return []
	}
}

interface TemplateMatch {
	line: number
	type: 'static' | 'variable' | 'computed'
	variableName?: string
	/** For variables, the definition line in frontmatter */
	definitionLine?: number
	/** If true, the expression uses a variable from props that needs cross-file tracking */
	usesProp?: boolean
	/** The prop name if usesProp is true */
	propName?: string
	/** The full expression path if usesProp is true (e.g., 'items[0]') */
	expressionPath?: string
	/** If true, the expression uses a variable from an import */
	usesImport?: boolean
	/** The import info if usesImport is true */
	importInfo?: ImportInfo
}

/** Result type for findElementWithText - returns best match and all prop/import candidates */
interface FindElementResult {
	/** The best match found (local variables or static content) */
	bestMatch: TemplateMatch | null
	/** All prop-based matches for the tag (need cross-file verification) */
	propCandidates: TemplateMatch[]
	/** All import-based matches for the tag (need cross-file verification) */
	importCandidates: TemplateMatch[]
}

/**
 * Walk the Astro AST to find elements matching a tag with specific text content.
 * Returns the best match (local variables or static content) AND all prop/import candidates
 * that need cross-file verification for multiple same-tag elements.
 * @param propAliases - Map of local variable names to prop names from Astro.props (for cross-file tracking)
 * @param imports - Import information from frontmatter (for cross-file tracking)
 */
function findElementWithText(
	ast: AstroNode,
	tag: string,
	searchText: string,
	variableDefinitions: VariableDefinition[],
	propAliases: Map<string, string> = new Map(),
	imports: ImportInfo[] = [],
): FindElementResult {
	const normalizedSearch = normalizeText(searchText)
	const tagLower = tag.toLowerCase()
	let bestMatch: TemplateMatch | null = null
	let bestScore = 0
	const propCandidates: TemplateMatch[] = []
	const importCandidates: TemplateMatch[] = []

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
			// Extract variable paths like {foo}, {foo.bar}, {items[0]}, {config.nav.title}, {links[0].text}
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
	 * Extract the base variable name from an expression path.
	 * e.g., 'items[0]' -> 'items', 'config.nav.title' -> 'config'
	 */
	function getBaseVarName(exprPath: string): string {
		const match = exprPath.match(/^(\w+)/)
		return match?.[1] ?? exprPath
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
				for (const exprPath of exprInfo.varNames) {
					let foundInLocal = false

					for (const def of variableDefinitions) {
						// Build the full definition path for comparison
						const defPath = buildDefinitionPath(def)
						// Check if the expression path matches the definition path
						if (defPath === exprPath) {
							foundInLocal = true
							const normalizedDef = normalizeText(def.value)
							if (normalizedDef === normalizedSearch) {
								// Found a variable match - this is highest priority
								if (bestScore < 100) {
									bestScore = 100
									bestMatch = {
										line,
										type: 'variable',
										variableName: defPath,
										definitionLine: def.line,
									}
								}
								return
							}
						}
					}

					// If not found in local definitions, check if it's from props or imports
					if (!foundInLocal) {
						const baseVar = getBaseVarName(exprPath)

						// Check props first
						const actualPropName = propAliases.get(baseVar)
						if (actualPropName) {
							// This expression uses a prop - collect as candidate for cross-file verification
							// (don't set bestMatch yet - we need to verify each candidate)
							propCandidates.push({
								line,
								type: 'variable',
								usesProp: true,
								propName: actualPropName, // Use the actual prop name, not the local alias
								expressionPath: exprPath,
							})
						} else {
							// Check if it's from an import
							const importInfo = imports.find((imp) => imp.localName === baseVar)
							if (importInfo) {
								// This expression uses an import - collect as candidate for cross-file verification
								importCandidates.push({
									line,
									type: 'variable',
									usesImport: true,
									importInfo,
									expressionPath: exprPath,
								})
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
	return { bestMatch, propCandidates, importCandidates }
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

interface ExpressionPropMatch {
	componentName: string
	propName: string
	/** The expression text (e.g., 'navItems' from items={navItems}) */
	expressionText: string
	line: number
}

interface SpreadPropMatch {
	componentName: string
	/** The variable name being spread (e.g., 'cardProps' from {...cardProps}) */
	spreadVarName: string
	line: number
}

/**
 * Walk the Astro AST to find component usages with expression props.
 * Looks for patterns like: <Nav items={navItems} />
 * @param ast - The Astro AST
 * @param componentName - The component name to search for (e.g., 'Nav')
 * @param propName - The prop name to find (e.g., 'items')
 */
function findExpressionProp(
	ast: AstroNode,
	componentName: string,
	propName: string,
): ExpressionPropMatch | null {
	function visit(node: AstroNode): ExpressionPropMatch | null {
		// Check component nodes matching the name
		if (node.type === 'component') {
			const compNode = node as ComponentNode
			if (compNode.name === componentName) {
				for (const attr of compNode.attributes) {
					// Check for expression attributes: items={navItems}
					if (attr.type === 'attribute' && attr.name === propName && attr.kind === 'expression') {
						// The value contains the expression text
						const exprText = attr.value?.trim() || ''
						if (exprText) {
							return {
								componentName,
								propName,
								expressionText: exprText,
								line: attr.position?.start.line ?? compNode.position?.start.line ?? 0,
							}
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
 * Walk the Astro AST to find component usages with spread props.
 * Looks for patterns like: <Card {...cardProps} />
 * @param ast - The Astro AST
 * @param componentName - The component name to search for (e.g., 'Card')
 */
function findSpreadProp(
	ast: AstroNode,
	componentName: string,
): SpreadPropMatch | null {
	function visit(node: AstroNode): SpreadPropMatch | null {
		// Check component nodes matching the name
		if (node.type === 'component') {
			const compNode = node as ComponentNode
			if (compNode.name === componentName) {
				for (const attr of compNode.attributes) {
					// Check for spread attributes: {...cardProps}
					// In Astro AST: type='attribute', kind='spread', name=variable name
					if (attr.type === 'attribute' && attr.kind === 'spread' && attr.name) {
						return {
							componentName,
							spreadVarName: attr.name,
							line: attr.position?.start.line ?? compNode.position?.start.line ?? 0,
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
 * Search for a component usage with an expression prop across all files.
 * When we find an expression like {items[0]} in a component where items comes from props,
 * we search for where that component is used and track the expression prop back.
 * Supports multi-level prop drilling with a depth limit.
 *
 * @param componentFileName - The file name of the component (e.g., 'Nav.astro')
 * @param propName - The prop name we're looking for (e.g., 'items')
 * @param expressionPath - The full expression path (e.g., 'items[0]')
 * @param searchText - The text content we're searching for
 * @param depth - Current recursion depth (default 0, max 5)
 * @returns Source location if found
 */
async function searchForExpressionProp(
	componentFileName: string,
	propName: string,
	expressionPath: string,
	searchText: string,
	depth: number = 0,
): Promise<SourceLocation | undefined> {
	// Limit recursion depth to prevent infinite loops
	if (depth > 5) return undefined

	const srcDir = path.join(getProjectRoot(), 'src')
	const searchDirs = [
		path.join(srcDir, 'pages'),
		path.join(srcDir, 'components'),
		path.join(srcDir, 'layouts'),
	]

	// Extract the component name from file name (e.g., 'Nav.astro' -> 'Nav')
	const componentName = path.basename(componentFileName, '.astro')
	const normalizedSearch = normalizeText(searchText)

	for (const dir of searchDirs) {
		try {
			const result = await searchDirForExpressionProp(
				dir,
				componentName,
				propName,
				expressionPath,
				normalizedSearch,
				searchText,
				depth,
			)
			if (result) return result
		} catch {
			// Directory doesn't exist, continue
		}
	}

	return undefined
}

async function searchDirForExpressionProp(
	dir: string,
	componentName: string,
	propName: string,
	expressionPath: string,
	normalizedSearch: string,
	searchText: string,
	depth: number,
): Promise<SourceLocation | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchDirForExpressionProp(
					fullPath,
					componentName,
					propName,
					expressionPath,
					normalizedSearch,
					searchText,
					depth,
				)
				if (result) return result
			} else if (entry.isFile() && entry.name.endsWith('.astro')) {
				const cached = await getCachedParsedFile(fullPath)
				if (!cached) continue

				// First, try to find expression prop usage: <Nav items={navItems} />
				const exprPropMatch = findExpressionProp(cached.ast, componentName, propName)

				if (exprPropMatch) {
					// The expression text might be a simple variable like 'navItems'
					const exprText = exprPropMatch.expressionText

					// Build the corresponding path in the parent's variable definitions
					// e.g., if expressionPath is 'items[0]' and exprText is 'navItems',
					// we look for 'navItems[0]' in the parent's definitions
					const parentPath = expressionPath.replace(/^[^.[]+/, exprText)

					// Check if the value is in local variable definitions
					for (const def of cached.variableDefinitions) {
						const defPath = buildDefinitionPath(def)
						if (defPath === parentPath) {
							const normalizedDef = normalizeText(def.value)
							if (normalizedDef === normalizedSearch) {
								return {
									file: path.relative(getProjectRoot(), fullPath),
									line: def.line,
									snippet: cached.lines[def.line - 1] || '',
									type: 'variable',
									variableName: defPath,
									definitionLine: def.line,
								}
							}
						}
					}

					// Check if exprText is itself from props (multi-level prop drilling)
					const baseVar = exprText.match(/^(\w+)/)?.[1]
					if (baseVar && cached.propAliases.has(baseVar)) {
						const actualPropName = cached.propAliases.get(baseVar)!
						// Recursively search for where this component is used
						const result = await searchForExpressionProp(
							entry.name,
							actualPropName,
							parentPath, // Use the path with the parent's variable name
							searchText,
							depth + 1,
						)
						if (result) return result
					}

					continue
				}

				// Second, try to find spread prop usage: <Card {...cardProps} />
				const spreadMatch = findSpreadProp(cached.ast, componentName)

				if (spreadMatch) {
					// Find the spread variable's definition
					const spreadVarName = spreadMatch.spreadVarName

					// The propName we're looking for should be a property of the spread object
					// e.g., if propName is 'title' and spread is {...cardProps},
					// we look for cardProps.title in the definitions
					const spreadPropPath = `${spreadVarName}.${propName}`

					for (const def of cached.variableDefinitions) {
						const defPath = buildDefinitionPath(def)
						if (defPath === spreadPropPath) {
							const normalizedDef = normalizeText(def.value)
							if (normalizedDef === normalizedSearch) {
								return {
									file: path.relative(getProjectRoot(), fullPath),
									line: def.line,
									snippet: cached.lines[def.line - 1] || '',
									type: 'variable',
									variableName: defPath,
									definitionLine: def.line,
								}
							}
						}
					}

					// Check if the spread variable itself comes from props
					if (cached.propAliases.has(spreadVarName)) {
						const actualPropName = cached.propAliases.get(spreadVarName)!
						// For spread from props, we need to search for the full path
						const result = await searchForExpressionProp(
							entry.name,
							actualPropName,
							expressionPath,
							searchText,
							depth + 1,
						)
						if (result) return result
					}
				}
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
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

		const { lines, ast, variableDefinitions, propAliases, imports } = cached

		// Find matching element in template AST
		const { bestMatch, propCandidates, importCandidates } = findElementWithText(
			ast,
			tag,
			textContent,
			variableDefinitions,
			propAliases,
			imports,
		)

		// First, check if we have a direct match (local variable or static content)
		if (bestMatch && !bestMatch.usesProp && !bestMatch.usesImport) {
			// Determine the editable line (definition for variables, usage for static)
			const editableLine = bestMatch.type === 'variable' && bestMatch.definitionLine
				? bestMatch.definitionLine
				: bestMatch.line

			// Get the source snippet - innerHTML for static content, definition line for variables
			let snippet: string
			if (bestMatch.type === 'static') {
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
				type: bestMatch.type,
				variableName: bestMatch.variableName,
				definitionLine: bestMatch.type === 'variable' ? bestMatch.definitionLine : undefined,
			}
		}

		// Try all prop candidates - verify each one to find the correct match
		// (handles multiple same-tag elements with different prop values)
		for (const propCandidate of propCandidates) {
			if (propCandidate.propName && propCandidate.expressionPath) {
				const componentFileName = path.basename(filePath)
				const exprPropResult = await searchForExpressionProp(
					componentFileName,
					propCandidate.propName,
					propCandidate.expressionPath,
					textContent,
				)
				if (exprPropResult) {
					return exprPropResult
				}
			}
		}

		// Try all import candidates - verify each one to find the correct match
		// (handles multiple same-tag elements with different imported values)
		for (const importCandidate of importCandidates) {
			if (importCandidate.importInfo && importCandidate.expressionPath) {
				const importResult = await searchForImportedValue(
					filePath,
					importCandidate.importInfo,
					importCandidate.expressionPath,
					textContent,
				)
				if (importResult) {
					return importResult
				}
			}
		}
	} catch {
		// Error reading/parsing file
	}

	return undefined
}

/**
 * Search for a value in an imported file.
 * @param fromFile - The file that contains the import
 * @param importInfo - Information about the import
 * @param expressionPath - The full expression path (e.g., 'config.title' or 'navItems[0]')
 * @param searchText - The text content we're searching for
 */
async function searchForImportedValue(
	fromFile: string,
	importInfo: ImportInfo,
	expressionPath: string,
	searchText: string,
): Promise<SourceLocation | undefined> {
	// Resolve the import path to an absolute file path
	const importedFilePath = await resolveImportPath(importInfo.source, fromFile)
	if (!importedFilePath) return undefined

	// Get exported definitions from the imported file
	const exportedDefs = await getExportedDefinitions(importedFilePath)
	if (exportedDefs.length === 0) return undefined

	const normalizedSearch = normalizeText(searchText)

	// Build the path we're looking for in the imported file
	// e.g., if expressionPath is 'config.title' and localName is 'config',
	// and importedName is 'siteConfig', we look for 'siteConfig.title'
	let targetPath: string
	if (importInfo.importedName === 'default' || importInfo.importedName === importInfo.localName) {
		// Direct import: import { config } from './file' or import config from './file'
		// The expression path uses the local name, which matches the exported name
		targetPath = expressionPath
	} else {
		// Renamed import: import { config as siteConfig } from './file'
		// Replace the local name with the original exported name
		targetPath = expressionPath.replace(
			new RegExp(`^${importInfo.localName}`),
			importInfo.importedName,
		)
	}

	// Search for the target path in the exported definitions
	for (const def of exportedDefs) {
		const defPath = buildDefinitionPath(def)
		if (defPath === targetPath) {
			const normalizedDef = normalizeText(def.value)
			if (normalizedDef === normalizedSearch) {
				const importedFileContent = await fs.readFile(importedFilePath, 'utf-8')
				const importedLines = importedFileContent.split('\n')

				return {
					file: path.relative(getProjectRoot(), importedFilePath),
					line: def.line,
					snippet: importedLines[def.line - 1] || '',
					type: 'variable',
					variableName: defPath,
					definitionLine: def.line,
				}
			}
		}
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
