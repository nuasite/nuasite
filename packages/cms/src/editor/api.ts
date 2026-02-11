import { API } from './constants'
import { setAvailableTextStyles } from './text-styling'
import type {
	CmsManifest,
	ComponentInsertOperation,
	DeploymentStatusResponse,
	SaveBatchRequest,
	SaveBatchResponse,
	UpdateMarkdownPageRequest,
	UpdateMarkdownPageResponse,
} from './types'

/**
 * Response from fetching markdown content
 */
export interface GetMarkdownContentResponse {
	content: string
	frontmatter: Record<string, unknown>
	filePath: string
}

/**
 * Types for CMS AI chat communication (SSE events)
 */
export interface CmsAiChatRequest {
	prompt: string
	elementId?: string
	currentContent?: string
	pageUrl: string
	/** Source file context for the element being edited */
	context?: string
	sessionId?: string
}

export type CmsAiEvent =
	| CmsAiTokenEvent
	| CmsAiStatusEvent
	| CmsAiActionEvent
	| CmsAiErrorEvent
	| CmsAiDoneEvent

export interface CmsAiTokenEvent {
	type: 'token'
	token: string
	fullText: string
}

export interface CmsAiStatusEvent {
	type: 'status'
	status: 'thinking' | 'coding' | 'building' | 'deploying' | 'complete'
	message?: string
}

export interface CmsAiActionEvent {
	type: 'action'
	action: CmsAiAction
}

export type CmsAiAction =
	| { name: 'refresh' }
	| { name: 'preview'; url: string }
	| { name: 'commit'; sha: string; message: string }
	| { name: 'apply-edit'; elementId: string; content: string; htmlContent?: string }

export interface CmsAiErrorEvent {
	type: 'error'
	error: string
	code?: string
}

export interface CmsAiDoneEvent {
	type: 'done'
	summary?: string
}

export interface CmsAiStreamCallbacks {
	onToken?: (token: string, fullText: string) => void
	onStatus?: (status: CmsAiStatusEvent['status'], message?: string) => void
	onAction?: (action: CmsAiAction) => void
	onError?: (error: string, code?: string) => void
	onDone?: (summary?: string) => void
}

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
 * Get the manifest URL for the current page
 * For example: /about -> /about.json
 *              / -> /index.json
 *              /blog/post -> /blog/post.json
 */
export function getPageManifestUrl(pathname: string): string {
	// Normalize path: remove trailing slash, default to 'index' for root
	let path = pathname
	if (path.length > 1 && path.endsWith('/')) {
		path = path.slice(0, -1)
	}
	if (path === '/' || path === '') {
		return '/index.json'
	}
	// Remove leading slash for the manifest path
	const cleanPath = path.replace(/^\//, '')
	return `/${cleanPath}.json`
}

/**
 * Fetch manifest by combining page-specific and global manifests:
 * 1. Per-page manifest (/{page}.json) - contains entries, components for this page
 * 2. Global manifest (/cms-manifest.json) - contains componentDefinitions, availableColors
 */
export async function fetchManifest(): Promise<CmsManifest> {
	const pathname = window.location.pathname
	const pageManifestUrl = getPageManifestUrl(pathname)
	const globalManifestUrl = '/cms-manifest.json'

	// Fetch both manifests in parallel with cache-busting to bypass CDN/edge caches
	const cacheBuster = `_t=${Date.now()}`
	const [pageResult, globalResult] = await Promise.allSettled([
		fetchWithTimeout(`${pageManifestUrl}?${cacheBuster}`, { cache: 'no-store' }).then(res => res.ok ? res.json() : null),
		fetchWithTimeout(`${globalManifestUrl}?${cacheBuster}`, { cache: 'no-store' }).then(res => res.ok ? res.json() : null),
	])

	const pageManifest = pageResult.status === 'fulfilled' ? pageResult.value : null
	const globalManifest = globalResult.status === 'fulfilled' ? globalResult.value : null

	// Need at least one manifest to work with
	if (!pageManifest && !globalManifest) {
		throw new Error('Failed to load manifest from all sources')
	}

	// Get text styles from global manifest
	const availableTextStyles = globalManifest?.availableTextStyles ?? pageManifest?.availableTextStyles

	// Set text styles for inline style resolution
	setAvailableTextStyles(availableTextStyles)

	// Handle collection (singular) from page manifest - convert to collections format
	let collections = pageManifest?.collections ?? {}
	if (pageManifest?.collection) {
		const entry = pageManifest.collection
		const key = `${entry.collectionName}/${entry.collectionSlug}`
		collections = { ...collections, [key]: entry }
	}

	// Merge manifests: page-specific data + global settings
	return {
		entries: pageManifest?.entries ?? {},
		components: pageManifest?.components ?? {},
		componentDefinitions: globalManifest?.componentDefinitions ?? pageManifest?.componentDefinitions ?? {},
		collectionDefinitions: globalManifest?.collectionDefinitions ?? {},
		collections,
		availableColors: globalManifest?.availableColors ?? pageManifest?.availableColors,
		availableTextStyles,
		pages: globalManifest?.pages ?? pageManifest?.pages,
		metadata: pageManifest?.metadata,
		// SEO data from page-specific manifest
		seo: pageManifest?.seo,
	} as CmsManifest
}

export async function saveBatchChanges(
	apiBase: string,
	request: SaveBatchRequest,
): Promise<SaveBatchResponse> {
	const res = await fetchWithTimeout(`${apiBase}/update`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(request),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Save failed (${res.status}): ${text || res.statusText}`)
	}

	return res.json().catch(() => ({ updated: 0 }))
}

export interface InsertComponentResponse {
	success: boolean
	message?: string
	sourceFile?: string
	commit?: string | null
	commitMessage?: string
	error?: string
}

export async function insertComponent(
	apiBase: string,
	operation: ComponentInsertOperation,
): Promise<InsertComponentResponse> {
	const res = await fetchWithTimeout(`${apiBase}/insert-component`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			position: operation.position,
			referenceComponentId: operation.referenceComponentId,
			componentName: operation.componentName,
			props: operation.props,
			meta: {
				source: 'inline-editor',
				url: window.location.href,
			},
		}),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Insert component failed (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

export interface RemoveComponentResponse {
	success: boolean
	message?: string
	sourceFile?: string
	commit?: string | null
	commitMessage?: string
	error?: string
}

export interface AddArrayItemResponse {
	success: boolean
	message?: string
	sourceFile?: string
	error?: string
}

export async function addArrayItem(
	apiBase: string,
	referenceComponentId: string,
	position: 'before' | 'after',
	props: Record<string, unknown>,
): Promise<AddArrayItemResponse> {
	const res = await fetchWithTimeout(`${apiBase}/add-array-item`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			referenceComponentId,
			position,
			props,
			meta: {
				source: 'inline-editor',
				url: window.location.href,
			},
		}),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Add array item failed (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

export interface RemoveArrayItemResponse {
	success: boolean
	message?: string
	sourceFile?: string
	error?: string
}

export async function removeArrayItem(
	apiBase: string,
	componentId: string,
): Promise<RemoveArrayItemResponse> {
	const res = await fetchWithTimeout(`${apiBase}/remove-array-item`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			componentId,
			meta: {
				source: 'inline-editor',
				url: window.location.href,
			},
		}),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Remove array item failed (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

export async function removeComponent(
	apiBase: string,
	componentId: string,
): Promise<RemoveComponentResponse> {
	const res = await fetchWithTimeout(`${apiBase}/remove-component`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			componentId,
			meta: {
				source: 'inline-editor',
				url: window.location.href,
			},
		}),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Remove component failed (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

/**
 * Parse SSE data line to event
 */
export function parseSseEvent(data: string): CmsAiEvent | null {
	if (data === '[DONE]') {
		return { type: 'done' }
	}
	try {
		return JSON.parse(data) as CmsAiEvent
	} catch {
		return null
	}
}

/**
 * Stream AI chat response from the server using SSE
 * Provides rich events including status updates, actions (refresh, preview), and streaming tokens
 */
export async function streamAiChat(
	apiBase: string,
	request: CmsAiChatRequest,
	callbacks: CmsAiStreamCallbacks,
	abortSignal?: AbortSignal,
): Promise<void> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), API.AI_STREAM_TIMEOUT_MS)

	// Allow external abort signal to also abort the request
	if (abortSignal) {
		abortSignal.addEventListener('abort', () => controller.abort())
	}

	let doneCalled = false

	try {
		const res = await fetch(`${apiBase}/ai/chat`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(request),
			signal: controller.signal,
		})

		if (!res.ok) {
			const text = await res.text().catch(() => '')
			callbacks.onError?.(text || `Request failed (${res.status})`, String(res.status))
			return
		}

		if (!res.body) {
			callbacks.onError?.('No response body')
			return
		}

		const reader = res.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		while (true) {
			const { done, value } = await reader.read()

			if (done) {
				break
			}

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')

			// Keep the last incomplete line in the buffer
			buffer = lines.pop() || ''

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim()
					if (!data) continue

					const event = parseSseEvent(data)
					if (!event) continue

					switch (event.type) {
						case 'token':
							callbacks.onToken?.(event.token, event.fullText)
							break
						case 'status':
							callbacks.onStatus?.(event.status, event.message)
							break
						case 'action':
							callbacks.onAction?.(event.action)
							break
						case 'error':
							callbacks.onError?.(event.error, event.code)
							break
						case 'done':
							if (!doneCalled) {
								doneCalled = true
								callbacks.onDone?.(event.summary)
							}
							return
					}
				}
			}
		}

		// Process any remaining buffer
		if (buffer.startsWith('data: ')) {
			const data = buffer.slice(6).trim()
			if (data) {
				const event = parseSseEvent(data)
				if (event?.type === 'done' && !doneCalled) {
					doneCalled = true
					callbacks.onDone?.(event.summary)
				}
			}
		}

		if (!doneCalled) {
			doneCalled = true
			callbacks.onDone?.()
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			callbacks.onError?.('Request timed out or was cancelled', 'TIMEOUT')
			return
		}
		callbacks.onError?.(error instanceof Error ? error.message : 'Unknown error')
	} finally {
		clearTimeout(timeoutId)
	}
}

/**
 * Chat message type from history endpoint
 */
export interface ChatHistoryMessage {
	id: string
	role: 'user' | 'assistant' | 'tool'
	content: string | null
	created_at: string
	channel?: string
	identifier?: string
}

export interface ChatHistoryResponse {
	messages: ChatHistoryMessage[]
	hasMore: boolean
}

/**
 * Fetch AI chat history for the current project
 */
export async function getChatHistory(
	apiBase: string,
	limit = 50,
): Promise<ChatHistoryResponse> {
	const res = await fetchWithTimeout(`${apiBase}/ai/chat/history?limit=${limit}`, {
		method: 'GET',
		credentials: 'include',
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Failed to fetch chat history (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

/**
 * Fetch deployment status for the current project
 */
export async function getDeploymentStatus(
	apiBase: string,
): Promise<DeploymentStatusResponse> {
	const res = await fetchWithTimeout(`${apiBase}/deployment/status`, {
		method: 'GET',
		credentials: 'include',
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Failed to fetch deployment status (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

/**
 * Fetch markdown content from a file
 */
export async function getMarkdownContent(
	apiBase: string,
	filePath: string,
): Promise<GetMarkdownContentResponse | null> {
	const res = await fetchWithTimeout(
		`${apiBase}/markdown/content?filePath=${encodeURIComponent(filePath)}`,
		{
			method: 'GET',
			credentials: 'include',
		},
	)

	if (!res.ok) {
		if (res.status === 404) {
			return null
		}
		const text = await res.text().catch(() => '')
		throw new Error(`Failed to fetch markdown content (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}

/**
 * Update markdown page content
 */
export async function updateMarkdownPage(
	apiBase: string,
	request: UpdateMarkdownPageRequest,
): Promise<UpdateMarkdownPageResponse> {
	const res = await fetchWithTimeout(`${apiBase}/markdown/update`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(request),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Failed to update markdown page (${res.status}): ${text || res.statusText}`)
	}

	return res.json()
}
