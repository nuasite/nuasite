/**
 * Typed client over the cms-sidecar `/cms/v1` HTTP contract (reads + mutations).
 *
 * The host (webmaster BFF, or a local dev proxy in F7) mounts the sidecar under
 * an `apiBase` and adds the `/cms/v1` prefix itself — so this client requests
 * `${apiBase}/project`, `${apiBase}/collections`, etc. (never `/cms/v1/...`).
 *
 * The structural model (collections/entries/fields) is reused 1:1 from
 * `@nuasite/cms-types`. The thin HTTP envelope (project model, sparse entries
 * list, error codes, mutation bodies, conflict response) mirrors the sidecar's
 * wire types; it is declared here because those types are not part of the
 * `@nuasite/cms-types` contract surface.
 */

import type {
	CmsConfig,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	MediaListResult,
	MediaUploadResult,
	MutationResult,
} from '@nuasite/cms-types'

/** HTTP status the sidecar uses for an optimistic-concurrency conflict. */
const STATUS_CONFLICT = 409

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

/**
 * `409` body for a `PATCH` whose `baseHash` no longer matches disk (an agent or a
 * human wrote in between). Carries the current server version so the UI can offer
 * "use server" vs "use ours". Mirrors the sidecar `ConflictResponse`.
 */
export interface CmsConflict {
	code: 'conflict'
	serverHash: string
	/** Raw (non-stringified) server frontmatter — unlike the line-keyed GET-detail shape. */
	serverFrontmatter: Record<string, unknown>
	serverBody?: string
}

/** `PATCH …/entries/:slug` — frontmatter keys are merged (not replaced). */
export interface UpdateEntryInput {
	frontmatter?: Record<string, unknown>
	body?: string
	/** Hash of the source the client edited; drives optimistic concurrency. */
	baseHash?: string
}

export interface CreateEntryInput {
	slug: string
	frontmatter: Record<string, unknown>
	body?: string
	/** File extension override for data collections (e.g. 'json', 'yaml'). */
	fileExtension?: string
}

/** Context passed to media operations so uploads can be filed against an entry/field. */
export interface MediaContext {
	collection?: string
	entry?: string
	field?: string
	/** Subfolder under the media root. */
	folder?: string
}

/**
 * Either a successful `MutationResult` or a `409` conflict the caller must
 * resolve. Returned (not thrown) by `updateEntry` so the editor can branch
 * without exception flow.
 */
export type UpdateEntryResult =
	| { status: 'ok'; result: MutationResult }
	| { status: 'conflict'; conflict: CmsConflict }

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
	return isRecord(value)
		&& typeof value.error === 'string'
		&& typeof value.code === 'string'
}

/** Narrow `unknown` to a record so property reads typecheck without casts. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isConflict(value: unknown): value is CmsConflict {
	if (!isRecord(value)) return false
	return value.code === 'conflict'
		&& typeof value.serverHash === 'string'
		&& isRecord(value.serverFrontmatter)
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
	getConfig(): Promise<CmsConfig>
	getCollections(): Promise<CollectionDefinition[]>
	getEntries(collection: string, options?: GetEntriesOptions): Promise<CmsEntriesListResult>
	getEntry(collection: string, slug: string): Promise<CollectionEntry>

	/** Astro component definitions for the MDX body editor (block picker + prop labels). */
	getComponents(): Promise<ComponentDefinition[]>

	// --- Mutations ---

	/**
	 * Merge-patch an entry's frontmatter/body. Returns a discriminated result: a
	 * `409` is surfaced as `{ status: 'conflict' }` (not thrown) so the editor can
	 * open the conflict dialog. The new `baseHash` is on `result.sourceHash`.
	 */
	updateEntry(collection: string, slug: string, input: UpdateEntryInput): Promise<UpdateEntryResult>
	createEntry(collection: string, input: CreateEntryInput): Promise<MutationResult>
	deleteEntry(collection: string, slug: string): Promise<MutationResult>
	renameEntry(collection: string, slug: string, to: string): Promise<MutationResult>
	addArrayItem(collection: string, slug: string, field: string, value: unknown, index?: number): Promise<MutationResult>
	removeArrayItem(collection: string, slug: string, field: string, index: number): Promise<MutationResult>

	// --- Media (degrades gracefully when the sidecar has no adapter wired: 501). ---

	listMedia(options?: { folder?: string; cursor?: string; limit?: number }): Promise<MediaListResult>
	uploadMedia(file: File, context?: MediaContext): Promise<MediaUploadResult>
	/**
	 * Build a GET URL for an asset referenced by an entry — an `image`/`file` value
	 * such as `../../src/assets/x.webp` that the sidecar resolves relative to the
	 * entry source and streams. Suitable for `<img src>` (no auth header needed for
	 * the same-origin local studio; the BFF must allow the route for hosted use).
	 */
	mediaFileUrl(collection: string, entry: string, path: string): string
	deleteMedia(id: string): Promise<{ success: boolean; error?: string }>
	/** Create an empty media subfolder (sidecar `POST /media` JSON). 501 if the adapter has none. */
	createFolder(folder: string): Promise<{ success: boolean; error?: string }>
}

/**
 * Whether a thrown `CmsClientError` means "media is not available" — the deployed
 * sidecar may have no media adapter wired (`501 unsupported`). The picker uses
 * this to degrade gracefully instead of surfacing a hard error.
 */
export function isMediaUnavailable(error: unknown): boolean {
	return error instanceof CmsClientError && (error.status === 501 || error.code === 'unsupported')
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
		// sidecar `code`; `errorFromBody` surfaces it as a distinct `forbidden`.
		const body: unknown = await response.json().catch(() => null)
		return errorFromBody(response.status, body)
	}

	function errorMessageFromBody(body: unknown, fallback: string): string {
		if (isApiError(body)) return body.error
		if (isRecord(body)) {
			const err = body.error
			if (isRecord(err) && typeof err.message === 'string') return err.message
		}
		return fallback
	}

	/** Build a `CmsClientError` from an already-parsed body (no re-read of the stream). */
	function errorFromBody(status: number, body: unknown): CmsClientError {
		if (status === 403) {
			return new CmsClientError(403, 'forbidden', errorMessageFromBody(body, 'You do not have access to this project.'))
		}
		if (isApiError(body) && isErrorCode(body.code)) {
			return new CmsClientError(status, body.code, body.error)
		}
		if (status === 401) {
			return new CmsClientError(401, 'unauthorized', 'Your session has expired. Please reload.')
		}
		return new CmsClientError(status, 'unknown', errorMessageFromBody(body, `Request failed (${status})`))
	}

	function mutationInit(method: string, body?: unknown): RequestInit {
		const init: RequestInit = {
			method,
			credentials: 'include',
			headers: { accept: 'application/json' },
		}
		if (body !== undefined) {
			init.body = JSON.stringify(body)
			init.headers = { accept: 'application/json', 'content-type': 'application/json' }
		}
		return init
	}

	/**
	 * Send a JSON-body mutation (POST/PATCH/DELETE). Throws `CmsClientError` on any
	 * non-2xx — used by the mutations that have no conflict branch. The
	 * conflict-aware update has its own path below.
	 */
	async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
		const response = await fetch(`${base}${path}`, mutationInit(method, body))
		if (!response.ok) throw await toError(response)
		// Mutation responses are documented JSON; the asserted shape is trusted
		// (`response.json()` widens to the declared `T`, mirroring `request`).
		const value: T = await response.json()
		return value
	}

	function entryPath(collection: string, slug: string): string {
		return `/collections/${encodeURIComponent(collection)}/entries/${encodeURIComponent(slug)}`
	}

	return {
		getProject() {
			return request<CmsProjectModel>('/project')
		},
		getConfig() {
			return request<CmsConfig>('/config')
		},
		getCollections() {
			return request<CollectionDefinition[]>('/collections')
		},
		getComponents() {
			return request<ComponentDefinition[]>('/components')
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
			return request<CollectionEntry>(entryPath(collection, slug))
		},

		async updateEntry(collection, slug, input) {
			const response = await fetch(`${base}${entryPath(collection, slug)}`, mutationInit('PATCH', input))
			// A `409` carries the server version; parse and return it for the dialog.
			if (response.status === STATUS_CONFLICT) {
				const body: unknown = await response.json().catch(() => null)
				if (isConflict(body)) return { status: 'conflict', conflict: body }
				throw errorFromBody(response.status, body)
			}
			if (!response.ok) throw await toError(response)
			const result: MutationResult = await response.json()
			return { status: 'ok', result }
		},
		createEntry(collection, input) {
			return mutate<MutationResult>(`/collections/${encodeURIComponent(collection)}/entries`, 'POST', input)
		},
		deleteEntry(collection, slug) {
			return mutate<MutationResult>(entryPath(collection, slug), 'DELETE')
		},
		renameEntry(collection, slug, to) {
			return mutate<MutationResult>(`${entryPath(collection, slug)}/rename`, 'POST', { to })
		},
		addArrayItem(collection, slug, field, value, index) {
			const body = index === undefined ? { field, value } : { field, value, index }
			return mutate<MutationResult>(`${entryPath(collection, slug)}/array`, 'POST', body)
		},
		removeArrayItem(collection, slug, field, index) {
			return mutate<MutationResult>(`${entryPath(collection, slug)}/array`, 'DELETE', { field, index })
		},

		listMedia(options = {}) {
			const params = new URLSearchParams()
			if (options.folder !== undefined) params.set('folder', options.folder)
			if (options.cursor !== undefined) params.set('cursor', options.cursor)
			if (options.limit !== undefined) params.set('limit', String(options.limit))
			const query = params.toString()
			return request<MediaListResult>(`/media${query === '' ? '' : `?${query}`}`)
		},
		async uploadMedia(file, context = {}) {
			// The sidecar reads upload context (collection/entry/field/folder) from the
			// query string; the file rides in multipart form data under `file`.
			const params = new URLSearchParams()
			if (context.collection !== undefined) params.set('collection', context.collection)
			if (context.entry !== undefined) params.set('entry', context.entry)
			if (context.field !== undefined) params.set('field', context.field)
			if (context.folder !== undefined) params.set('folder', context.folder)
			const query = params.toString()
			const form = new FormData()
			form.append('file', file)
			const response = await fetch(`${base}/media${query === '' ? '' : `?${query}`}`, {
				method: 'POST',
				credentials: 'include',
				headers: { accept: 'application/json' },
				body: form,
			})
			if (!response.ok) throw await toError(response)
			const result: MediaUploadResult = await response.json()
			return result
		},
		mediaFileUrl(collection, entry, path) {
			return `${base}${entryPath(collection, entry)}/asset?path=${encodeURIComponent(path)}`
		},
		deleteMedia(id) {
			return mutate<{ success: boolean; error?: string }>(`/media/${encodeURIComponent(id)}`, 'DELETE')
		},
		createFolder(folder) {
			// A JSON body to `POST /media` is the create-folder branch (multipart = upload).
			return mutate<{ success: boolean; error?: string }>('/media', 'POST', { folder })
		},
	}
}
