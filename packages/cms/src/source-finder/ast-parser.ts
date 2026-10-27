import type { Node as AstroNode } from '@astrojs/compiler/types'
import { parse as parseBabel } from '@babel/parser'

import { getErrorCollector } from '../error-collector.ts'
import { currentProjectContext, projectFiles } from '../project/context.ts'
import { getParsedFileCache } from './cache.ts'
import type { BabelFile, CachedParsedFile, ParsedAstroFile } from './types.ts'
import { extractImports, extractPropAliases, extractVariableDefinitions } from './variable-extraction.ts'

// ============================================================================
// Astro File Parsing
// ============================================================================

/**
 * Parse an Astro file and return both template AST and frontmatter content
 */
export async function parseAstroFile(content: string): Promise<ParsedAstroFile> {
	const result = await currentProjectContext().parseAstro(content, { position: true })

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
export function parseFrontmatter(content: string, filePath?: string): BabelFile | null {
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

// ============================================================================
// Cached File Access
// ============================================================================

/**
 * Get a cached parsed file, parsing it if not cached.
 * Concurrent requests for the same file are deduplicated to avoid
 * redundant parsing and potential race conditions.
 */
export async function getCachedParsedFile(filePath: string): Promise<CachedParsedFile | null> {
	const cache = getParsedFileCache()
	const cached = cache.get(filePath)
	if (cached) return cached

	// Deduplicate concurrent requests for the same file
	const inFlightParsing = currentProjectContext().state.parsing
	const inFlight = inFlightParsing.get(filePath)
	if (inFlight) return inFlight

	const promise = parseAndCacheFile(filePath, cache)
	inFlightParsing.set(filePath, promise)

	try {
		return await promise
	} finally {
		inFlightParsing.delete(filePath)
	}
}

async function parseAndCacheFile(
	filePath: string,
	cache: Map<string, CachedParsedFile>,
): Promise<CachedParsedFile | null> {
	try {
		const content = await projectFiles().readFile(filePath)
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
			cache.set(filePath, entry)
			return entry
		}

		const { ast, frontmatterContent, frontmatterStartLine } = await parseAstroFile(content)

		let variableDefinitions: CachedParsedFile['variableDefinitions'] = []
		let propAliases: Map<string, string> = new Map()
		let imports: CachedParsedFile['imports'] = []
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

		cache.set(filePath, entry)
		return entry
	} catch {
		return null
	}
}
