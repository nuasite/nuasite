import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import { buildDefinitionPath } from './ast-extractors'
import { getCachedParsedFile } from './ast-parser'
import { findComponentProp, findExpressionProp, findSpreadProp } from './element-finder'
import { normalizeText } from './snippet-utils'
import type { ImportInfo, SourceLocation } from './types'
import { getExportedDefinitions, resolveImportPath } from './variable-extraction'

// ============================================================================
// Expression Prop Search
// ============================================================================

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
export async function searchForExpressionProp(
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

// ============================================================================
// Imported Value Search
// ============================================================================

/**
 * Search for a value in an imported file.
 * @param fromFile - The file that contains the import
 * @param importInfo - Information about the import
 * @param expressionPath - The full expression path (e.g., 'config.title' or 'navItems[0]')
 * @param searchText - The text content we're searching for
 */
export async function searchForImportedValue(
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

// ============================================================================
// Prop in Parents Search
// ============================================================================

/**
 * Search for prop values passed to components using AST parsing.
 * Uses caching for better performance.
 */
export async function searchForPropInParents(dir: string, textContent: string): Promise<SourceLocation | undefined> {
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
