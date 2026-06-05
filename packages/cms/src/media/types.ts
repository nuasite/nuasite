// Media storage adapter types now live in @nuasite/cms-types (the shared wire model).
// Re-exported here so existing `../media/types` imports keep working unchanged.
export type {
	MediaFolderItem,
	MediaItem,
	MediaListOptions,
	MediaListResult,
	MediaStorageAdapter,
	MediaTypeFilter,
	MediaUploadResult,
} from '@nuasite/cms-types'
