import { currentProjectContext } from '../project/context.ts'
import type { CachedParsedFile, ImageIndexEntry, SearchIndexEntry, SourceLocation } from './types.ts'

// The source finder's caches, held per project context (see `ProjectState`).

function state() {
	return currentProjectContext().state
}

export function getParsedFileCache(): Map<string, CachedParsedFile> {
	return state().parsedFiles
}

export function getDirectoryCache(): Map<string, string[]> {
	return state().directories
}

export function getMarkdownFileCache(): Map<string, { content: string; lines: string[] }> {
	return state().markdownFiles
}

export function getTextSearchIndex(): SearchIndexEntry[] {
	return state().textSearchIndex
}

export function getImageSearchIndex(): ImageIndexEntry[] {
	return state().imageSearchIndex
}

export function isSearchIndexInitialized(): boolean {
	return state().searchIndexInitialized
}

export function setSearchIndexInitialized(value: boolean): void {
	state().searchIndexInitialized = value
}

export function addToTextSearchIndex(entry: SearchIndexEntry): void {
	const current = state()
	current.textSearchIndex.push(entry)
	current.translationKeyIndex = null
}

/**
 * Reverse-index i18n entries by their dictionary key, rebuilt lazily after
 * mutations. Callers should treat the returned Map as read-only.
 */
export function getTranslationKeyIndex(): Map<string, SearchIndexEntry[]> {
	const current = state()
	if (current.translationKeyIndex) return current.translationKeyIndex
	const map = new Map<string, SearchIndexEntry[]>()
	for (const entry of current.textSearchIndex) {
		if (!entry.translationKey) continue
		const existing = map.get(entry.translationKey)
		if (existing) existing.push(entry)
		else map.set(entry.translationKey, [entry])
	}
	current.translationKeyIndex = map
	return map
}

export function addToImageSearchIndex(entry: ImageIndexEntry): void {
	state().imageSearchIndex.push(entry)
}

export function getCollectionTextIndex(): Map<string, SourceLocation[]> | null {
	return state().collectionTextIndex
}

export function setCollectionTextIndex(index: Map<string, SourceLocation[]> | null): void {
	state().collectionTextIndex = index
}

export function getDeclaredUrlIndexCache(): Map<string, Map<string, string>> {
	return state().declaredUrlIndex
}

// ============================================================================
// Dirty File Tracking (incremental re-indexing)
// ============================================================================

/**
 * Mark a file as dirty so its index entries are refreshed on next page load.
 * Called when source files change (the Vite watcher, or a host's invalidation).
 * @param absPath - Absolute path to the changed file
 */
export function markFileDirty(absPath: string): void {
	state().markFileDirty(absPath)
}

export function getDirtyFiles(): Set<string> {
	return state().dirtyFiles
}

export function clearDirtyFiles(): void {
	state().dirtyFiles.clear()
}

/**
 * Remove all index entries for a specific file (by relative path).
 * Used before re-indexing a changed file to avoid duplicates.
 */
export function removeFileFromIndexes(relFile: string): void {
	const current = state()
	filterInPlace(current.textSearchIndex, (e) => e.file !== relFile)
	filterInPlace(current.imageSearchIndex, (e) => e.file !== relFile)
	current.translationKeyIndex = null
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

/**
 * Clear all caches - call at start of each build
 */
export function clearSourceFinderCache(): void {
	state().clear()
}
