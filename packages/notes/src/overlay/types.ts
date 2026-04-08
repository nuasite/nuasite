/**
 * Client-side types used by the Preact overlay.
 *
 * The overlay only knows what comes back from the dev API, so we duplicate
 * the storage types here in their JSON-friendly form (no Date objects, no
 * file handles). Keeping a separate copy lets the overlay bundle ship
 * without pulling in node-only modules through `src/storage`.
 */

export type NoteType = 'comment' | 'suggestion'
export type NoteStatus = 'open' | 'resolved' | 'applied' | 'rejected' | 'stale' | 'deleted'
export type NoteRole = 'agency' | 'client'
export type NoteHistoryAction = 'created' | 'updated' | 'resolved' | 'reopened' | 'applied' | 'deleted' | 'purged' | 'stale'

export interface NoteRange {
	anchorText: string
	originalText: string
	suggestedText: string
	rationale?: string
}

export interface NoteReply {
	id: string
	author: string
	body: string
	createdAt: string
}

export interface NoteHistoryEntry {
	at: string
	action: NoteHistoryAction
	role?: NoteRole
	note?: string
}

export interface NoteItem {
	id: string
	type: NoteType
	targetCmsId: string
	targetSourcePath?: string
	targetSourceLine?: number
	targetSnippet?: string
	range: NoteRange | null
	body: string
	author: string
	createdAt: string
	updatedAt?: string
	status: NoteStatus
	replies: NoteReply[]
	history: NoteHistoryEntry[]
}

export interface NotesPageFile {
	page: string
	lastUpdated: string
	items: NoteItem[]
}

/** Lightweight subset of the CMS manifest entry the overlay needs. */
export interface CmsManifestEntry {
	tag?: string
	text?: string
	sourcePath?: string
	sourceLine?: number
	sourceSnippet?: string
}

export interface CmsPageManifest {
	page: string
	entries?: Record<string, CmsManifestEntry>
}

/** Author info — Phase 2 reads it from localStorage with a default. */
export interface NotesAuthor {
	name: string
}
