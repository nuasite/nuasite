export interface MediaItem {
	id: string
	url: string
	filename: string
	annotation?: string
	contentType: string
	width?: number
	height?: number
	uploadedAt?: string
}

export interface MediaListResult {
	items: MediaItem[]
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
	list(options?: { limit?: number; cursor?: string }): Promise<MediaListResult>
	upload(file: Buffer, filename: string, contentType: string): Promise<MediaUploadResult>
	delete(id: string): Promise<{ success: boolean; error?: string }>
	/** Local filesystem info for direct file serving in dev (bypasses Vite's public dir cache) */
	staticFiles?: { urlPrefix: string; dir: string }
}
