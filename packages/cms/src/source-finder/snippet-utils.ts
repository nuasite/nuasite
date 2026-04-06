import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

import { getProjectRoot } from '../config'
import type { Attribute, CollectionDefinition, ManifestEntry } from '../types'
import { escapeRegex, generateSourceHash } from '../utils'
import { buildDefinitionPath } from './ast-extractors'
import { getCachedParsedFile } from './ast-parser'
import { findFieldInCollectionEntry, findTextInAnyCollectionFrontmatter } from './collection-finder'
import { findAttributeSourceLocation, searchForExpressionProp, searchForPropInParents } from './cross-file-tracker'
import { findImageElementNearLine, findImageSourceLocation } from './image-finder'
import { initializeSearchIndex } from './search-index'
import type { CachedParsedFile, ImageMatch, SourceLocation } from './types'

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
	collectionDefinitions?: Record<string, CollectionDefinition>,
): Promise<Record<string, ManifestEntry>> {
	// Ensure the search index is ready (returns immediately if already built,
	// otherwise waits for the in-flight initialization or triggers a new one).
	await initializeSearchIndex()

	const enhanced: Record<string, ManifestEntry> = {}

	// Build a reverse-reference index once so we don't recompute per entry
	const referenceIndex = new Map<string, Array<{ collection: string; fieldName: string; isArray?: boolean }>>()
	if (collectionDefinitions) {
		for (const [colName, colDef] of Object.entries(collectionDefinitions)) {
			for (const field of colDef.fields) {
				const target = field.type === 'reference'
					? field.collection
					: (field.type === 'array' && field.itemType === 'reference')
					? field.collection
					: undefined
				if (target) {
					let arr = referenceIndex.get(target)
					if (!arr) {
						arr = []
						referenceIndex.set(target, arr)
					}
					arr.push({ collection: colName, fieldName: field.name, ...(field.type === 'array' && { isArray: true }) })
				}
			}
		}
	}

	// Propagate collectionName/collectionSlug from wrapper entries to their children.
	// The HTML processor only sets collection info on the wrapper element itself;
	// child entries (images, text) need it for direct data-file resolution.
	// Build parent→children lookup, then propagate down the tree.
	const childrenOf = new Map<string, ManifestEntry[]>()
	for (const entry of Object.values(entries)) {
		if (entry.parentComponentId) {
			const siblings = childrenOf.get(entry.parentComponentId)
			if (siblings) siblings.push(entry)
			else childrenOf.set(entry.parentComponentId, [entry])
		}
	}
	const propagateCollection = (parentId: string, name: string, slug: string) => {
		const children = childrenOf.get(parentId)
		if (!children) return
		for (const child of children) {
			if (!child.collectionName) {
				child.collectionName = name
				child.collectionSlug = slug
				propagateCollection(child.id, name, slug)
			}
		}
	}
	for (const entry of Object.values(entries)) {
		if (entry.collectionName && entry.collectionSlug) {
			propagateCollection(entry.id, entry.collectionName, entry.collectionSlug)
		}
	}

	// Process entries in parallel for better performance
	const entryPromises = Object.entries(entries).map(async ([id, entry]) => {
		// Handle image entries specially - find the line with src attribute
		if (entry.imageMetadata?.src) {
			// ── Collection images: resolve directly from the data file ──
			// When an image belongs to a known collection entry, bypass the search index
			// entirely. Astro hashes image filenames (e.g. ./photo.jpg → /assets/a1b2c3.webp),
			// making reverse URL lookup unreliable. Instead, look up the image field(s)
			// directly in the collection entry's data file.
			if (entry.collectionName && entry.collectionSlug && collectionDefinitions) {
				const imageLocation = await resolveCollectionImageField(
					entry, collectionDefinitions, referenceIndex,
				)
				if (imageLocation) {
					return [id, imageLocation] as const
				}
			}

			// ── Non-collection images: find via search index / AST ──
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
			if (entry.sourcePath && entry.sourceLine) {
				try {
					const filePath = path.isAbsolute(entry.sourcePath)
						? entry.sourcePath
						: path.join(getProjectRoot(), entry.sourcePath)
					const cached = await getCachedParsedFile(filePath)
					if (cached) {
						const nearbyImg = findImageElementNearLine(cached.ast, entry.sourceLine, cached.lines)
						if (nearbyImg) {
							const resolvedEntry = await resolveImageExpression(
								entry,
								nearbyImg,
								cached,
								filePath,
								collectionDefinitions,
								referenceIndex,
							)
							if (resolvedEntry) {
								return [id, resolvedEntry] as const
							}

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

			// Final fallback: search collection frontmatter directly for the image URL
			const collectionResult = await searchCollectionWithDecodedFallback(entry.imageMetadata.src, collectionDefinitions)
			if (collectionResult) {
				return [id, applyCollectionSource(entry, collectionResult, referenceIndex)] as const
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
								allowStyling: false,
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
									componentFileName,
									propName,
									exprPath,
									entry.text!,
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
										allowStyling: false,
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
									path.join(srcDir, searchDir),
									trimmedText,
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
										allowStyling: false,
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

					// Search collection frontmatter — text rendered on listing pages
					// from collection entries (e.g. {post.data.title}) won't be found
					// through AST or prop lookups since the value lives in a .md file
					if (collectionDefinitions && Object.keys(collectionDefinitions).length > 0) {
						const mdSource = await findTextInAnyCollectionFrontmatter(trimmedText, collectionDefinitions)
						if (mdSource) {
							return [
								id,
								applyCollectionSource(entry, mdSource, referenceIndex, {
									allowStyling: false,
									attributes,
									colorClasses,
								}),
							] as const
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

	// Post-processing: augment entries with collection and reference metadata.
	// Source resolution may find text via prop/expression tracking (pointing to a parent
	// component) before the collection frontmatter search runs. In that case the source
	// location is correct for editing, but collection identity and reference metadata are
	// missing. This pass adds both by checking if text exists in any collection.
	// collectionName/collectionSlug are needed on owning entries (e.g. news titles) so
	// that findOwnerEntry in the editor can locate them as siblings of reference elements.
	if (collectionDefinitions && Object.keys(collectionDefinitions).length > 0) {
		// Cache text→result to avoid redundant file reads when the same text appears
		// in multiple manifest entries (e.g., author names repeated on listing pages)
		const textLookupCache = new Map<
			string,
			{ source: SourceLocation; referencedBy?: Array<{ collection: string; fieldName: string; isArray?: boolean }> } | null
		>()

		async function resolveCollectionText(trimmed: string) {
			const cached = textLookupCache.get(trimmed)
			if (cached !== undefined) return cached

			// Search each collection individually so we can prefer referenced collections
			// (findTextInAnyCollectionFrontmatter returns the first match, which may be wrong
			// when the same text exists in multiple collections like "team" and "authors")
			let bestSource: SourceLocation | undefined
			let bestReferencedBy: Array<{ collection: string; fieldName: string; isArray?: boolean }> | undefined
			for (const def of Object.values(collectionDefinitions!)) {
				if (!def.entries || def.entries.length === 0) continue
				const singleCol = { [def.name]: def }
				const source = await findTextInAnyCollectionFrontmatter(trimmed, singleCol)
				if (!source?.collectionName) continue
				const refs = referenceIndex.get(source.collectionName)
				if (refs && refs.length > 0) {
					bestSource = source
					bestReferencedBy = refs
					break
				}
				if (!bestSource) {
					bestSource = source
				}
			}

			const result = bestSource ? { source: bestSource, referencedBy: bestReferencedBy } : null
			textLookupCache.set(trimmed, result)
			return result
		}

		const augmentPromises = Object.entries(enhanced).map(async ([id, entry]) => {
			if (!entry.text?.trim()) return
			// Skip if already fully resolved (has collection identity + reference metadata or no references exist)
			if (entry.collectionName && (entry.referenceCollection || referenceIndex.size === 0)) return
			const trimmed = entry.text.trim()

			const resolved = await resolveCollectionText(trimmed)
			if (!resolved) return

			const refMeta = resolved.referencedBy
				? { referenceCollection: resolved.source.collectionName, referencedBy: resolved.referencedBy }
				: {}
			enhanced[id] = {
				...entry,
				collectionName: entry.collectionName ?? resolved.source.collectionName,
				collectionSlug: entry.collectionSlug ?? resolved.source.collectionSlug,
				...refMeta,
			}
		})
		await Promise.all(augmentPromises)
	}

	return enhanced
}

// ============================================================================
// Collection Source Helpers
// ============================================================================

/** Search collection frontmatter for a value, falling back to the decoded Astro Image URL */
async function searchCollectionWithDecodedFallback(
	src: string,
	collectionDefinitions?: Record<string, CollectionDefinition>,
): Promise<SourceLocation | undefined> {
	if (!collectionDefinitions || Object.keys(collectionDefinitions).length === 0) return undefined

	const mdSource = await findTextInAnyCollectionFrontmatter(src, collectionDefinitions)
	if (mdSource) return mdSource

	const decodedSrc = extractAstroImageOriginalUrl(src)
	if (decodedSrc) {
		return await findTextInAnyCollectionFrontmatter(decodedSrc, collectionDefinitions)
	}
	return undefined
}

/** Build a ManifestEntry from a collection frontmatter match */
function applyCollectionSource(
	entry: ManifestEntry,
	mdSource: SourceLocation,
	referenceIndex?: Map<string, Array<{ collection: string; fieldName: string; isArray?: boolean }>>,
	extra?: Partial<ManifestEntry>,
): ManifestEntry {
	const sourceHash = generateSourceHash(mdSource.snippet ?? '')
	const referencedBy = mdSource.collectionName
		? referenceIndex?.get(mdSource.collectionName)
		: undefined
	return {
		...entry,
		sourcePath: mdSource.file,
		sourceLine: mdSource.line,
		sourceSnippet: mdSource.snippet,
		variableName: mdSource.variableName,
		collectionName: mdSource.collectionName,
		collectionSlug: mdSource.collectionSlug,
		sourceHash,
		...(referencedBy && referencedBy.length > 0 && {
			referenceCollection: mdSource.collectionName,
			referencedBy,
		}),
		...extra,
	}
}

// ============================================================================
// Collection Image Resolution
// ============================================================================

/**
 * Resolve a collection image entry directly from the data file.
 * Uses the collection definition's image fields to find the source location
 * without relying on URL matching (which fails when Astro hashes filenames).
 *
 * For entries with a single image field, the resolution is unambiguous.
 * For multiple image fields, tries to match by value (exact or suffix).
 */
async function resolveCollectionImageField(
	entry: ManifestEntry,
	collectionDefinitions: Record<string, CollectionDefinition>,
	referenceIndex?: Map<string, Array<{ collection: string; fieldName: string; isArray?: boolean }>>,
): Promise<ManifestEntry | undefined> {
	const colDef = collectionDefinitions[entry.collectionName!]
	if (!colDef) return undefined

	const imageFields = colDef.fields.filter((f) => f.type === 'image')
	if (imageFields.length === 0) return undefined

	// Single image field — unambiguous
	if (imageFields.length === 1) {
		const fieldResult = await findFieldInCollectionEntry(
			imageFields[0]!.name,
			entry.collectionName!,
			entry.collectionSlug!,
			collectionDefinitions,
		)
		if (fieldResult) {
			return applyCollectionSource(entry, fieldResult, referenceIndex)
		}
		return undefined
	}

	// Multiple image fields — try to match the rendered URL to a field value.
	const imgSrc = entry.imageMetadata!.src
	let firstFieldResult: SourceLocation | undefined
	for (const field of imageFields) {
		const fieldResult = await findFieldInCollectionEntry(
			field.name,
			entry.collectionName!,
			entry.collectionSlug!,
			collectionDefinitions,
		)
		if (!fieldResult?.snippet) continue

		// Remember the first resolved field as fallback
		firstFieldResult ??= fieldResult

		// Check if the field's value matches the rendered URL (exact or after Astro processing)
		const yamlKeyMatch = fieldResult.snippet.match(/^\s*[\w][\w-]*:\s*/)
		if (yamlKeyMatch) {
			try {
				const parsed = parseYaml(fieldResult.snippet)
				if (parsed && typeof parsed === 'object') {
					const key = fieldResult.snippet.match(/^\s*([\w][\w-]*):/)?.[1]
					const value = key ? (parsed as Record<string, unknown>)[key] : undefined
					if (typeof value === 'string' && (value === imgSrc || imgSrc.includes(value) || value.includes(imgSrc))) {
						return applyCollectionSource(entry, fieldResult, referenceIndex)
					}
				}
			} catch {
				// Not valid YAML
			}
		}
	}

	// No value match — fall back to first resolved image field
	if (firstFieldResult) {
		return applyCollectionSource(entry, firstFieldResult, referenceIndex)
	}

	return undefined
}

// ============================================================================
// Image Expression Resolution
// ============================================================================

/**
 * Resolve a dynamic image expression (e.g., src={article.image}) to its data source.
 * Mirrors the text expression resolution flow: tries variable definitions, cross-file
 * prop tracking, and collection frontmatter search.
 */
async function resolveImageExpression(
	entry: ManifestEntry,
	nearbyImg: ImageMatch,
	cached: CachedParsedFile,
	filePath: string,
	collectionDefinitions?: Record<string, CollectionDefinition>,
	referenceIndex?: Map<string, Array<{ collection: string; fieldName: string; isArray?: boolean }>>,
): Promise<ManifestEntry | undefined> {
	const imgSrc = entry.imageMetadata?.src
	if (!imgSrc) return undefined

	const normalizedSrc = normalizeText(imgSrc)

	// Step 1: Try variable definitions — handles local variables (const image = "...")
	const matchingDef = cached.variableDefinitions.find(
		def => normalizeText(def.value) === normalizedSrc,
	)
	if (matchingDef) {
		const defSnippet = cached.lines[matchingDef.line - 1] || ''
		const sourceHash = generateSourceHash(defSnippet)
		return {
			...entry,
			sourceLine: matchingDef.line,
			sourceSnippet: defSnippet,
			variableName: buildDefinitionPath(matchingDef),
			sourceHash,
		}
	}

	// Step 2: Try cross-file prop tracking — handles props from parent components
	const exprPattern = /\{(\w+(?:\.\w+|\[\d+\])*)\}/g
	let exprMatch: RegExpExecArray | null
	while ((exprMatch = exprPattern.exec(nearbyImg.snippet)) !== null) {
		const exprPath = exprMatch[1]!
		const baseVar = exprPath.match(/^(\w+)/)?.[1]
		if (baseVar && cached.propAliases.has(baseVar)) {
			const propName = cached.propAliases.get(baseVar)!
			const componentFileName = path.basename(filePath)
			const result = await searchForExpressionProp(
				componentFileName,
				propName,
				exprPath,
				imgSrc,
			)
			if (result) {
				const propSnippet = result.snippet ?? imgSrc
				const sourceHash = generateSourceHash(propSnippet)
				return {
					...entry,
					sourcePath: result.file,
					sourceLine: result.line,
					sourceSnippet: propSnippet,
					variableName: result.variableName,
					sourceHash,
				}
			}
		}
	}

	// Step 3: Search collection frontmatter — handles {article.data.image} patterns
	// where the image URL lives in a markdown/data file's frontmatter
	const collectionResult = await searchCollectionWithDecodedFallback(imgSrc, collectionDefinitions)
	if (collectionResult) {
		return applyCollectionSource(entry, collectionResult, referenceIndex)
	}

	// Step 4: Field-name-based lookup — handles Astro-optimized images where the rendered URL
	// is a hashed filename (e.g., /assets/02ea4e4b132e.webp) that can't be matched by value.
	// Extract the field name from the expression (e.g., {article.data.image} → "image")
	// and look it up directly in the known collection entry's data file.
	if (entry.collectionName && entry.collectionSlug && collectionDefinitions) {
		const exprFieldPattern = /\{[\w]+(?:\.data)?\.(\w+)\}/
		const fieldMatch = nearbyImg.snippet.match(exprFieldPattern)
		if (fieldMatch?.[1]) {
			const fieldResult = await findFieldInCollectionEntry(
				fieldMatch[1],
				entry.collectionName,
				entry.collectionSlug,
				collectionDefinitions,
			)
			if (fieldResult) {
				return applyCollectionSource(entry, fieldResult, referenceIndex)
			}
		}
	}

	return undefined
}

/**
 * Extract the original image path from an Astro Image optimization URL.
 * Astro's `<Image>` component rewrites src to `/_image?href=%2Fpath.jpg&w=...` in dev.
 * Returns the decoded `href` param, or undefined if the URL isn't an Astro image URL.
 */
export function extractAstroImageOriginalUrl(src: string): string | undefined {
	try {
		const url = new URL(src, 'http://localhost')
		if (url.pathname === '/_image' || url.pathname.startsWith('/_image/')) {
			const href = url.searchParams.get('href')
			if (href && href !== src) return href
		}
	} catch {
		// Not a valid URL
	}
	return undefined
}
