import { API } from './constants'
import { fetchWithTimeout, getJson, postJson } from './fetch'
import type {
	AddRedirectRequest,
	CmsConfig,
	CreateMarkdownPageRequest,
	CreateMarkdownPageResponse,
	CreatePageRequest,
	DeletePageRequest,
	DeleteRedirectRequest,
	DuplicatePageRequest,
	GetRedirectsResponse,
	LayoutInfo,
	MediaItem,
	MediaUploadResponse,
	PageOperationResponse,
	RedirectOperationResponse,
	UpdateMarkdownPageRequest,
	UpdateMarkdownPageResponse,
	UpdateRedirectRequest,
} from './types'

// Markdown operations

export function createMarkdownPage(config: CmsConfig, request: CreateMarkdownPageRequest): Promise<CreateMarkdownPageResponse> {
	return postJson(`${config.apiBase}/markdown/create`, request, 'Create page failed')
}

export function updateMarkdownPage(config: CmsConfig, request: UpdateMarkdownPageRequest): Promise<UpdateMarkdownPageResponse> {
	return postJson(`${config.apiBase}/markdown/update`, request, 'Update page failed')
}

export function renameMarkdownPage(
	config: CmsConfig,
	filePath: string,
	newSlug: string,
): Promise<{ success: boolean; newFilePath?: string; newSlug?: string; error?: string }> {
	return postJson(`${config.apiBase}/markdown/rename`, { filePath, newSlug }, 'Rename failed')
}

export function deleteMarkdownPage(config: CmsConfig, filePath: string): Promise<{ success: boolean; error?: string }> {
	return postJson(`${config.apiBase}/markdown/delete`, { filePath }, 'Delete failed')
}

export function fetchMarkdownContent(
	config: CmsConfig,
	filePath: string,
): Promise<{ content: string; frontmatter: Record<string, unknown> } | null> {
	return getJson(`${config.apiBase}/markdown/content?path=${encodeURIComponent(filePath)}`, null)
}

// Media operations

export async function fetchMediaLibrary(
	config: CmsConfig,
	options?: { cursor?: string; limit?: number; folder?: string; type?: string },
): Promise<{ items: MediaItem[]; folders?: Array<{ name: string; path: string }>; hasMore: boolean; cursor?: string }> {
	const params = new URLSearchParams({ limit: String(options?.limit ?? 50) })
	if (options?.cursor) params.set('cursor', options.cursor)
	if (options?.folder) params.set('folder', options.folder)
	if (options?.type && options.type !== 'all') params.set('type', options.type)

	const res = await fetchWithTimeout(`${config.apiBase}/media/list?${params}`, {
		method: 'GET',
		credentials: 'include',
	})

	if (!res.ok) throw new Error(`Failed to fetch media library (${res.status})`)
	return res.json()
}

export function uploadMedia(
	config: CmsConfig,
	file: File,
	onProgress?: (percent: number) => void,
	options?: { folder?: string },
): Promise<MediaUploadResponse> {
	const formData = new FormData()
	formData.append('file', file)

	const params = new URLSearchParams()
	if (options?.folder) params.set('folder', options.folder)
	const qs = params.toString()

	return new Promise((resolve) => {
		const xhr = new XMLHttpRequest()

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable && onProgress) {
				onProgress(Math.round((e.loaded / e.total) * 100))
			}
		})

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(JSON.parse(xhr.responseText))
				} catch {
					resolve({ success: false, error: 'Invalid response format' })
				}
			} else {
				resolve({ success: false, error: `Upload failed (${xhr.status}): ${xhr.statusText}` })
			}
		})

		xhr.addEventListener('error', () => resolve({ success: false, error: 'Network error during upload' }))
		xhr.addEventListener('timeout', () => resolve({ success: false, error: 'Upload timed out' }))

		xhr.open('POST', `${config.apiBase}/media/upload${qs ? `?${qs}` : ''}`)
		xhr.withCredentials = true
		xhr.timeout = API.REQUEST_TIMEOUT_MS * 2
		xhr.send(formData)
	})
}

export async function createMediaFolder(
	config: CmsConfig,
	folder: string,
): Promise<{ success: boolean; error?: string }> {
	return postJson(`${config.apiBase}/media/folder`, { folder }, 'Create folder failed')
}

export async function fetchProjectImages(config: CmsConfig): Promise<{ items: MediaItem[] }> {
	const res = await fetchWithTimeout(`${config.apiBase}/media/project-images`, {
		method: 'GET',
		credentials: 'include',
	})

	if (!res.ok) throw new Error(`Failed to fetch project images (${res.status})`)
	return res.json()
}

export async function deleteMedia(config: CmsConfig, mediaId: string): Promise<{ success: boolean; error?: string }> {
	const res = await fetchWithTimeout(`${config.apiBase}/media/${mediaId}`, {
		method: 'DELETE',
		credentials: 'include',
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		return { success: false, error: `Delete failed (${res.status}): ${text || res.statusText}` }
	}

	return { success: true }
}

// Page operations

export function createPage(config: CmsConfig, request: CreatePageRequest): Promise<PageOperationResponse> {
	return postJson(`${config.apiBase}/page/create`, request)
}

export function duplicatePage(config: CmsConfig, request: DuplicatePageRequest): Promise<PageOperationResponse> {
	return postJson(`${config.apiBase}/page/duplicate`, request)
}

export function deletePage(config: CmsConfig, request: DeletePageRequest): Promise<PageOperationResponse> {
	return postJson(`${config.apiBase}/page/delete`, request)
}

export function checkSlugExists(config: CmsConfig, slug: string, signal?: AbortSignal): Promise<{ exists: boolean; filePath?: string }> {
	return getJson(`${config.apiBase}/page/check-slug?slug=${encodeURIComponent(slug)}`, { exists: false }, signal)
}

export function getLayouts(config: CmsConfig): Promise<{ layouts: LayoutInfo[] }> {
	return getJson(`${config.apiBase}/page/layouts`, { layouts: [] })
}

// Redirect operations

export function getRedirects(config: CmsConfig): Promise<GetRedirectsResponse> {
	return getJson(`${config.apiBase}/redirects`, { rules: [] })
}

export function addRedirect(config: CmsConfig, request: AddRedirectRequest): Promise<RedirectOperationResponse> {
	return postJson(`${config.apiBase}/redirects/add`, request)
}

export function updateRedirect(config: CmsConfig, request: UpdateRedirectRequest): Promise<RedirectOperationResponse> {
	return postJson(`${config.apiBase}/redirects/update`, request)
}

export function deleteRedirect(config: CmsConfig, request: DeleteRedirectRequest): Promise<RedirectOperationResponse> {
	return postJson(`${config.apiBase}/redirects/delete`, request)
}
