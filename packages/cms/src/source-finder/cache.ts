import type { CachedParsedFile, ImageIndexEntry, SearchIndexEntry } from './types'

// ============================================================================
// File Parsing Cache - Avoid re-parsing the same files
// ============================================================================

/** Cache for parsed Astro files - cleared between builds */
const parsedFileCache = new Map<string, CachedParsedFile>()

/** Cache for directory listings - cleared between builds */
const directoryCache = new Map<string, string[]>()

/** Cache for markdown file contents - cleared between builds */
const markdownFileCache = new Map<string, { content: string; lines: string[] }>()

/** Search indexes built once per build — use the same array instance and clear with length=0 to avoid stale references */
const textSearchIndex: SearchIndexEntry[] = []
const imageSearchIndex: ImageIndexEntry[] = []
let searchIndexInitialized = false

// ============================================================================
// Cache Access Functions
// ============================================================================

export function getParsedFileCache(): Map<string, CachedParsedFile> {
	return parsedFileCache
}

export function getDirectoryCache(): Map<string, string[]> {
	return directoryCache
}

export function getMarkdownFileCache(): Map<string, { content: string; lines: string[] }> {
	return markdownFileCache
}

export function getTextSearchIndex(): SearchIndexEntry[] {
	return textSearchIndex
}

export function getImageSearchIndex(): ImageIndexEntry[] {
	return imageSearchIndex
}

export function isSearchIndexInitialized(): boolean {
	return searchIndexInitialized
}

export function setSearchIndexInitialized(value: boolean): void {
	searchIndexInitialized = value
}

export function addToTextSearchIndex(entry: SearchIndexEntry): void {
	textSearchIndex.push(entry)
}

export function addToImageSearchIndex(entry: ImageIndexEntry): void {
	imageSearchIndex.push(entry)
}

// ============================================================================
// Cache Clear Function
// ============================================================================

/**
 * Clear all caches - call at start of each build
 */
export function clearSourceFinderCache(): void {
	parsedFileCache.clear()
	directoryCache.clear()
	markdownFileCache.clear()
	// Clear arrays in-place to avoid stale references from consumers
	textSearchIndex.length = 0
	imageSearchIndex.length = 0
	searchIndexInitialized = false
}
