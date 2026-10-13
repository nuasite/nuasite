import type { ParseCache } from '@nuasite/cms-core'
import path from 'node:path'
import type { CachedParsedFile, ImageIndexEntry, SearchIndexEntry, SourceLocation } from '../source-finder/types'

/**
 * A collection's route info: a usable static URL prefix (e.g. '/blog/'), or
 * `true` when the collection is confirmed routed by some page but no static
 * prefix can be fabricated because an ancestor path segment is itself dynamic
 * (e.g. `[topic]/[slug].astro`) — callers must resolve those entries' pathnames
 * from their own declared URL instead of `${prefix}${slug}`.
 */
export type CollectionRouteInfo = string | true

/**
 * Everything the visual editor caches about one project's sources. One instance per project
 * context, so two projects served by one process never see each other's files.
 */
export class ProjectState {
	/** Parsed Astro (and tsx/jsx) files, by absolute path. */
	readonly parsedFiles = new Map<string, CachedParsedFile>()
	/** Parses in flight, so concurrent requests for one file share one parse. */
	readonly parsing = new Map<string, Promise<CachedParsedFile | null>>()
	/** Directory listings. */
	readonly directories = new Map<string, string[]>()
	/** Markdown and data file contents. */
	readonly markdownFiles = new Map<string, { content: string; lines: string[] }>()
	/** Search indexes; cleared in place so holders of the arrays never see stale entries. */
	readonly textSearchIndex: SearchIndexEntry[] = []
	readonly imageSearchIndex: ImageIndexEntry[] = []
	searchIndexInitialized = false
	searchIndexBuild: Promise<void> | null = null
	reindex: Promise<void> | null = null
	/** Reverse index normalizedText → locations in collection data files. */
	collectionTextIndex: Map<string, SourceLocation[]> | null = null
	collectionTextIndexBuild: Promise<void> | null = null
	/** Per collection directory: declared page URL → file. */
	readonly declaredUrlIndex = new Map<string, Map<string, string>>()
	/** translationKey → entries, rebuilt lazily after the text index changes. */
	translationKeyIndex: Map<string, SearchIndexEntry[]> | null = null
	/** Files changed since they were last indexed. */
	readonly dirtyFiles = new Set<string>()
	/** Collections rendered by dynamic page routes. */
	collectionRoutes: Map<string, CollectionRouteInfo> | null = null
	/** Content-config parse cache for standalone collection scans. */
	readonly contentConfigParses: ParseCache = new Map()
	/** Per-file write locks, by absolute path. */
	readonly fileLocks = new Map<string, Promise<void>>()

	/**
	 * Note a changed file: its parse is dropped now and its index entries are refreshed on the
	 * next page. Its collection directory's URL index goes too, since the change may move a
	 * declared URL. That index is keyed by collection directory, which is the file's directory
	 * for `<dir>/<slug>.md` and its parent for `<dir>/<slug>/index.md`, so both are evicted.
	 */
	markFileDirty(absPath: string): void {
		this.dirtyFiles.add(absPath)
		this.parsedFiles.delete(absPath)
		const fileDir = path.dirname(absPath)
		this.declaredUrlIndex.delete(fileDir)
		this.declaredUrlIndex.delete(path.dirname(fileDir))
	}

	/** Forget every cached file and index, as at the start of a build. */
	clear(): void {
		this.parsedFiles.clear()
		this.directories.clear()
		this.markdownFiles.clear()
		this.dirtyFiles.clear()
		this.textSearchIndex.length = 0
		this.imageSearchIndex.length = 0
		this.searchIndexInitialized = false
		this.collectionTextIndex = null
		this.translationKeyIndex = null
		this.declaredUrlIndex.clear()
	}
}
