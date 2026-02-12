import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import type { Attribute, ManifestEntry } from '../types'
import { escapeRegex, generateSourceHash } from '../utils'
import { buildDefinitionPath } from './ast-extractors'
import { getCachedParsedFile } from './ast-parser'
import { findAttributeSourceLocation, searchForExpressionProp, searchForPropInParents } from './cross-file-tracker'
import { findImageElementNearLine, findImageSourceLocation } from './image-finder'

// ============================================================================
// Text Normalization
// ============================================================================

/**
 * Normalize text for comparison (handles escaping and entities)
 */
export function normalizeText(text: string): string {
	return text
		.trim()
		.replace(/\\'/g, "'") // Escaped single quotes
		.replace(/\\"/g, '"') // Escaped double quotes
		.replace(/&#39;/g, "'") // HTML entity for apostrophe
		.replace(/&quot;/g, '"') // HTML entity for quote
		.replace(/&apos;/g, "'") // HTML entity for apostrophe (alternative)
		.replace(/&amp;/g, '&') // HTML entity for ampersand
		.replace(/&nbsp;/gi, ' ') // HTML entity for non-breaking space
		.replace(/<br\s*\/?>/gi, '\n') // Normalize <br> tags to newlines
		.replace(/<wbr\s*\/?>/gi, '') // Strip <wbr> tags (word break opportunity, no visible content)
		.replace(/\s+/g, ' ') // Normalize whitespace
		.toLowerCase()
}

/**
 * Strip markdown syntax for text comparison
 */
export function stripMarkdownSyntax(text: string): string {
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
 * Find the 1-indexed line number where a text value is defined as a string literal.
 * Searches for the text inside quote delimiters ("text", 'text', or `text`).
 * Returns the line number, or undefined if not found.
 */
export function findTextDefinitionLine(
	content: string,
	lines: string[],
	text: string,
): number | undefined {
	// Search for the text inside string delimiters
	for (const quote of ['"', "'", '`']) {
		const searchStr = `${quote}${text}${quote}`
		const idx = content.indexOf(searchStr)
		if (idx !== -1) {
			return content.substring(0, idx).split('\n').length
		}
	}

	// Also try with common escape sequences (e.g., escaped quotes within the text)
	const escapedForDouble = text.replace(/"/g, '\\"')
	if (escapedForDouble !== text) {
		const idx = content.indexOf(`"${escapedForDouble}"`)
		if (idx !== -1) {
			return content.substring(0, idx).split('\n').length
		}
	}

	return undefined
}

// ============================================================================
// Snippet Extraction
// ============================================================================

/**
 * Extract complete tag snippet including content and indentation.
 * Exported for use in html-processor to populate sourceSnippet.
 *
 * When startLine points to a line inside the element (e.g., the text content line),
 * this function searches backwards to find the opening tag first.
 */
export function extractCompleteTagSnippet(lines: string[], startLine: number, tag: string): string {
	// Pattern to match opening tag - either followed by whitespace/>, or at end of line (multi-line tag)
	const escapedTag = escapeRegex(tag)
	const openTagPattern = new RegExp(`<${escapedTag}(?:[\\s>]|$)`, 'gi')

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
		const openTags = (line.match(new RegExp(`<${escapedTag}(?:[\\s>]|$)`, 'gi')) || []).length
		const selfClosing = (line.match(new RegExp(`<${escapedTag}[^>]*/>`, 'gi')) || []).length
		const closeTags = (line.match(new RegExp(`</${escapedTag}>`, 'gi')) || []).length

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
 * Extract just the opening tag from source lines (e.g., `<a href="/foo" class="btn">`)
 * Handles multi-line opening tags.
 *
 * @param lines - Source file lines
 * @param startLine - 0-indexed line number where element starts
 * @param tag - The tag name
 * @returns The opening tag string, or undefined if can't extract
 */
export function extractOpeningTagSnippet(lines: string[], startLine: number, tag: string): string | undefined {
	const result = extractOpeningTagWithLine(lines, startLine, tag)
	return result?.snippet
}

/**
 * Extract the opening tag from source lines along with its starting line number.
 * Handles multi-line opening tags.
 *
 * @param lines - Source file lines
 * @param startLine - 0-indexed line number where element starts
 * @param tag - The tag name
 * @returns Object with the opening tag snippet and 0-indexed startLine, or undefined if can't extract
 */
export function extractOpeningTagWithLine(
	lines: string[],
	startLine: number,
	tag: string,
): { snippet: string; startLine: number } | undefined {
	const escapedTag = escapeRegex(tag)
	const openTagPattern = new RegExp(`<${escapedTag}(?:[\\s>]|$)`, 'gi')

	// Find the line containing the opening tag
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

	// Collect lines until we find the closing > of the opening tag
	const snippetLines: string[] = []
	for (let i = actualStartLine; i < Math.min(actualStartLine + 10, lines.length); i++) {
		const line = lines[i]
		if (!line) continue

		snippetLines.push(line)
		const combined = snippetLines.join('\n')

		// Check if we have the complete opening tag (found the closing >)
		// Match from <tag to the first > that's not part of => or />
		const openTagMatch = combined.match(new RegExp(`<${escapedTag}[^>]*>`, 'i'))
		if (openTagMatch) {
			return { snippet: openTagMatch[0], startLine: actualStartLine }
		}

		// Also check for self-closing tag
		const selfClosingMatch = combined.match(new RegExp(`<${escapedTag}[^>]*/\\s*>`, 'i'))
		if (selfClosingMatch) {
			return { snippet: selfClosingMatch[0], startLine: actualStartLine }
		}
	}

	return undefined
}

/**
 * Update attribute source information from an opening tag snippet.
 * Determines whether each attribute is static (quoted value) or dynamic (expression).
 * - For static attributes: sourcePath/Line/Snippet point to the template file
 * - For dynamic attributes: sourcePath/Line/Snippet point to where the VALUE is defined
 *
 * @param openingTagSnippet - The opening tag string (e.g., `<a href={url} class="btn">`)
 * @param attributes - Existing attributes with resolved values (isStatic will be updated)
 * @param sourceFilePath - The source file path (used for static attrs and as starting point for dynamic attr tracing)
 * @param openingTagStartLine - 1-indexed line number where the opening tag starts in the source file
 * @returns Updated attributes with sourcePath, sourceLine, and sourceSnippet
 */
export async function updateAttributeSources(
	openingTagSnippet: string,
	attributes: Record<string, Attribute>,
	sourceFilePath?: string,
	openingTagStartLine?: number,
	sourceLines?: string[],
): Promise<Record<string, Attribute>> {
	const result: Record<string, Attribute> = {}

	// Normalize the snippet (remove newlines, collapse whitespace for easier parsing)
	const normalized = openingTagSnippet.replace(/\s+/g, ' ')

	// Split opening tag into lines for finding attribute line numbers
	const snippetLines = openingTagSnippet.split('\n')

	// Process each attribute
	const attrPromises = Object.entries(attributes).map(async ([attrName, attr]) => {
		const { value } = attr

		// Check for expression attribute: attr={expression} or attr={`template`}
		const escapedAttrName = escapeRegex(attrName)
		const exprPattern = new RegExp(`${escapedAttrName}\\s*=\\s*\\{([^}]+)\\}`, 'i')
		const exprMatch = normalized.match(exprPattern)

		if (exprMatch) {
			const expression = exprMatch[1]!.trim()
			const isTemplateLiteral = expression.startsWith('`') && expression.endsWith('`')
			const cleanExpression = isTemplateLiteral ? expression.slice(1, -1) : expression

			// For dynamic attributes, search by VALUE to find the source definition
			if (sourceFilePath) {
				const sourceLocation = await findAttributeSourceLocation(cleanExpression, value, sourceFilePath)
				if (sourceLocation) {
					return [attrName, {
						value,
						sourcePath: sourceLocation.file,
						sourceLine: sourceLocation.line,
						sourceSnippet: sourceLocation.snippet,
					}] as const
				}
			}

			// Couldn't resolve - return without source info
			return [attrName, { value }] as const
		}

		// Check for static attribute: attr="value" or attr='value'
		const staticPattern = new RegExp(`${escapedAttrName}\\s*=\\s*["']([^"']*)["']`, 'i')
		const staticMatch = normalized.match(staticPattern)

		if (staticMatch) {
			const attrLine = findAttributeLineInSnippet(attrName, snippetLines, openingTagStartLine)

			return [attrName, {
				value,
				sourcePath: sourceFilePath,
				sourceLine: attrLine,
				sourceSnippet: (attrLine && sourceLines) ? sourceLines[attrLine - 1] || '' : undefined,
			}] as const
		}

		// Check for boolean attribute (just the attribute name, no value)
		const boolPattern = new RegExp(`\\s${escapedAttrName}(?:\\s|>|/>)`, 'i')
		if (boolPattern.test(normalized)) {
			const attrLine = findAttributeLineInSnippet(attrName, snippetLines, openingTagStartLine)

			return [attrName, {
				value,
				sourcePath: sourceFilePath,
				sourceLine: attrLine,
				sourceSnippet: (attrLine && sourceLines) ? sourceLines[attrLine - 1] || '' : undefined,
			}] as const
		}

		// Fallback: couldn't determine source type, keep original
		return [attrName, attr] as const
	})

	const results = await Promise.all(attrPromises)
	for (const [attrName, attrValue] of results) {
		result[attrName] = attrValue
	}

	return result
}

/**
 * Find the 1-indexed line number of an attribute within an opening tag snippet.
 */
function findAttributeLineInSnippet(
	attrName: string,
	snippetLines: string[],
	startLine?: number,
): number | undefined {
	if (!startLine) return undefined
	const attrPattern = new RegExp(`(?:^|\\s)${escapeRegex(attrName)}(?:\\s*=|\\s|>|/>|$)`, 'i')
	for (let i = 0; i < snippetLines.length; i++) {
		if (attrPattern.test(snippetLines[i]!)) {
			return startLine + i
		}
	}
	return undefined
}

/**
 * Update colorClasses entries with source info from the class attribute in the opening tag.
 * All color classes come from the same `class="..."` attribute, so they share the same source location.
 */
export function updateColorClassSources(
	openingTagSnippet: string,
	colorClasses: Record<string, Attribute>,
	sourceFilePath?: string,
	openingTagStartLine?: number,
	sourceLines?: string[],
): Record<string, Attribute> {
	const snippetLines = openingTagSnippet.split('\n')
	const classLine = findAttributeLineInSnippet('class', snippetLines, openingTagStartLine)
	const sourceSnippet = (classLine && sourceLines) ? sourceLines[classLine - 1] || '' : undefined

	const result: Record<string, Attribute> = {}
	for (const [key, attr] of Object.entries(colorClasses)) {
		result[key] = {
			...attr,
			sourcePath: sourceFilePath,
			sourceLine: classLine,
			sourceSnippet,
		}
	}
	return result
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
	const escapedTag = escapeRegex(tag)
	const openTagPattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>`, 'i')
	const closeTagPattern = new RegExp(`</${escapedTag}>`, 'i')

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
 * Extract the full <img> tag snippet from source lines
 */
export function extractImageSnippet(lines: string[], startLine: number): string {
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
 * Read source file and extract the complete element at the specified line.
 *
 * @param sourceFile - Path to source file (relative to cwd)
 * @param sourceLine - 1-indexed line number
 * @param tag - The tag name
 * @returns The complete element from source, or undefined if can't extract
 */
export async function extractSourceSnippet(
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

		// Extract the complete tag snippet (including wrapper element)
		return extractCompleteTagSnippet(lines, sourceLine - 1, tag)
	} catch {
		return undefined
	}
}

// ============================================================================
// Manifest Enhancement
// ============================================================================

/**
 * Enhance manifest entries with actual source snippets from source files.
 * This reads the source files and extracts the innerHTML at the specified locations.
 * For images, it finds the correct line containing the src attribute.
 *
 * @param entries - Manifest entries to enhance
 * @returns Enhanced entries with sourceSnippet and openingTagSnippet populated
 */
export async function enhanceManifestWithSourceSnippets(
	entries: Record<string, ManifestEntry>,
): Promise<Record<string, ManifestEntry>> {
	const enhanced: Record<string, ManifestEntry> = {}

	// Process entries in parallel for better performance
	const entryPromises = Object.entries(entries).map(async ([id, entry]) => {
		// Handle image entries specially - find the line with src attribute
		if (entry.imageMetadata?.src) {
			const imageLocation = await findImageSourceLocation(entry.imageMetadata.src, entry.imageMetadata.srcSet)
			if (imageLocation) {
				const sourceHash = generateSourceHash(imageLocation.snippet || entry.imageMetadata.src)
				const updated: ManifestEntry = {
					...entry,
					sourcePath: imageLocation.file,
					sourceLine: imageLocation.line,
					sourceSnippet: imageLocation.snippet,
					sourceHash,
				}

				// Also update attribute and colorClasses source info from the opening tag
				try {
					const filePath = path.isAbsolute(imageLocation.file)
						? imageLocation.file
						: path.join(getProjectRoot(), imageLocation.file)
					const content = await fs.readFile(filePath, 'utf-8')
					const lines = content.split('\n')
					const openingTagInfo = extractOpeningTagWithLine(lines, imageLocation.line - 1, entry.tag)

					if (openingTagInfo) {
						const startLine = openingTagInfo.startLine + 1
						if (updated.attributes) {
							updated.attributes = await updateAttributeSources(
								openingTagInfo.snippet,
								updated.attributes,
								imageLocation.file,
								startLine,
								lines,
							)
						}
						if (updated.colorClasses) {
							updated.colorClasses = updateColorClassSources(
								openingTagInfo.snippet,
								updated.colorClasses,
								imageLocation.file,
								startLine,
								lines,
							)
						}
					}
				} catch {
					// Couldn't read file - return without source lines on attributes
				}

				return [id, updated] as const
			}

			// Fallback for expression-based src attributes (src={variable})
			// Use the entry's existing sourcePath/sourceLine to find the img tag
			// by its position in the AST rather than by src value
			if (entry.sourcePath && entry.sourceLine) {
				try {
					const filePath = path.isAbsolute(entry.sourcePath)
						? entry.sourcePath
						: path.join(getProjectRoot(), entry.sourcePath)
					const cached = await getCachedParsedFile(filePath)
					if (cached) {
						const nearbyImg = findImageElementNearLine(cached.ast, entry.sourceLine, cached.lines)
						if (nearbyImg) {
							const sourceHash = generateSourceHash(nearbyImg.snippet || entry.imageMetadata.src)
							return [id, {
								...entry,
								sourceLine: nearbyImg.line,
								sourceSnippet: nearbyImg.snippet,
								sourceHash,
							}] as const
						}
					}
				} catch {
					// Fallback search failed
				}
			}

			return [id, entry] as const
		}

		// Skip if already has sourceSnippet or missing source info
		if (entry.sourceSnippet || !entry.sourcePath || !entry.sourceLine || !entry.tag) {
			return [id, entry] as const
		}

		// Read file once and extract both snippets
		try {
			const filePath = path.isAbsolute(entry.sourcePath)
				? entry.sourcePath
				: path.join(getProjectRoot(), entry.sourcePath)

			const content = await fs.readFile(filePath, 'utf-8')
			const lines = content.split('\n')

			// Extract the complete source element
			const sourceSnippet = extractCompleteTagSnippet(lines, entry.sourceLine - 1, entry.tag)

			// Extract opening tag with its start line for attribute line tracking
			const openingTagInfo = extractOpeningTagWithLine(lines, entry.sourceLine - 1, entry.tag)

			// Update attribute sources if we have an opening tag and attributes
			// - Static attributes get sourceLine/snippet from the template
			// - Dynamic attributes get traced to their actual value definition
			let attributes = entry.attributes
			if (openingTagInfo && attributes) {
				attributes = await updateAttributeSources(
					openingTagInfo.snippet,
					attributes,
					entry.sourcePath,
					openingTagInfo.startLine + 1, // Convert to 1-indexed
					lines,
				)
			}

			// Update colorClasses with source info from the class attribute
			let colorClasses = entry.colorClasses
			if (openingTagInfo && colorClasses) {
				colorClasses = updateColorClassSources(
					openingTagInfo.snippet,
					colorClasses,
					entry.sourcePath,
					openingTagInfo.startLine + 1, // Convert to 1-indexed
					lines,
				)
			}

			if (sourceSnippet) {
				const trimmedText = entry.text?.trim()

				// Check if text is directly in the snippet (static content)
				if (trimmedText && !sourceSnippet.includes(trimmedText)) {
					// Text from dynamic expression — resolve via variable definitions
					const cached = await getCachedParsedFile(filePath)
					if (cached) {
						const normalizedSearch = normalizeText(entry.text!)
						const matchingDef = cached.variableDefinitions.find(
							def => normalizeText(def.value) === normalizedSearch,
						)
						if (matchingDef) {
							const defSnippet = lines[matchingDef.line - 1] || ''
							const sourceHash = generateSourceHash(defSnippet)
							return [id, {
								...entry,
								sourceLine: matchingDef.line,
								sourceSnippet: defSnippet,
								variableName: buildDefinitionPath(matchingDef),
								attributes,
								colorClasses,
								sourceHash,
							}] as const
						}
					}

					// Fallback: search for the literal text in file content
					// This handles cases where AST-based lookup fails (e.g., concurrent parsing)
					const foundLine = findTextDefinitionLine(content, lines, trimmedText)
					if (foundLine) {
						const defSnippet = lines[foundLine - 1] || ''
						const sourceHash = generateSourceHash(defSnippet)
						return [id, {
							...entry,
							sourceLine: foundLine,
							sourceSnippet: defSnippet,
							attributes,
							colorClasses,
							sourceHash,
						}] as const
					}

					// Cross-file search for prop-driven dynamic text
					// When text comes from a prop (e.g., {title} where title = Astro.props.title),
					// trace it to where the prop value is actually defined in a parent component
					if (cached) {
						// Extract expression variables from the snippet to find props
						const exprPattern = /\{(\w+(?:\.\w+|\[\d+\])*)\}/g
						let exprMatch: RegExpExecArray | null
						while ((exprMatch = exprPattern.exec(sourceSnippet)) !== null) {
							const exprPath = exprMatch[1]!
							const baseVar = exprPath.match(/^(\w+)/)?.[1]
							if (baseVar && cached.propAliases.has(baseVar)) {
								const propName = cached.propAliases.get(baseVar)!
								const componentFileName = path.basename(filePath)
								const result = await searchForExpressionProp(
									componentFileName, propName, exprPath, entry.text!,
								)
								if (result) {
									const propSnippet = result.snippet ?? trimmedText
									const propSourceHash = generateSourceHash(propSnippet)
									return [id, {
										...entry,
										sourcePath: result.file,
										sourceLine: result.line,
										sourceSnippet: propSnippet,
										variableName: result.variableName,
										attributes,
										colorClasses,
										sourceHash: propSourceHash,
									}] as const
								}
							}
						}

						// Search for quoted prop values in parent components
						// (handles <Component title="literal text" />)
						const srcDir = path.join(getProjectRoot(), 'src')
						for (const searchDir of ['pages', 'components', 'layouts']) {
							try {
								const result = await searchForPropInParents(
									path.join(srcDir, searchDir), trimmedText,
								)
								if (result) {
									const parentSnippet = result.snippet ?? trimmedText
									const propSourceHash = generateSourceHash(parentSnippet)
									return [id, {
										...entry,
										sourcePath: result.file,
										sourceLine: result.line,
										sourceSnippet: parentSnippet,
										variableName: result.variableName,
										attributes,
										colorClasses,
										sourceHash: propSourceHash,
									}] as const
								}
							} catch {
								// Directory doesn't exist
							}
						}
					}
				}

				// Original static content path
				const sourceHash = generateSourceHash(sourceSnippet)
				return [id, {
					...entry,
					sourceSnippet,
					attributes,
					colorClasses,
					sourceHash,
				}] as const
			}
		} catch {
			// Fall through to return entry as-is
		}

		return [id, entry] as const
	})

	const results = await Promise.all(entryPromises)
	for (const [id, entry] of results) {
		enhanced[id] = entry
	}

	return enhanced
}
