import fs from 'node:fs/promises'
import path from 'node:path'
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml'

import { getProjectRoot } from '../config'
import type { CollectionDefinition } from '../types'
import { getMarkdownFileCache } from './cache'
import { normalizeText } from './snippet-utils'
import type { CollectionInfo, MarkdownContent, SourceLocation } from './types'

// ============================================================================
// Collection Text Index — pre-built reverse index for fast text→source lookups
// ============================================================================

/** Pre-built index: normalizedText → SourceLocation (with collection metadata) */
let collectionTextIndex: Map<string, SourceLocation[]> | null = null
let collectionTextIndexPromise: Promise<void> | null = null

/**
 * Build a reverse index of all text values in collection data/frontmatter files.
 * After this call, `lookupCollectionText()` returns results in O(1).
 */
export async function buildCollectionTextIndex(
	collections: Record<string, CollectionDefinition>,
): Promise<void> {
	if (collectionTextIndex) return
	if (collectionTextIndexPromise) return collectionTextIndexPromise
	collectionTextIndexPromise = doBuildCollectionTextIndex(collections)
	try {
		await collectionTextIndexPromise
	} finally {
		collectionTextIndexPromise = null
	}
}

async function doBuildCollectionTextIndex(
	collections: Record<string, CollectionDefinition>,
): Promise<void> {
	const index = new Map<string, SourceLocation[]>()

	for (const def of Object.values(collections)) {
		if (!def.entries || def.entries.length === 0) continue

		await Promise.all(def.entries.map(async (entry) => {
			const info: CollectionInfo = { name: def.name, slug: entry.slug, file: entry.sourcePath }
			try {
				const filePath = path.join(getProjectRoot(), entry.sourcePath)
				const cached = await getCachedMarkdownFile(filePath)
				if (!cached) return

				if (def.type === 'data') {
					// Data file — index all scalars from the full YAML
					collectScalarsFromYaml(cached.content, 0, cached.lines, info, index)
				} else {
					// Markdown — index scalars from frontmatter only
					const { lines } = cached
					let fmStart = -1
					let fmEnd = -1
					for (let i = 0; i < lines.length; i++) {
						if (lines[i]?.trim() === '---') {
							if (fmStart === -1) fmStart = i
							else {
								fmEnd = i
								break
							}
						}
					}
					if (fmEnd > 0) {
						const yamlStr = lines.slice(fmStart + 1, fmEnd).join('\n')
						collectScalarsFromYaml(yamlStr, fmStart + 1, lines, info, index)
					}
				}
			} catch {
				// Skip unreadable files
			}
		}))
	}

	collectionTextIndex = index
}

/**
 * Walk a YAML document and collect all scalar values into the text index.
 */
function collectScalarsFromYaml(
	yamlStr: string,
	lineOffset: number,
	fileLines: string[],
	collectionInfo: CollectionInfo,
	index: Map<string, SourceLocation[]>,
): void {
	const lineCounter = new LineCounter()
	const doc = parseDocument(yamlStr, { lineCounter })
	collectFromYamlNode(doc.contents, lineOffset, fileLines, collectionInfo, lineCounter, index)
}

function collectFromYamlNode(
	node: unknown,
	lineOffset: number,
	fileLines: string[],
	collectionInfo: CollectionInfo,
	lineCounter: LineCounter,
	index: Map<string, SourceLocation[]>,
): void {
	if (isMap(node)) {
		for (const pair of node.items) {
			if (!isPair(pair) || !isScalar(pair.key)) continue
			const key = String(pair.key.value)

			if (isScalar(pair.value)) {
				const normalized = normalizeText(String(pair.value.value))
				if (normalized.length < 2) continue
				const keyRange = (pair.key as any).range as [number, number, number] | undefined
				const valRange = (pair.value as any).range as [number, number, number] | undefined
				const startLine = (keyRange ? lineCounter.linePos(keyRange[0]).line : 1) + lineOffset
				const endLine = (valRange ? lineCounter.linePos(valRange[1]).line : startLine - lineOffset) + lineOffset
				const snippet = fileLines.slice(startLine - 1, endLine).join('\n')

				const loc: SourceLocation = {
					file: collectionInfo.file,
					line: startLine,
					snippet,
					type: 'collection',
					variableName: key,
					collectionName: collectionInfo.name,
					collectionSlug: collectionInfo.slug,
				}
				const existing = index.get(normalized)
				if (existing) existing.push(loc)
				else index.set(normalized, [loc])
			} else {
				collectFromYamlNode(pair.value, lineOffset, fileLines, collectionInfo, lineCounter, index)
			}
		}
	} else if (isSeq(node)) {
		for (const item of node.items) {
			if (isScalar(item)) {
				const normalized = normalizeText(String(item.value))
				if (normalized.length < 2) continue
				const range = (item as any).range as [number, number, number] | undefined
				const startLine = (range ? lineCounter.linePos(range[0]).line : 1) + lineOffset
				const endLine = (range ? lineCounter.linePos(range[1]).line : startLine - lineOffset) + lineOffset
				const snippet = fileLines.slice(startLine - 1, endLine).join('\n')

				const loc: SourceLocation = {
					file: collectionInfo.file,
					line: startLine,
					snippet,
					type: 'collection',
					collectionName: collectionInfo.name,
					collectionSlug: collectionInfo.slug,
				}
				const existing = index.get(normalized)
				if (existing) existing.push(loc)
				else index.set(normalized, [loc])
			} else {
				collectFromYamlNode(item, lineOffset, fileLines, collectionInfo, lineCounter, index)
			}
		}
	}
}

/**
 * O(1) lookup in the pre-built collection text index.
 * Returns all matching source locations, preferring referenced collections.
 */
export function lookupCollectionText(
	textContent: string,
	referenceIndex?: Map<string, Array<{ collection: string; fieldName: string; isArray?: boolean }>>,
): SourceLocation | undefined {
	if (!collectionTextIndex) return undefined
	const normalized = normalizeText(textContent)
	const locations = collectionTextIndex.get(normalized)
	if (!locations || locations.length === 0) return undefined

	// Prefer locations from referenced collections
	if (referenceIndex) {
		for (const loc of locations) {
			if (loc.collectionName && referenceIndex.has(loc.collectionName)) {
				return loc
			}
		}
	}
	return locations[0]
}

/** Clear the collection text index (called when collection files change) */
export function clearCollectionTextIndex(): void {
	collectionTextIndex = null
}

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

	if (pathParts.length < 1 || (pathParts.length === 1 && !pathParts[0])) {
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

		// Find frontmatter boundaries
		let frontmatterStart = -1
		let frontmatterEnd = -1
		for (let i = 0; i < lines.length; i++) {
			if (lines[i]?.trim() === '---') {
				if (frontmatterStart === -1) {
					frontmatterStart = i
				} else {
					frontmatterEnd = i
					break
				}
			}
		}
		if (frontmatterEnd <= 0) return undefined

		const yamlStr = lines.slice(frontmatterStart + 1, frontmatterEnd).join('\n')
		const lineOffset = frontmatterStart + 1
		return findScalarInYamlAst(yamlStr, lineOffset, normalizedSearch, lines, collectionInfo)
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Search all collection entries for a text value across all formats
 * (markdown frontmatter, JSON, YAML data files).
 */
export async function findTextInAnyCollectionFrontmatter(
	textContent: string,
	collections: Record<string, CollectionDefinition>,
): Promise<SourceLocation | undefined> {
	const normalizedSearch = normalizeText(textContent)

	for (const def of Object.values(collections)) {
		if (!def.entries || def.entries.length === 0) continue

		for (const entry of def.entries) {
			const info: CollectionInfo = { name: def.name, slug: entry.slug, file: entry.sourcePath }

			if (def.type === 'data') {
				const result = await findTextInDataFile(normalizedSearch, info)
				if (result) return result
			} else {
				const result = await findMarkdownSourceLocation(textContent, info)
				if (result) return result
			}
		}
	}
	return undefined
}

/**
 * Search a data file (JSON, YAML, YML) for a scalar value using AST parsing.
 * JSON is valid YAML, so parseDocument handles all formats uniformly.
 */
async function findTextInDataFile(
	normalizedSearch: string,
	collectionInfo: CollectionInfo,
): Promise<SourceLocation | undefined> {
	try {
		const filePath = path.join(getProjectRoot(), collectionInfo.file)
		const cached = await getCachedMarkdownFile(filePath)
		if (!cached) return undefined

		return findScalarInYamlAst(cached.content, 0, normalizedSearch, cached.lines, collectionInfo)
	} catch {
		// Error reading file
	}
	return undefined
}

/**
 * Walk a YAML AST to find a scalar value matching the search text.
 * Handles nested maps and sequences.
 */
function findScalarInYamlAst(
	yamlStr: string,
	lineOffset: number,
	normalizedSearch: string,
	fileLines: string[],
	collectionInfo: CollectionInfo,
): SourceLocation | undefined {
	const lineCounter = new LineCounter()
	const doc = parseDocument(yamlStr, { lineCounter })

	const found = walkYamlNode(doc.contents, normalizedSearch, lineCounter)
	if (!found) return undefined

	const fileStartLine = found.startLine + lineOffset
	const fileEndLine = found.endLine + lineOffset

	// Build snippet spanning all lines of the key-value pair (handles multi-line YAML values)
	const snippet = fileLines.slice(fileStartLine - 1, fileEndLine).join('\n')

	return {
		file: collectionInfo.file,
		line: fileStartLine,
		snippet,
		type: 'collection',
		variableName: found.key,
		collectionName: collectionInfo.name,
		collectionSlug: collectionInfo.slug,
	}
}

/** Recursively walk a YAML node to find a scalar matching the search text */
function walkYamlNode(
	node: unknown,
	normalizedSearch: string,
	lineCounter: LineCounter,
): { key: string | undefined; startLine: number; endLine: number } | undefined {
	if (isMap(node)) {
		for (const pair of node.items) {
			if (!isPair(pair) || !isScalar(pair.key)) continue
			const key = String(pair.key.value)

			if (isScalar(pair.value)) {
				if (normalizeText(String(pair.value.value)) === normalizedSearch) {
					const keyRange = (pair.key as any).range as [number, number, number] | undefined
					const valRange = (pair.value as any).range as [number, number, number] | undefined
					const startLine = keyRange ? lineCounter.linePos(keyRange[0]).line : 1
					const endLine = valRange ? lineCounter.linePos(valRange[1]).line : startLine
					return { key, startLine, endLine }
				}
			} else {
				// Recurse into nested maps/sequences
				const nested = walkYamlNode(pair.value, normalizedSearch, lineCounter)
				if (nested) return nested
			}
		}
	} else if (isSeq(node)) {
		for (const item of node.items) {
			if (isScalar(item)) {
				if (normalizeText(String(item.value)) === normalizedSearch) {
					const range = (item as any).range as [number, number, number] | undefined
					const startLine = range ? lineCounter.linePos(range[0]).line : 1
					const endLine = range ? lineCounter.linePos(range[1]).line : startLine
					return { key: undefined, startLine, endLine }
				}
			} else {
				const nested = walkYamlNode(item, normalizedSearch, lineCounter)
				if (nested) return nested
			}
		}
	}
	return undefined
}

/**
 * Find an image field by name in a specific collection entry's data file.
 * Used when the rendered image URL has been transformed (e.g., Astro hashed filenames)
 * and can't be matched by value, but we know the field name from the expression.
 */
export async function findFieldInCollectionEntry(
	fieldName: string,
	collectionName: string,
	collectionSlug: string,
	collectionDefinitions: Record<string, CollectionDefinition>,
): Promise<SourceLocation | undefined> {
	const def = collectionDefinitions[collectionName]
	if (!def?.entries) return undefined

	const entry = def.entries.find((e) => e.slug === collectionSlug)
	if (!entry) return undefined

	const info: CollectionInfo = { name: collectionName, slug: collectionSlug, file: entry.sourcePath }

	try {
		const filePath = path.join(getProjectRoot(), entry.sourcePath)
		const cached = await getCachedMarkdownFile(filePath)
		if (!cached) return undefined

		if (def.type === 'data') {
			return findFieldByNameInYaml(cached.content, 0, fieldName, cached.lines, info)
		}

		// For markdown, search inside frontmatter only
		const { lines } = cached
		let fmStart = -1
		let fmEnd = -1
		for (let i = 0; i < lines.length; i++) {
			if (lines[i]?.trim() === '---') {
				if (fmStart === -1) fmStart = i
				else {
					fmEnd = i
					break
				}
			}
		}
		if (fmEnd <= 0) return undefined
		const yamlStr = lines.slice(fmStart + 1, fmEnd).join('\n')
		return findFieldByNameInYaml(yamlStr, fmStart + 1, fieldName, lines, info)
	} catch {
		return undefined
	}
}

/**
 * Walk a YAML AST to find a field by key name (regardless of its value).
 */
function findFieldByNameInYaml(
	yamlStr: string,
	lineOffset: number,
	fieldName: string,
	fileLines: string[],
	collectionInfo: CollectionInfo,
): SourceLocation | undefined {
	const lineCounter = new LineCounter()
	const doc = parseDocument(yamlStr, { lineCounter })
	if (!isMap(doc.contents)) return undefined

	for (const pair of doc.contents.items) {
		if (!isPair(pair) || !isScalar(pair.key)) continue
		if (String(pair.key.value) !== fieldName) continue
		if (!isScalar(pair.value)) continue

		const keyRange = (pair.key as any).range as [number, number, number] | undefined
		const valRange = (pair.value as any).range as [number, number, number] | undefined
		const startLine = (keyRange ? lineCounter.linePos(keyRange[0]).line : 1) + lineOffset
		const endLine = (valRange ? lineCounter.linePos(valRange[1]).line : startLine - lineOffset) + lineOffset

		const snippet = fileLines.slice(startLine - 1, endLine).join('\n')
		return {
			file: collectionInfo.file,
			line: startLine,
			snippet,
			type: 'collection',
			variableName: fieldName,
			collectionName: collectionInfo.name,
			collectionSlug: collectionInfo.slug,
		}
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

		// Extract frontmatter fields using yaml parser
		if (frontmatterEnd > 0) {
			const yamlStr = lines.slice(frontmatterStart + 1, frontmatterEnd).join('\n')
			const lineCounter = new LineCounter()
			const doc = parseDocument(yamlStr, { lineCounter })

			if (isMap(doc.contents)) {
				for (const pair of doc.contents.items) {
					if (isPair(pair) && isScalar(pair.key)) {
						const key = String(pair.key.value)
						const value = isScalar(pair.value) ? String(pair.value.value) : ''
						const keyRange = (pair.key as any).range
						const yamlLine = keyRange ? lineCounter.linePos(keyRange[0]).line : 0
						const fileLine = yamlLine + frontmatterStart + 1
						if (key && value) {
							frontmatter[key] = { value, line: fileLine }
						}
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
