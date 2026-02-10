import { API } from './constants'
import type {
	CmsConfig,
	CreateMarkdownPageRequest,
	CreateMarkdownPageResponse,
	MediaItem,
	MediaUploadResponse,
	UpdateMarkdownPageRequest,
	UpdateMarkdownPageResponse,
} from './types'

/**
 * Create a fetch request with timeout
 */
async function fetchWithTimeout(
	url: string,
	options: RequestInit = {},
	timeoutMs: number = API.REQUEST_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		})
		return response
	} finally {
		clearTimeout(timeoutId)
	}
}

/**
 * Create a new markdown page (blog post)
 */
export async function createMarkdownPage(
	config: CmsConfig,
	request: CreateMarkdownPageRequest,
): Promise<CreateMarkdownPageResponse> {
	const res = await fetchWithTimeout(`${config.apiBase}/markdown/create`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(request),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		return {
			success: false,
			error: `Create page failed (${res.status}): ${text || res.statusText}`,
		}
	}

	return res.json()
}

/**
 * Update an existing markdown page
 */
export async function updateMarkdownPage(
	config: CmsConfig,
	request: UpdateMarkdownPageRequest,
): Promise<UpdateMarkdownPageResponse> {
	const res = await fetchWithTimeout(`${config.apiBase}/markdown/update`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(request),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		return {
			success: false,
			error: `Update page failed (${res.status}): ${text || res.statusText}`,
		}
	}

	return res.json()
}

/**
 * Fetch markdown content from a file path
 */
export async function fetchMarkdownContent(
	config: CmsConfig,
	filePath: string,
): Promise<{ content: string; frontmatter: Record<string, unknown> } | null> {
	const res = await fetchWithTimeout(
		`${config.apiBase}/markdown/content?path=${encodeURIComponent(filePath)}`,
		{
			method: 'GET',
			credentials: 'include',
		},
	)

	if (!res.ok) {
		return null
	}

	return res.json()
}

/**
 * Fetch media library items
 */
export async function fetchMediaLibrary(
	config: CmsConfig,
	cursor?: string,
	limit = 50,
): Promise<{ items: MediaItem[]; hasMore: boolean; cursor?: string }> {
	const params = new URLSearchParams({ limit: String(limit) })
	if (cursor) {
		params.set('cursor', cursor)
	}

	const res = await fetchWithTimeout(`${config.apiBase}/media/list?${params}`, {
		method: 'GET',
		credentials: 'include',
	})

	if (!res.ok) {
		throw new Error(`Failed to fetch media library (${res.status})`)
	}

	return res.json()
}

/**
 * Upload a media file
 */
export async function uploadMedia(
	config: CmsConfig,
	file: File,
	onProgress?: (percent: number) => void,
): Promise<MediaUploadResponse> {
	const formData = new FormData()
	formData.append('file', file)

	// Use XMLHttpRequest for progress tracking
	return new Promise((resolve) => {
		const xhr = new XMLHttpRequest()

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable && onProgress) {
				const percent = Math.round((e.loaded / e.total) * 100)
				onProgress(percent)
			}
		})

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					const response = JSON.parse(xhr.responseText)
					resolve(response)
				} catch {
					resolve({ success: false, error: 'Invalid response format' })
				}
			} else {
				resolve({
					success: false,
					error: `Upload failed (${xhr.status}): ${xhr.statusText}`,
				})
			}
		})

		xhr.addEventListener('error', () => {
			resolve({ success: false, error: 'Network error during upload' })
		})

		xhr.addEventListener('timeout', () => {
			resolve({ success: false, error: 'Upload timed out' })
		})

		xhr.open('POST', `${config.apiBase}/media/upload`)
		xhr.withCredentials = true
		xhr.timeout = API.REQUEST_TIMEOUT_MS * 2 // Allow more time for uploads
		xhr.send(formData)
	})
}

/**
 * Delete a media item
 */
export async function deleteMedia(
	config: CmsConfig,
	mediaId: string,
): Promise<{ success: boolean; error?: string }> {
	const res = await fetchWithTimeout(`${config.apiBase}/media/${mediaId}`, {
		method: 'DELETE',
		credentials: 'include',
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		return {
			success: false,
			error: `Delete failed (${res.status}): ${text || res.statusText}`,
		}
	}

	return { success: true }
}
