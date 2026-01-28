import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import { getCachedParsedFile } from './ast-parser'
import { isSearchIndexInitialized } from './cache'
import { searchForExpressionProp, searchForImportedValue, searchForPropInParents } from './cross-file-tracker'
import { findElementWithText } from './element-finder'
import { findInTextIndex } from './search-index'
import { extractCompleteTagSnippet, extractInnerHtmlFromSnippet } from './snippet-utils'
import type { SourceLocation } from './types'

// ============================================================================
// Main Source Location Finding
// ============================================================================

/**
 * Find source file and line number for text content.
 * Uses pre-built search index for fast lookups.
 */
export async function findSourceLocation(
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	// Use index if available (much faster)
	if (isSearchIndexInitialized()) {
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

// ============================================================================
// Directory Search
// ============================================================================

/**
 * Recursively search directory for matching content
 */
export async function searchDirectory(
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

// ============================================================================
// Astro File Search
// ============================================================================

/**
 * Search a single Astro file for matching content using AST parsing.
 * Uses caching for better performance.
 */
export async function searchAstroFile(
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

			// Get the source snippet - complete element for static content, definition line for variables
			let snippet: string
			if (bestMatch.type === 'static') {
				// For static content, extract the complete element (including wrapper tags)
				snippet = extractCompleteTagSnippet(lines, editableLine - 1, tag)
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
