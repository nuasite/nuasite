// ============================================================================
// Public API - Barrel File
// ============================================================================
// This file re-exports the public API for backward compatibility.
// All imports from './source-finder' will continue to work unchanged.

// Types (public)
export type { CollectionInfo, MarkdownContent, SourceLocation, VariableReference } from './types'

// Cache management
export { clearSourceFinderCache, markFileDirty } from './cache'

// Search index
export { initializeSearchIndex, reindexDirtyFiles } from './search-index'

// Source location finding
export { findSourceLocation } from './source-lookup'

// Attribute source finding
export { findAttributeSourceLocation } from './cross-file-tracker'

// Image finding
export { findImageSourceLocation } from './image-finder'

// Collection/markdown finding
export {
	buildCollectionTextIndex,
	findCollectionSource,
	findFieldInCollectionEntry,
	findMarkdownSourceLocation,
	findTextInAnyCollectionFrontmatter,
	lookupCollectionText,
	parseMarkdownContent,
} from './collection-finder'

// Snippet utilities (used by html-processor)
export {
	enhanceManifestWithSourceSnippets,
	extractCompleteTagSnippet,
	extractInnerHtmlFromSnippet,
	extractOpeningTagWithLine,
	extractSourceSnippet,
	updateAttributeSources,
	updateColorClassSources,
} from './snippet-utils'
