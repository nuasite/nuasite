import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import { getMarkdownFileCache } from './cache'
import { normalizeText } from './snippet-utils'
import type { CollectionInfo, MarkdownContent, SourceLocation } from './types'

// ============================================================================
// Markdown File Cache
// ============================================================================

/**
 * Get cached markdown file content
 */
async function getCachedMarkdownFile(filePath: string): Promise<{ content: string; lines: string[] } | null> {
	const cache = getMarkdownFileCache()
	const cached = cache.get(filePath)
	if (cached) return cached

	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')
		const entry = { content, lines }
		cache.set(filePath, entry)
		return entry
	} catch {
		return null
	}
}

// ============================================================================
// Collection Source Finding
// ============================================================================

/**
 * Find markdown collection file for a given page path.
 *
 * Uses slug-based reverse lookup: scans all collection directories for a
 * matching entry regardless of the URL prefix. This supports localized or
 * renamed routes (e.g. `/aktuality/my-article` with content in `src/content/news/`).
 *
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
		return undefined
	}

	const contentPath = path.join(getProjectRoot(), contentDir)

	try {
		await fs.access(contentPath)
	} catch {
		return undefined
	}

	// List all collection directories (skip _ and . prefixed)
	let collectionDirs: string[]
	try {
		const entries = await fs.readdir(contentPath, { withFileTypes: true })
		collectionDirs = entries
			.filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
			.map(e => e.name)
	} catch {
		return undefined
	}

	// Try progressively longer tail segments as slug candidates
	// For /a/b/c try: "c", then "b/c"
	for (let i = pathParts.length - 1; i >= 1; i--) {
		const slug = pathParts.slice(i).join('/')
		const matches: { name: string; file: string }[] = []

		for (const dir of collectionDirs) {
			const collectionPath = path.join(contentPath, dir)
			const mdFile = await findMarkdownFile(collectionPath, slug)
			if (mdFile) {
				matches.push({ name: dir, file: mdFile })
			}
		}

		if (matches.length === 1 && matches[0]) {
			return {
				name: matches[0].name,
				slug,
				file: path.relative(getProjectRoot(), matches[0].file),
			}
		}

		if (matches.length > 1 && matches[0]) {
			// Disambiguate: prefer collection whose name matches the URL prefix
			const urlPrefix = pathParts[0]
			const prefixMatch = matches.find(m => m.name === urlPrefix)
			const chosen = prefixMatch || matches[0]

			return {
				name: chosen.name,
				slug,
				file: path.relative(getProjectRoot(), chosen.file),
			}
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

// ============================================================================
// Markdown Source Location Finding
// ============================================================================

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
		const filePath = path.join(getProjectRoot(), collectionInfo.file)
		const cached = await getCachedMarkdownFile(filePath)
		if (!cached) return undefined

		const { lines } = cached
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

// ============================================================================
// Markdown Content Parsing
// ============================================================================

/**
 * Parse markdown file and extract frontmatter fields and full body content.
 * Uses caching for better performance.
 * @param collectionInfo - Collection information (name, slug, file path)
 * @returns Parsed markdown content with frontmatter and body
 */
export async function parseMarkdownContent(
	collectionInfo: CollectionInfo,
): Promise<MarkdownContent | undefined> {
	try {
		const filePath = path.join(getProjectRoot(), collectionInfo.file)
		const cached = await getCachedMarkdownFile(filePath)
		if (!cached) return undefined

		const { lines } = cached

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
