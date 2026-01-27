import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import type { ManifestEntry } from '../types'
import { generateSourceHash } from '../utils'
import { findImageSourceLocation } from './image-finder'

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

// ============================================================================
// Manifest Enhancement
// ============================================================================

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
