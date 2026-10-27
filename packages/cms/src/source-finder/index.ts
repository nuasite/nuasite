// ============================================================================
// Public API - Barrel File
// ============================================================================
// This file re-exports the public API for backward compatibility.
// All imports from './source-finder' will continue to work unchanged.

// Types (public)
export type { CollectionInfo, MarkdownContent, SourceLocation, VariableReference } from './types.ts'

// Cache management
export { clearSourceFinderCache, markFileDirty } from './cache.ts'

// Search index
export { initializeSearchIndex, reindexDirtyFiles } from './search-index.ts'

// Source location finding
export { findSourceLocation } from './source-lookup.ts'

// Attribute source finding
export { findAttributeSourceLocation } from './cross-file-tracker.ts'

// Image finding
export { findImageSourceLocation } from './image-finder.ts'

// Collection/markdown finding
export {
	buildCollectionTextIndex,
	declaredSitePathFromData,
	findCollectionSource,
	findFieldInCollectionEntry,
	findMarkdownSourceLocation,
	findTextInAnyCollectionFrontmatter,
	lookupCollectionText,
	parseMarkdownContent,
} from './collection-finder.ts'

// Snippet utilities (used by html-processor)
export {
	enhanceManifestWithSourceSnippets,
	extractCompleteTagSnippet,
	extractInnerHtmlFromSnippet,
	extractOpeningTagWithLine,
	extractSourceSnippet,
	updateAttributeSources,
	updateColorClassSources,
} from './snippet-utils.ts'
