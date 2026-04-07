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

/** Files that changed since last indexing — tracked by Vite watcher */
const dirtyFiles = new Set<string>()

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
// Dirty File Tracking (incremental re-indexing)
// ============================================================================

/**
 * Mark a file as dirty so its index entries are refreshed on next page load.
 * Called by the Vite file watcher when source files change.
 * @param absPath - Absolute path to the changed file
 */
export function markFileDirty(absPath: string): void {
	dirtyFiles.add(absPath)
	// Also evict the parsed file cache so it's re-read from disk
	parsedFileCache.delete(absPath)
}

export function getDirtyFiles(): Set<string> {
	return dirtyFiles
}

export function clearDirtyFiles(): void {
	dirtyFiles.clear()
}

/**
 * Remove all index entries for a specific file (by relative path).
 * Used before re-indexing a changed file to avoid duplicates.
 */
export function removeFileFromIndexes(relFile: string): void {
	filterInPlace(textSearchIndex, (e) => e.file !== relFile)
	filterInPlace(imageSearchIndex, (e) => e.file !== relFile)
}

/** Remove non-matching elements in-place (single pass, no per-element splice). */
function filterInPlace<T>(arr: T[], keep: (item: T) => boolean): void {
	let write = 0
	for (const item of arr) {
		if (keep(item)) {
			arr[write++] = item
		}
	}
	arr.length = write
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
	dirtyFiles.clear()
	// Clear arrays in-place to avoid stale references from consumers
	textSearchIndex.length = 0
	imageSearchIndex.length = 0
	searchIndexInitialized = false
}
