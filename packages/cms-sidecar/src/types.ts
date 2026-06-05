import type { CollectionDefinition, CollectionEntryInfo } from '@nuasite/cms-types'

/**
 * Wire-level types specific to the `/cms/v1` HTTP contract. The structural model
 * (collections, entries, mutations, pages, redirects, media) is reused 1:1 from
 * `@nuasite/cms-types`; this module only adds the HTTP envelope (errors, the
 * conflict response, the project model and the request body shapes).
 */

// ============================================================================
// Error model
// ============================================================================

/** Stable error codes exposed by the sidecar, each mapped to an HTTP status. */
export type ErrorCode =
	| 'not_found'
	| 'conflict'
	| 'validation'
	| 'parse_error'
	| 'io_error'
	| 'unsupported'
	| 'unauthorized'

/** JSON body returned for every non-2xx response that is not a conflict. */
export interface ApiError {
	error: string
	code: ErrorCode
	sourcePath?: string
}

/** HTTP status for each error code. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
	not_found: 404,
	conflict: 409,
	validation: 400,
	parse_error: 400,
	io_error: 500,
	unsupported: 501,
	unauthorized: 401,
}

/**
 * Returned with `409` when a `PATCH`'s `baseHash` no longer matches the file on
 * disk (an agent or a human wrote in between). Carries the current server
 * version so the client can offer "use server" vs "use ours".
 */
export interface ConflictResponse {
	code: 'conflict'
	serverHash: string
	serverFrontmatter: Record<string, unknown>
	serverBody?: string
}

// ============================================================================
// Request bodies / queries
// ============================================================================

export interface UpdateEntryBody {
	/** Frontmatter keys to merge (not replace) into the entry. */
	frontmatter?: Record<string, unknown>
	body?: string
	/** Hash of the entry source the client edited; `409` on drift. */
	baseHash?: string
}

export interface CreateEntryBody {
	slug: string
	frontmatter: Record<string, unknown>
	body?: string
	/** File extension override for data collections (e.g. 'json', 'yaml'). */
	fileExtension?: string
}

export interface RenameEntryBody {
	to: string
}

export interface AddArrayItemBody {
	field: string
	value: unknown
	index?: number
}

export interface RemoveArrayItemBody {
	field: string
	index: number
}

export interface CreateFolderBody {
	folder: string
}

/** Parsed `GET …/entries` query. */
export interface EntriesQuery {
	/** "slug,title" | "*" ; absent = light header (slug/title/draft/pathname/sourcePath), never the body. */
	fields?: string
	draft: 'true' | 'false' | 'all'
	limit?: number
	cursor?: string
}

// ============================================================================
// Project model
// ============================================================================

export interface Capabilities {
	coreVersion: string
	features: string[]
}

/**
 * A static page route discovered under `src/pages`.
 *
 * cms-core exposes no page-listing capability (only create/duplicate/delete +
 * layouts), and the rich `PageEntry` with an SEO `title` lives in the render
 * manifest, which is render-time and intentionally out of the headless scope.
 * The sidecar therefore derives the list from the `CmsFileSystem` port: a pure
 * `src/pages` walk yielding `pathname` only. `title` is omitted (it would need
 * the manifest). Mirrors the shape of `@nuasite/cms`'s `PageEntry`.
 */
export interface PageEntry {
	/** Page URL pathname (e.g. '/', '/about'). */
	pathname: string
	/** Page title — only populated by the render manifest (out of headless scope). */
	title?: string
}

export interface ProjectModel {
	/** Collection definitions with their `entries[]` info (no full bodies). */
	collections: CollectionDefinition[]
	/** Static page routes discovered under `src/pages` (pathname-only). */
	pages: PageEntry[]
	capabilities: Capabilities
}

/** Sparse list response: the projected entries plus an opaque continuation cursor. */
export interface EntriesListResult {
	entries: CollectionEntryInfo[]
	cursor?: string
	hasMore: boolean
}
