import path from 'node:path'

import { getProjectRoot } from '../config.ts'
import { projectFiles } from '../project/context.ts'
import { getCachedParsedFile } from './ast-parser.ts'
import { isSearchIndexInitialized } from './cache.ts'
import { searchForExpressionProp, searchForImportedValue, searchForPropInParents } from './cross-file-tracker.ts'
import { findElementWithText } from './element-finder.ts'
import { findInTextIndex } from './search-index.ts'
import { definitionSnippet, extractCompleteTagSnippet, extractOpeningTagSnippet } from './snippet-utils.ts'
import { astroFilesUnder, preferringFiles, projectTemplatesAmong } from './source-files.ts'
import type { SourceLocation } from './types.ts'
import { resolveImportPath } from './variable-extraction.ts'

// ============================================================================
// Main Source Location Finding
// ============================================================================

/**
 * Find source file and line number for text content.
 * Uses pre-built search index for fast lookups.
 *
 * `pageFiles` disambiguates when the same text appears on multiple pages —
 * the lookup prefers index entries whose file is one of the candidates.
 */
export async function findSourceLocation(
	textContent: string,
	tag: string,
	pageFiles?: readonly string[],
	renderedFiles?: readonly string[],
): Promise<SourceLocation | undefined> {
	// Use index if available (much faster)
	if (isSearchIndexInitialized()) {
		const indexHit = findInTextIndex(textContent, tag, pageFiles, renderedFiles)
		if (indexHit) return indexHit
		// Fall through to slow search on miss — covers cases the per-file
		// indexer can't pre-emit, like a child component's `.map()` over a
		// prop array whose source values live in the parent file.
	}

	// Files the page is rendered from are searched first, then components, pages and layouts.
	const srcDir = path.join(getProjectRoot(), 'src')
	const searchDirs = [path.join(srcDir, 'components'), path.join(srcDir, 'pages'), path.join(srcDir, 'layouts')]
	const preferred = [...(pageFiles ?? []), ...(renderedFiles ?? [])]
	for (const filePath of preferringFiles(await astroFilesUnder(searchDirs), preferred)) {
		const result = await searchAstroFile(filePath, textContent, tag)
		if (result) return result
	}

	// If not found directly, try searching for prop values in parent components
	return searchForPropInParents(textContent, preferred)
}

/** Finds the source of a value a page renders, by its text and tag. */
export type PageSourceLookup = (textContent: string, tag: string) => Promise<SourceLocation | undefined>

/**
 * {@link findSourceLocation} for the values one page renders. Until the search index is built, only the
 * files the page is rendered from are searched: the project-wide search parses every template of the
 * project, and a file the page is not rendered from is not the source of its value. Those are
 * `pageFiles` and `renderedFiles`, then, on a miss, the templates they import, a round at a time: a
 * layout that passes a value on to a head component has no element of its own in the HTML. Imports
 * through a module that is not a template (a barrel `index.ts`) are not followed. The rounds are kept
 * for the page's next values, and whether the index is used is decided once for the page.
 */
export function pageSourceLookup(pageFiles: readonly string[], renderedFiles: readonly string[]): PageSourceLookup {
	if (isSearchIndexInitialized()) return (textContent, tag) => findSourceLocation(textContent, tag, pageFiles, renderedFiles)
	const known = projectTemplatesAmong([...pageFiles, ...renderedFiles])
	/** Each round's new files, and the files known once it was added, which its props are followed in. */
	const rounds: Promise<{ files: readonly string[]; within: readonly string[] }>[] = [Promise.resolve({ files: [...known], within: [...known] })]
	const roundAt = (index: number) => {
		while (rounds.length <= index) {
			const previous = rounds[rounds.length - 1] ?? Promise.resolve({ files: [], within: [] })
			rounds.push(previous.then(async ({ files }) => {
				try {
					const imported = files.length === 0 ? [] : await importedTemplates(files, known)
					known.push(...imported)
					return { files: imported, within: [...known] }
				} catch (error) {
					console.error('[cms] Following the imports of a page failed:', error)
					return { files: [], within: [...known] }
				}
			}))
		}
		return rounds[index] ?? Promise.resolve({ files: [], within: [] })
	}
	return async (textContent, tag) => {
		for (let index = 0;; index++) {
			const { files, within } = await roundAt(index)
			if (files.length === 0) return undefined
			for (const filePath of files) {
				const result = await searchAstroFile(filePath, textContent, tag, within)
				if (result) return result
			}
			const fromParents = await searchForPropInParents(textContent, undefined, files)
			if (fromParents) return fromParents
		}
	}
}

/** The project's templates `files` import (absolute), other than those `known`. */
async function importedTemplates(files: readonly string[], known: readonly string[]): Promise<string[]> {
	const seen = new Set(known)
	const imported: string[] = []
	for (const filePath of files) {
		const cached = await getCachedParsedFile(filePath)
		for (const { source } of cached?.imports ?? []) {
			if (!source.endsWith('.astro')) continue
			const resolved = await resolveImportPath(source, filePath)
			if (!resolved || seen.has(resolved) || projectTemplatesAmong([resolved]).length === 0) continue
			seen.add(resolved)
			imported.push(resolved)
		}
	}
	return imported
}

// ============================================================================
// Astro File Search
// ============================================================================

/**
 * Search a single Astro file for matching content using AST parsing.
 * Uses caching for better performance. A prop is followed to its value `within` these files (absolute), or the whole project.
 */
export async function searchAstroFile(
	filePath: string,
	textContent: string,
	tag: string,
	within?: readonly string[],
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
			let openingTagSnippet: string | undefined
			if (bestMatch.type === 'static') {
				// For static content, extract the complete element (including wrapper tags)
				snippet = extractCompleteTagSnippet(lines, editableLine - 1, tag)
				// Also extract just the opening tag for attribute updates
				openingTagSnippet = extractOpeningTagSnippet(lines, editableLine - 1, tag)
			} else {
				// For variables/props, the definition with its indentation — which can
				// run past one line when the value is a `+` chain of literals.
				const definition = variableDefinitions.find(def => def.line === editableLine)
				snippet = definition ? definitionSnippet(lines, definition) : lines[editableLine - 1] || ''
			}

			return {
				file: path.relative(getProjectRoot(), filePath),
				line: editableLine,
				snippet,
				openingTagSnippet,
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
					0,
					undefined,
					within,
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
