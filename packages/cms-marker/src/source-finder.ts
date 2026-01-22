import fs from 'node:fs/promises'
import path from 'node:path'
import type { ManifestEntry } from './types'
import { generateSourceHash } from './utils'

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

/**
 * Find source file and line number for text content
 */
export async function findSourceLocation(
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	const srcDir = path.join(process.cwd(), 'src')

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
 * Find source file and line number for an image by its src attribute
 */
export async function findImageSourceLocation(
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	const srcDir = path.join(process.cwd(), 'src')

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
 * Search a single file for an image with matching src
 */
async function searchFileForImage(
	filePath: string,
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		// Search for src="imageSrc" or src='imageSrc'
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
						file: path.relative(process.cwd(), filePath),
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
 * Search a single Astro file for matching content
 */
async function searchAstroFile(
	filePath: string,
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		const cleanText = normalizeText(textContent)
		const textPreview = cleanText.slice(0, Math.min(30, cleanText.length))

		// Extract variable references from frontmatter
		const variableRefs = extractVariableReferences(content, cleanText)

		// Collect all potential matches with scores and metadata
		const matches: Array<{
			line: number
			score: number
			type: 'static' | 'variable' | 'prop' | 'computed'
			variableName?: string
			definitionLine?: number
		}> = []

		// Search for tag usage with matching text or variable
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim().toLowerCase()

			// Look for opening tag
			if (line?.includes(`<${tag.toLowerCase()}`) && !line.startsWith(`</${tag.toLowerCase()}`)) {
				// Collect content from this line and next few lines
				const section = collectSection(lines, i, 5)
				const sectionText = section.toLowerCase()
				const sectionTextOnly = stripHtmlTags(section).toLowerCase()

				let score = 0
				let matched = false

				// Check for variable reference match (highest priority)
				if (variableRefs.length > 0) {
					for (const varRef of variableRefs) {
						// Check case-insensitively since sectionText is lowercased
						if (sectionText.includes(`{`) && sectionText.includes(varRef.name.toLowerCase())) {
							score = 100
							matched = true
							// Store match metadata - this is the USAGE line, we need DEFINITION line
							matches.push({
								line: i + 1,
								score,
								type: 'variable',
								variableName: varRef.name,
								definitionLine: varRef.definitionLine,
							})
							break
						}
					}
				}

				// Check for direct text match (static content)
				if (!matched && cleanText.length > 10 && sectionTextOnly.includes(textPreview)) {
					// Score based on how much of the text matches
					const matchLength = Math.min(cleanText.length, sectionTextOnly.length)
					score = 50 + (matchLength / cleanText.length) * 40
					matched = true
					// Find the actual line containing the text
					const actualLine = findLineContainingText(lines, i, 5, textPreview)
					matches.push({ line: actualLine, score, type: 'static' })
				}

				// Check for short exact text match (static content)
				if (!matched && cleanText.length > 0 && cleanText.length <= 10 && sectionTextOnly.includes(cleanText)) {
					score = 80
					matched = true
					// Find the actual line containing the text
					const actualLine = findLineContainingText(lines, i, 5, cleanText)
					matches.push({ line: actualLine, score, type: 'static' })
				}

				// Try matching first few words for longer text (static content)
				if (!matched && cleanText.length > 20) {
					const firstWords = cleanText.split(' ').slice(0, 3).join(' ')
					if (firstWords && sectionTextOnly.includes(firstWords)) {
						score = 40
						matched = true
						// Find the actual line containing the text
						const actualLine = findLineContainingText(lines, i, 5, firstWords)
						matches.push({ line: actualLine, score, type: 'static' })
					}
				}
			}
		}

		// Return the best match (highest score)
		if (matches.length > 0) {
			const bestMatch = matches.reduce((best, current) => current.score > best.score ? current : best)

			// Determine the editable line (definition for variables, usage for static)
			const editableLine = bestMatch.type === 'variable' && bestMatch.definitionLine
				? bestMatch.definitionLine
				: bestMatch.line

			// Get the complete source snippet (multi-line for static, single line for variables)
			let snippet: string
			if (bestMatch.type === 'static') {
				// For static content, extract the complete tag content with indentation
				snippet = extractCompleteTagSnippet(lines, editableLine - 1, tag)
			} else {
				// For variables/props, just the definition line with indentation
				snippet = lines[editableLine - 1] || ''
			}

			return {
				file: path.relative(process.cwd(), filePath),
				line: editableLine,
				snippet,
				type: bestMatch.type,
				variableName: bestMatch.variableName,
				definitionLine: bestMatch.type === 'variable' ? bestMatch.definitionLine : undefined,
			}
		}
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Search for prop values passed to components
 */
async function searchForPropInParents(dir: string, textContent: string): Promise<SourceLocation | undefined> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const cleanText = normalizeText(textContent)

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)

		if (entry.isDirectory()) {
			const result = await searchForPropInParents(fullPath, textContent)
			if (result) return result
		} else if (entry.isFile() && entry.name.endsWith('.astro')) {
			const content = await fs.readFile(fullPath, 'utf-8')
			const lines = content.split('\n')

			// Look for component tags with prop values matching our text
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]

				// Match component usage like <ComponentName propName="value" />
				const componentMatch = line?.match(/<([A-Z]\w+)/)
				if (!componentMatch) continue

				// Collect only the opening tag (until first > or />), not nested content
				let openingTag = ''
				let endLine = i
				for (let j = i; j < Math.min(i + 10, lines.length); j++) {
					openingTag += ' ' + lines[j]
					endLine = j

					// Stop at the end of opening tag (either /> or >)
					if (lines[j]?.includes('/>')) {
						// Self-closing tag
						break
					} else if (lines[j]?.includes('>')) {
						// Opening tag ends here, don't include nested content
						// Truncate to just the opening tag part
						const tagEndIndex = openingTag.indexOf('>')
						if (tagEndIndex !== -1) {
							openingTag = openingTag.substring(0, tagEndIndex + 1)
						}
						break
					}
				}

				// Extract all prop values from the opening tag only
				const propMatches = openingTag.matchAll(/(\w+)=["']([^"']+)["']/g)
				for (const match of propMatches) {
					const propName = match[1]
					const propValue = match[2]

					if (!propValue) {
						continue
					}

					const normalizedValue = normalizeText(propValue)

					if (normalizedValue === cleanText) {
						// Find which line actually contains this prop
						let propLine = i

						for (let k = i; k <= endLine; k++) {
							const line = lines[k]
							if (!line) {
								continue
							}

							if (propName && line.includes(propName) && line.includes(propValue)) {
								propLine = k
								break
							}
						}

						// Extract complete component tag starting from where the component tag opens
						const componentSnippetLines: string[] = []
						for (let k = i; k <= endLine; k++) {
							const line = lines[k]
							if (!line) {
								continue
							}

							componentSnippetLines.push(line)
						}

						const propSnippet = componentSnippetLines.join('\n')

						// Found the prop being passed with our text value
						return {
							file: path.relative(process.cwd(), fullPath),
							line: propLine + 1,
							snippet: propSnippet,
							type: 'prop',
							variableName: propName,
						}
					}
				}
			}
		}
	}

	return undefined
}

/**
 * Extract complete tag snippet including content and indentation.
 * Exported for use in html-processor to populate sourceSnippet.
 */
export function extractCompleteTagSnippet(lines: string[], startLine: number, tag: string): string {
	const snippetLines: string[] = []
	let depth = 0
	let foundClosing = false

	// Start from the opening tag line
	for (let i = startLine; i < Math.min(startLine + 20, lines.length); i++) {
		const line = lines[i]

		if (!line) {
			continue
		}

		snippetLines.push(line)

		// Count opening and closing tags
		const openTags = (line.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
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
			: path.join(process.cwd(), sourceFile)

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
 * Extract variable references from frontmatter
 */
function extractVariableReferences(content: string, targetText: string): VariableReference[] {
	const refs: VariableReference[] = []
	const frontmatterEnd = content.indexOf('---', 3)

	if (frontmatterEnd <= 0) return refs

	const frontmatter = content.substring(0, frontmatterEnd)
	const lines = frontmatter.split('\n')

	for (const line of lines) {
		const trimmed = line.trim()

		// Match quoted text (handling escaped quotes)
		// Try single quotes with escaped quotes
		let quotedMatch = trimmed.match(/'((?:[^'\\]|\\.)*)'/)
		if (!quotedMatch) {
			// Try double quotes with escaped quotes
			quotedMatch = trimmed.match(/"((?:[^"\\]|\\.)*)"/)
		}
		if (!quotedMatch) {
			// Try backticks (template literals) - but only if no ${} interpolation
			const backtickMatch = trimmed.match(/`([^`]*)`/)
			if (backtickMatch && !backtickMatch[1]?.includes('${')) {
				quotedMatch = backtickMatch
			}
		}
		if (!quotedMatch?.[1]) continue

		const value = normalizeText(quotedMatch[1])
		const normalizedTarget = normalizeText(targetText)

		if (value !== normalizedTarget) continue

		// Try to extract variable name and line number
		const lineNumber = lines.indexOf(line) + 1

		// Pattern 1: Object property "key: 'value'"
		const propMatch = trimmed.match(/(\w+)\s*:\s*['"`]/)
		if (propMatch?.[1]) {
			refs.push({
				name: propMatch[1],
				pattern: `{.*${propMatch[1]}`,
				definitionLine: lineNumber,
			})
			continue
		}

		// Pattern 2: Variable declaration "const name = 'value'"
		const varMatch = trimmed.match(/(?:const|let|var)\s+(\w+)(?:\s*:\s*\w+)?\s*=/)
		if (varMatch?.[1]) {
			refs.push({
				name: varMatch[1],
				pattern: `{${varMatch[1]}}`,
				definitionLine: lineNumber,
			})
		}
	}

	return refs
}

/**
 * Collect text from multiple lines
 */
function collectSection(lines: string[], startLine: number, numLines: number): string {
	let text = ''
	for (let i = startLine; i < Math.min(startLine + numLines, lines.length); i++) {
		text += ' ' + lines[i]?.trim().replace(/\s+/g, ' ')
	}
	return text
}

/**
 * Find the actual line containing the matched text within a section
 * Returns 1-indexed line number
 */
function findLineContainingText(lines: string[], startLine: number, numLines: number, searchText: string): number {
	const normalizedSearch = searchText.toLowerCase()
	for (let i = startLine; i < Math.min(startLine + numLines, lines.length); i++) {
		const lineText = stripHtmlTags(lines[i] || '').toLowerCase()
		if (lineText.includes(normalizedSearch)) {
			return i + 1 // Return 1-indexed line number
		}
	}
	// If not found on a specific line, return the opening tag line
	return startLine + 1
}

/**
 * Strip HTML tags from text
 */
function stripHtmlTags(text: string): string {
	return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

	const contentPath = path.join(process.cwd(), contentDir)

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
			file: path.relative(process.cwd(), mdFile),
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
		const filePath = path.join(process.cwd(), collectionInfo.file)
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')
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
 * Parse markdown file and extract frontmatter fields and full body content
 * @param collectionInfo - Collection information (name, slug, file path)
 * @returns Parsed markdown content with frontmatter and body
 */
export async function parseMarkdownContent(
	collectionInfo: CollectionInfo,
): Promise<MarkdownContent | undefined> {
	try {
		const filePath = path.join(process.cwd(), collectionInfo.file)
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

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
