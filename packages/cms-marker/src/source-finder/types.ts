import type { Node as AstroNode } from '@astrojs/compiler/types'

// ============================================================================
// Import and Variable Information
// ============================================================================

/** Import information from frontmatter */
export interface ImportInfo {
	/** Local name of the imported binding */
	localName: string
	/** Original exported name (or 'default' for default imports) */
	importedName: string
	/** The import source path (e.g., './config', '../data/nav') */
	source: string
}

export interface VariableDefinition {
	name: string
	value: string
	line: number
	/** For object properties, the parent variable name */
	parentName?: string
}

// ============================================================================
// Cached File Types
// ============================================================================

export interface CachedParsedFile {
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

// ============================================================================
// Search Index Types
// ============================================================================

/** Pre-built search index for fast lookups */
export interface SearchIndexEntry {
	file: string
	line: number
	snippet: string
	type: 'static' | 'variable' | 'prop' | 'computed'
	variableName?: string
	definitionLine?: number
	normalizedText: string
	tag: string
}

export interface ImageIndexEntry {
	file: string
	line: number
	snippet: string
	src: string
}

// ============================================================================
// Source Location Types (Public API)
// ============================================================================

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
// AST Parsing Types
// ============================================================================

export interface ParsedAstroFile {
	ast: AstroNode
	frontmatterContent: string | null
	frontmatterStartLine: number
}

/** Minimal Babel AST node type for our usage */
export interface BabelNode {
	type: string
	[key: string]: unknown
}

/** Minimal Babel File type */
export interface BabelFile {
	type: 'File'
	program: BabelNode & { body: BabelNode[] }
}

// ============================================================================
// Match Result Types
// ============================================================================

export interface TemplateMatch {
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
export interface FindElementResult {
	/** The best match found (local variables or static content) */
	bestMatch: TemplateMatch | null
	/** All prop-based matches for the tag (need cross-file verification) */
	propCandidates: TemplateMatch[]
	/** All import-based matches for the tag (need cross-file verification) */
	importCandidates: TemplateMatch[]
}

export interface ComponentPropMatch {
	line: number
	propName: string
	propValue: string
}

export interface ExpressionPropMatch {
	componentName: string
	propName: string
	/** The expression text (e.g., 'navItems' from items={navItems}) */
	expressionText: string
	line: number
}

export interface SpreadPropMatch {
	componentName: string
	/** The variable name being spread (e.g., 'cardProps' from {...cardProps}) */
	spreadVarName: string
	line: number
}

export interface ImageMatch {
	line: number
	src: string
	snippet: string
}

// ============================================================================
// Line Transformer for AST Extraction
// ============================================================================

/**
 * Transforms Babel line numbers to actual file line numbers.
 * Babel parses content starting at line 1, but frontmatter content
 * may start at a different line in the actual file.
 */
export type LineTransformer = (babelLine: number) => number

/** Identity transformer - use for standalone files where Babel line = file line */
export const identityLine: LineTransformer = (line) => line

/** Create a transformer for frontmatter content that starts at a specific line */
export const createFrontmatterLineTransformer = (startLine: number): LineTransformer => (babelLine) => (babelLine - 1) + startLine
