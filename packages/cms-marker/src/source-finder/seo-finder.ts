import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'

/**
 * SEO element identifier for source finding
 */
export interface SeoElementIdentifier {
	/** Meta tag name attribute */
	name?: string
	/** Meta tag property attribute (for OG/Twitter) */
	property?: string
	/** Content value to match */
	content?: string
	/** Canonical URL href */
	href?: string
	/** JSON-LD @type value */
	jsonLdType?: string
}

/**
 * Result of SEO source finding
 */
export interface SeoSourceLocation {
	/** Path to source file relative to project root */
	sourcePath: string
	/** Line number in source file (1-indexed) */
	sourceLine: number
	/** Exact source code snippet */
	sourceSnippet: string
}

/**
 * Find the source location for an SEO element.
 * Searches Astro/HTML files in src/pages and src/layouts for matching SEO elements.
 */
export async function findSeoSource(
	type: 'title' | 'meta' | 'canonical' | 'jsonld',
	identifier: SeoElementIdentifier,
): Promise<SeoSourceLocation | undefined> {
	const srcDir = path.join(getProjectRoot(), 'src')
	const searchDirs = [
		path.join(srcDir, 'pages'),
		path.join(srcDir, 'layouts'),
		path.join(srcDir, 'components'),
	]

	for (const dir of searchDirs) {
		try {
			const result = await searchDirectoryForSeo(dir, type, identifier)
			if (result) return result
		} catch {
			// Directory doesn't exist, continue
		}
	}

	return undefined
}

/**
 * Recursively search a directory for SEO elements
 */
async function searchDirectoryForSeo(
	dir: string,
	type: 'title' | 'meta' | 'canonical' | 'jsonld',
	identifier: SeoElementIdentifier,
): Promise<SeoSourceLocation | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchDirectoryForSeo(fullPath, type, identifier)
				if (result) return result
			} else if (entry.isFile() && (entry.name.endsWith('.astro') || entry.name.endsWith('.html'))) {
				const result = await searchFileForSeo(fullPath, type, identifier)
				if (result) return result
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
}

/**
 * Search a single file for matching SEO element
 */
async function searchFileForSeo(
	filePath: string,
	type: 'title' | 'meta' | 'canonical' | 'jsonld',
	identifier: SeoElementIdentifier,
): Promise<SeoSourceLocation | undefined> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		switch (type) {
			case 'title':
				return findTitleInLines(lines, filePath, identifier.content)

			case 'meta':
				return findMetaInLines(lines, filePath, identifier)

			case 'canonical':
				return findCanonicalInLines(lines, filePath, identifier.href)

			case 'jsonld':
				return findJsonLdInLines(lines, filePath, identifier.jsonLdType)

			default:
				return undefined
		}
	} catch {
		return undefined
	}
}

/**
 * Find title element in source lines
 */
function findTitleInLines(
	lines: string[],
	filePath: string,
	content?: string,
): SeoSourceLocation | undefined {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || ''

		// Match <title>...</title> or <title>
		if (line.includes('<title')) {
			// Check if content matches (if specified)
			if (content) {
				// Handle single-line title
				const match = line.match(/<title[^>]*>([^<]*)<\/title>/i)
				if (match?.[1]?.includes(content.substring(0, 20))) {
					return {
						sourcePath: path.relative(getProjectRoot(), filePath),
						sourceLine: i + 1,
						sourceSnippet: extractMultiLineElement(lines, i, 'title'),
					}
				}
				// Handle multi-line or dynamic title
				if (line.includes('<title')) {
					return {
						sourcePath: path.relative(getProjectRoot(), filePath),
						sourceLine: i + 1,
						sourceSnippet: extractMultiLineElement(lines, i, 'title'),
					}
				}
			} else {
				return {
					sourcePath: path.relative(getProjectRoot(), filePath),
					sourceLine: i + 1,
					sourceSnippet: extractMultiLineElement(lines, i, 'title'),
				}
			}
		}
	}

	return undefined
}

/**
 * Find meta element in source lines
 */
function findMetaInLines(
	lines: string[],
	filePath: string,
	identifier: SeoElementIdentifier,
): SeoSourceLocation | undefined {
	const { name, property, content } = identifier

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || ''

		if (!line.includes('<meta')) continue

		// Check for name attribute match
		if (name) {
			const nameMatch = line.match(/name\s*=\s*["']([^"']+)["']/i)
			if (nameMatch && nameMatch[1] === name) {
				// Verify content if specified
				if (content) {
					const contentMatch = line.match(/content\s*=\s*["']([^"']*)["']/i)
					if (contentMatch?.[1]?.includes(content.substring(0, 30))) {
						return {
							sourcePath: path.relative(getProjectRoot(), filePath),
							sourceLine: i + 1,
							sourceSnippet: extractMultiLineElement(lines, i, 'meta'),
						}
					}
				} else {
					return {
						sourcePath: path.relative(getProjectRoot(), filePath),
						sourceLine: i + 1,
						sourceSnippet: extractMultiLineElement(lines, i, 'meta'),
					}
				}
			}
		}

		// Check for property attribute match (OG/Twitter)
		if (property) {
			const propMatch = line.match(/property\s*=\s*["']([^"']+)["']/i)
			if (propMatch && propMatch[1] === property) {
				return {
					sourcePath: path.relative(getProjectRoot(), filePath),
					sourceLine: i + 1,
					sourceSnippet: extractMultiLineElement(lines, i, 'meta'),
				}
			}
		}
	}

	return undefined
}

/**
 * Find canonical link in source lines
 */
function findCanonicalInLines(
	lines: string[],
	filePath: string,
	href?: string,
): SeoSourceLocation | undefined {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || ''

		if (line.includes('rel="canonical"') || line.includes("rel='canonical'")) {
			// Verify href if specified
			if (href) {
				if (line.includes(href.substring(0, 30))) {
					return {
						sourcePath: path.relative(getProjectRoot(), filePath),
						sourceLine: i + 1,
						sourceSnippet: extractMultiLineElement(lines, i, 'link'),
					}
				}
			} else {
				return {
					sourcePath: path.relative(getProjectRoot(), filePath),
					sourceLine: i + 1,
					sourceSnippet: extractMultiLineElement(lines, i, 'link'),
				}
			}
		}
	}

	return undefined
}

/**
 * Find JSON-LD script in source lines
 */
function findJsonLdInLines(
	lines: string[],
	filePath: string,
	jsonLdType?: string,
): SeoSourceLocation | undefined {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || ''

		if (line.includes('application/ld+json')) {
			// Check if @type matches (if specified)
			if (jsonLdType) {
				// Look ahead for @type in following lines
				const snippet = extractMultiLineElement(lines, i, 'script')
				if (snippet.includes(`"@type"`) && snippet.includes(jsonLdType)) {
					return {
						sourcePath: path.relative(getProjectRoot(), filePath),
						sourceLine: i + 1,
						sourceSnippet: snippet,
					}
				}
			} else {
				return {
					sourcePath: path.relative(getProjectRoot(), filePath),
					sourceLine: i + 1,
					sourceSnippet: extractMultiLineElement(lines, i, 'script'),
				}
			}
		}
	}

	return undefined
}

/**
 * Extract a potentially multi-line element from source lines
 */
function extractMultiLineElement(lines: string[], startLine: number, tag: string): string {
	const snippetLines: string[] = []
	let depth = 0
	let foundClosing = false

	// For self-closing tags like <meta /> and <link />
	const isSelfClosing = ['meta', 'link', 'img', 'br', 'hr', 'input'].includes(tag.toLowerCase())

	for (let i = startLine; i < Math.min(startLine + 30, lines.length); i++) {
		const line = lines[i]
		if (!line) continue

		snippetLines.push(line)

		// For self-closing tags, check if line ends the tag
		if (isSelfClosing) {
			if (line.includes('/>') || (line.includes('>') && !line.includes('</' + tag))) {
				foundClosing = true
				break
			}
		} else {
			// Count opening and closing tags
			const openTags = (line.match(new RegExp(`<${tag}(?:[\\s>]|$)`, 'gi')) || []).length
			const selfClose = (line.match(new RegExp(`<${tag}[^>]*/>`, 'gi')) || []).length
			const closeTags = (line.match(new RegExp(`</${tag}>`, 'gi')) || []).length

			depth += openTags - selfClose - closeTags

			if (depth <= 0 && (closeTags > 0 || selfClose > 0)) {
				foundClosing = true
				break
			}
		}
	}

	if (!foundClosing && snippetLines.length > 1) {
		return snippetLines[0] || ''
	}

	return snippetLines.join('\n')
}
