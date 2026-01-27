import type { ElementNode, Node as AstroNode } from '@astrojs/compiler/types'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectRoot } from '../config'
import { getCachedParsedFile } from './ast-parser'
import { isSearchIndexInitialized } from './cache'
import { findInImageIndex } from './search-index'
import { extractImageSnippet } from './snippet-utils'
import type { ImageMatch, SourceLocation } from './types'

// ============================================================================
// Image Element Finding
// ============================================================================

/**
 * Walk the Astro AST to find img elements with specific src
 */
export function findImageElement(
	ast: AstroNode,
	imageSrc: string,
	lines: string[],
): ImageMatch | null {
	function visit(node: AstroNode): ImageMatch | null {
		if (node.type === 'element') {
			const elemNode = node as ElementNode
			if (elemNode.name.toLowerCase() === 'img') {
				for (const attr of elemNode.attributes) {
					if (attr.type === 'attribute' && attr.name === 'src' && attr.value === imageSrc) {
						const srcLine = attr.position?.start.line ?? elemNode.position?.start.line ?? 0
						const snippet = extractImageSnippet(lines, srcLine - 1)
						return {
							line: srcLine,
							src: imageSrc,
							snippet,
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const result = visit(child)
				if (result) return result
			}
		}

		return null
	}

	return visit(ast)
}

// ============================================================================
// Image Source Location Finding
// ============================================================================

/**
 * Find source file and line number for an image by its src attribute.
 * Uses pre-built search index for fast lookups.
 */
export async function findImageSourceLocation(
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	// Use index if available (much faster)
	if (isSearchIndexInitialized()) {
		return findInImageIndex(imageSrc)
	}

	// Fallback to slow search if index not initialized
	const srcDir = path.join(getProjectRoot(), 'src')

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

// ============================================================================
// Directory Search for Images
// ============================================================================

/**
 * Recursively search directory for image with matching src
 */
export async function searchDirectoryForImage(
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
 * Search a single file for an image with matching src.
 * Uses caching for better performance.
 */
async function searchFileForImage(
	filePath: string,
	imageSrc: string,
): Promise<SourceLocation | undefined> {
	try {
		// Use cached parsed file
		const cached = await getCachedParsedFile(filePath)
		if (!cached) return undefined

		const { lines, ast } = cached

		// Use AST parsing for Astro files
		if (filePath.endsWith('.astro')) {
			const imageMatch = findImageElement(ast, imageSrc, lines)

			if (imageMatch) {
				return {
					file: path.relative(getProjectRoot(), filePath),
					line: imageMatch.line,
					snippet: imageMatch.snippet,
					type: 'static',
				}
			}
		}

		// Regex fallback for TSX/JSX files or if AST parsing failed
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
						file: path.relative(getProjectRoot(), filePath),
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
