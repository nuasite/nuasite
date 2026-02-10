import { createHash } from 'node:crypto'
import path from 'node:path'
import { getProjectRoot } from './config'
import type { ManifestEntry } from './types'

/**
 * Normalize a page path by removing query strings, hashes, and trailing slashes.
 * Handles both full URLs and plain pathnames.
 * Examples: '/about/' -> '/about', 'http://localhost/about?x=1' -> '/about'
 */
export function normalizePagePath(url: string): string {
	let pathname: string
	try {
		const parsed = new URL(url)
		pathname = parsed.pathname
	} catch {
		pathname = url.split('?')[0]?.split('#')[0] ?? ''
	}
	if (pathname.length > 1 && pathname.endsWith('/')) {
		pathname = pathname.slice(0, -1)
	}
	return pathname || '/'
}

/**
 * Generate a SHA256 hash of the given content
 */
export function sha256(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Generate a short hash (first 12 characters of SHA256)
 * Used for stableId to keep it reasonably short but still unique
 */
export function shortHash(content: string): string {
	return sha256(content).substring(0, 12)
}

/**
 * Generate a stable ID for an element based on its content and context.
 * This ID survives rebuilds as long as the content and structure remain similar.
 *
 * Components:
 * - tag name
 * - first 50 chars of text content
 * - source path (if available)
 */
export function generateStableId(
	tag: string,
	text: string,
	sourcePath?: string,
): string {
	const components = [
		tag,
		text.substring(0, 50).trim(),
		sourcePath || '',
	]

	return shortHash(components.join('|'))
}

/**
 * Generate a hash of the source snippet for conflict detection.
 * If the source file changes, this hash will differ from what's stored in manifest.
 */
export function generateSourceHash(sourceSnippet: string): string {
	return sha256(sourceSnippet)
}

/**
 * Generate a content hash for the entire manifest (all entries).
 * Used for quick drift detection without comparing individual entries.
 */
export function generateManifestContentHash(entries: Record<string, ManifestEntry>): string {
	// Sort keys for deterministic hashing
	const sortedKeys = Object.keys(entries).sort()
	const content = sortedKeys.map(key => {
		const entry = entries[key]!
		// Hash only content-relevant fields, not generated IDs
		return `${entry.tag}|${entry.text}|${entry.html || ''}|${entry.sourcePath || ''}`
	}).join('\n')

	return sha256(content)
}

/**
 * Generate per-source-file hashes for granular conflict detection.
 * Maps source file path -> hash of all entries from that file.
 */
export function generateSourceFileHashes(entries: Record<string, ManifestEntry>): Record<string, string> {
	// Group entries by source file
	const entriesByFile: Record<string, ManifestEntry[]> = {}

	for (const entry of Object.values(entries)) {
		const sourcePath = entry.sourcePath
		if (sourcePath) {
			if (!entriesByFile[sourcePath]) {
				entriesByFile[sourcePath] = []
			}
			entriesByFile[sourcePath].push(entry)
		}
	}

	// Generate hash for each file
	const hashes: Record<string, string> = {}
	for (const [filePath, fileEntries] of Object.entries(entriesByFile)) {
		// Sort entries by line number for determinism
		const sorted = fileEntries.sort((a, b) => (a.sourceLine || 0) - (b.sourceLine || 0))
		const content = sorted.map(e => `${e.sourceLine || 0}|${e.text}|${e.sourceSnippet || ''}`).join('\n')
		hashes[filePath] = sha256(content)
	}

	return hashes
}

// ============================================================================
// Regex Utility
// ============================================================================

/**
 * Escape special regex characters in a string for use in `new RegExp()`.
 */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Escape a string for safe use as a replacement in `String.prototype.replace()`.
 * Prevents `$1`, `$$`, `$&` etc. from being interpreted as backreferences.
 */
export function escapeReplacement(str: string): string {
	return str.replace(/\$/g, '$$$$')
}

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Resolve a user-provided file path and ensure it stays within the project root.
 * Throws if the resolved path escapes the project boundary.
 */
export function resolveAndValidatePath(filePath: string): string {
	const projectRoot = getProjectRoot()
	const fullPath = path.isAbsolute(filePath)
		? path.resolve(filePath)
		: path.resolve(projectRoot, filePath)

	const resolvedRoot = path.resolve(projectRoot)
	if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
		throw new Error(`Path traversal detected: ${filePath}`)
	}

	return fullPath
}

// ============================================================================
// File Lock
// ============================================================================

const fileLocks = new Map<string, Promise<void>>()

/**
 * Acquire a per-file lock for safe read-modify-write operations.
 * Returns a release function to call when done.
 */
export async function acquireFileLock(filePath: string): Promise<() => void> {
	const key = path.resolve(filePath)

	// Wait for any existing lock on this file
	while (fileLocks.has(key)) {
		await fileLocks.get(key)
	}

	let release!: () => void
	const lockPromise = new Promise<void>((resolve) => {
		release = resolve
	})
	fileLocks.set(key, lockPromise)

	return () => {
		fileLocks.delete(key)
		release()
	}
}
