export interface MediaItem {
	id: string
	url: string
	filename: string
	annotation?: string
	contentType: string
	width?: number
	height?: number
	uploadedAt?: string
	/** Folder path relative to media root (e.g. 'photos') */
	folder?: string
}

export interface MediaFolderItem {
	/** Folder name (last segment) */
	name: string
	/** Full relative path from media root (e.g. 'photos/vacation') */
	path: string
}

export type MediaTypeFilter = 'all' | 'photo' | 'graphic' | 'video' | 'document'

export interface MediaListOptions {
	limit?: number
	cursor?: string
	/** List contents of this subfolder (relative to media root) */
	folder?: string
}

export interface MediaListResult {
	items: MediaItem[]
	/** Subfolders in the current directory */
	folders: MediaFolderItem[]
	hasMore: boolean
	cursor?: string
}

export interface MediaUploadResult {
	success: boolean
	url?: string
	filename?: string
	annotation?: string
	id?: string
	error?: string
}

export interface MediaStorageAdapter {
	list(options?: MediaListOptions): Promise<MediaListResult>
	upload(file: Buffer, filename: string, contentType: string, options?: { folder?: string }): Promise<MediaUploadResult>
	delete(id: string): Promise<{ success: boolean; error?: string }>
	/** Create an empty folder. Folders are also created implicitly on upload. */
	createFolder?(folder: string): Promise<{ success: boolean; error?: string }>
	/** Local filesystem info for direct file serving in dev (bypasses Vite's public dir cache) */
	staticFiles?: { urlPrefix: string; dir: string }
}
