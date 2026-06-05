/**
 * Typed read-only client over the cms-sidecar `/cms/v1` HTTP contract.
 *
 * The host (webmaster BFF, or a local dev proxy in F7) mounts the sidecar under
 * an `apiBase` and adds the `/cms/v1` prefix itself — so this client requests
 * `${apiBase}/project`, `${apiBase}/collections`, etc. (never `/cms/v1/...`).
 *
 * The structural model (collections/entries/fields) is reused 1:1 from
 * `@nuasite/cms-types`. The thin HTTP envelope (project model, sparse entries
 * list, error codes) mirrors the sidecar's wire types; it is declared here
 * because those types are not part of the `@nuasite/cms-types` contract surface.
 */

import type { CollectionDefinition, CollectionEntry, CollectionEntryInfo } from '@nuasite/cms-types'

// ============================================================================
// Wire envelope (mirrors @nuasite/cms-sidecar's `/cms/v1` contract)
// ============================================================================

/** Stable error codes the sidecar exposes, each mapped to an HTTP status. */
export type CmsErrorCode =
	| 'not_found'
	| 'conflict'
	| 'validation'
	| 'parse_error'
	| 'io_error'
	| 'unsupported'
	| 'unauthorized'

/** JSON body returned for every non-2xx response that is not a conflict. */
export interface CmsApiError {
	error: string
	code: CmsErrorCode
	sourcePath?: string
}

/** A static page route discovered under `src/pages` (pathname-only). */
export interface CmsPageEntry {
	pathname: string
	title?: string
}

/** Features the sidecar advertises so the UI can degrade gracefully. */
export interface CmsCapabilities {
	coreVersion: string
	features: string[]
}

/** `GET /project` — the whole structural model in one call. */
export interface CmsProjectModel {
	collections: CollectionDefinition[]
	pages: CmsPageEntry[]
	capabilities: CmsCapabilities
}

/** `GET …/entries` — projected entries plus an opaque continuation cursor. */
export interface CmsEntriesListResult {
	entries: CollectionEntryInfo[]
	cursor?: string
	hasMore: boolean
}

// ============================================================================
// Client error
// ============================================================================

/**
 * Thrown for any non-2xx response. Carries the parsed sidecar error code so the
 * UI can distinguish auth failures (`unauthorized`/`forbidden`) from a missing
 * collection/entry (`not_found`) or a generic failure.
 */
export class CmsClientError extends Error {
	constructor(
		readonly status: number,
		readonly code: CmsErrorCode | 'forbidden' | 'unknown',
		message: string,
	) {
		super(message)
		this.name = 'CmsClientError'
	}

	/** Session cookie missing/expired upstream — the user must re-authenticate. */
	get isUnauthorized(): boolean {
		return this.code === 'unauthorized' || this.status === 401
	}

	/** Authenticated but lacks access to this project. */
	get isForbidden(): boolean {
		return this.code === 'forbidden' || this.status === 403
	}

	get isNotFound(): boolean {
		return this.code === 'not_found' || this.status === 404
	}
}

// ============================================================================
// Query options
// ============================================================================

export interface GetEntriesOptions {
	/** "slug,title" | "*" ; absent = light header (slug/title/draft/pathname). */
	fields?: string
	/** Draft filter — defaults to `'false'` (published only) on the sidecar. */
	draft?: 'true' | 'false' | 'all'
	/** Opaque continuation cursor from a previous page's `cursor`. */
	cursor?: string
	limit?: number
}

// ============================================================================
// Client
// ============================================================================

function isApiError(value: unknown): value is CmsApiError {
	return typeof value === 'object'
		&& value !== null
		&& 'error' in value
		&& typeof (value as { error: unknown }).error === 'string'
		&& 'code' in value
		&& typeof (value as { code: unknown }).code === 'string'
}

const KNOWN_ERROR_CODES: readonly CmsErrorCode[] = [
	'not_found',
	'conflict',
	'validation',
	'parse_error',
	'io_error',
	'unsupported',
	'unauthorized',
]

function isErrorCode(value: string): value is CmsErrorCode {
	return (KNOWN_ERROR_CODES as readonly string[]).includes(value)
}

export interface CmsClient {
	getProject(): Promise<CmsProjectModel>
	getCollections(): Promise<CollectionDefinition[]>
	getEntries(collection: string, options?: GetEntriesOptions): Promise<CmsEntriesListResult>
	getEntry(collection: string, slug: string): Promise<CollectionEntry>
}

export function createClient(apiBase: string): CmsClient {
	// Normalise: drop a trailing slash so `${base}${path}` joins cleanly.
	const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase

	async function request<T>(path: string): Promise<T> {
		const response = await fetch(`${base}${path}`, {
			method: 'GET',
			credentials: 'include',
			headers: { accept: 'application/json' },
		})

		if (!response.ok) {
			throw await toError(response)
		}

		// Successful responses are always JSON in the read-only surface.
		const value: T = await response.json()
		return value
	}

	async function toError(response: Response): Promise<CmsClientError> {
		// 403 is produced by the BFF (project scope), not the sidecar, so it has no
		// sidecar `code`; surface it as a distinct `forbidden`.
		if (response.status === 403) {
			const message = await readErrorMessage(response, 'You do not have access to this project.')
			return new CmsClientError(403, 'forbidden', message)
		}

		const body: unknown = await response.json().catch(() => null)
		if (isApiError(body) && isErrorCode(body.code)) {
			return new CmsClientError(response.status, body.code, body.error)
		}
		if (response.status === 401) {
			return new CmsClientError(401, 'unauthorized', 'Your session has expired. Please reload.')
		}
		return new CmsClientError(response.status, 'unknown', `Request failed (${response.status})`)
	}

	async function readErrorMessage(response: Response, fallback: string): Promise<string> {
		const body: unknown = await response.json().catch(() => null)
		if (isApiError(body)) return body.error
		if (typeof body === 'object' && body !== null && 'error' in body) {
			const err = (body as { error: unknown }).error
			if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
				return (err as { message: string }).message
			}
		}
		return fallback
	}

	return {
		getProject() {
			return request<CmsProjectModel>('/project')
		},
		getCollections() {
			return request<CollectionDefinition[]>('/collections')
		},
		getEntries(collection, options = {}) {
			const params = new URLSearchParams()
			if (options.fields !== undefined) params.set('fields', options.fields)
			if (options.draft !== undefined) params.set('draft', options.draft)
			if (options.cursor !== undefined) params.set('cursor', options.cursor)
			if (options.limit !== undefined) params.set('limit', String(options.limit))
			const query = params.toString()
			const suffix = query === '' ? '' : `?${query}`
			return request<CmsEntriesListResult>(`/collections/${encodeURIComponent(collection)}/entries${suffix}`)
		},
		getEntry(collection, slug) {
			return request<CollectionEntry>(`/collections/${encodeURIComponent(collection)}/entries/${encodeURIComponent(slug)}`)
		},
	}
}
