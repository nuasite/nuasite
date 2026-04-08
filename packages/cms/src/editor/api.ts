import { API } from './constants'
import { fetchWithTimeout } from './fetch'
import { setAvailableTextStyles } from './text-styling'
import type {
	CmsManifest,
	ComponentInsertOperation,
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
		// MDX component allowlist from global manifest
		mdxComponents: globalManifest?.mdxComponents,
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
