/**
 * Storage types for `@nuasite/notes`.
 *
 * One JSON file per page lives at `<notesDir>/pages/<slug>.json` and contains
 * a flat list of items. Each item is either an element-level `comment` or a
 * range-level `suggestion` (Google Docs style strikethrough/insertion diff).
 *
 * Both item types share the same target metadata so the sidebar can render
 * them in a unified list ordered by creation time.
 */

/**
 * Item lifecycle. Notes start as `open`. The agency moves them through the
 * other states.
 *
 *   - `open`     — created, not yet acted on
 *   - `resolved` — agency marked it handled (no source change)
 *   - `applied`  — suggestion was written back to the source file
 *   - `rejected` — agency declined the suggestion
 *   - `stale`    — anchor text drifted; the suggestion can no longer be applied
 *   - `deleted`  — soft-deleted by the agency. Items in this state stay on
 *                  disk so the audit trail is preserved; the client UI hides
 *                  them and the agency UI shows them in a collapsed section.
 *                  A subsequent `purge` call hard-removes the file entry.
 */
export type NoteStatus = 'open' | 'resolved' | 'applied' | 'rejected' | 'stale' | 'deleted'

export type NoteType = 'comment' | 'suggestion'

/**
 * Permission roles. Drives both UI affordances and server-side gating:
 *
 *   - `client` — the reviewer (default). Can create comments and suggestions
 *                and nothing else. Cannot resolve, apply, delete, or purge.
 *                Cannot see deleted items.
 *   - `agency` — the agency owner. Full controls. The role is identified by
 *                the `?nua-agency` URL flag (which sets a sticky cookie) and
 *                a matching `x-nua-role: agency` header on every API call.
 *
 * v0.2 ships role enforcement on a per-instance trust basis: the role flag
 * is unauthenticated and anyone who knows the URL can become "agency".
 * That's intentional for v0.2 — the surface is dev-only and the threat model
 * is "stop a non-technical client from accidentally clicking Apply", not
 * "harden against an adversary". A real auth handshake can come later.
 */
export type NoteRole = 'agency' | 'client'

/**
 * One entry in an item's audit trail. Every mutation appends one of these
 * to `item.history` so the agency can always see what happened to an item,
 * even after a soft delete.
 */
export type NoteHistoryAction = 'created' | 'updated' | 'resolved' | 'reopened' | 'applied' | 'deleted' | 'purged' | 'stale'

export interface NoteHistoryEntry {
	at: string
	action: NoteHistoryAction
	role?: NoteRole
	/** Optional one-line note for context. Currently used by 'applied' to record file path. */
	note?: string
}

/**
 * Range payload for `type: "suggestion"` items.
 *
 * We intentionally store the original substring (`anchorText`) instead of
 * character offsets so the suggestion can survive small edits to surrounding
 * text. On load, the overlay walks text nodes inside the target element
 * looking for `anchorText`. If not found, the suggestion is marked stale.
 */
export interface NoteRange {
	/** Exact substring used as the search anchor when re-attaching on load. */
	anchorText: string
	/** Original text the reviewer wants to replace. Usually equal to anchorText for v0.1. */
	originalText: string
	/** The reviewer's proposed replacement text. */
	suggestedText: string
	/** Optional reasoning the reviewer leaves for the agency. */
	rationale?: string
}

export interface NoteReply {
	id: string
	author: string
	body: string
	createdAt: string
}

/**
 * One note item — either an element comment or a range suggestion.
 *
 * `targetCmsId` is the anchor: it points at a `data-cms-id` element from the
 * `@nuasite/cms` manifest, which knows how to map back to file + line + snippet.
 * The other `target*` fields are denormalized copies of the manifest entry at
 * the time the note was created so the sidebar has something to render even
 * if the source file has drifted.
 */
export interface NoteItem {
	id: string
	type: NoteType

	/** Anchor element from the CMS manifest. */
	targetCmsId: string
	targetSourcePath?: string
	targetSourceLine?: number
	targetSnippet?: string

	/** Only set when type === 'suggestion'. */
	range: NoteRange | null

	body: string
	author: string
	createdAt: string
	updatedAt?: string

	status: NoteStatus
	replies: NoteReply[]

	/**
	 * Audit trail of every mutation that has touched this item, in
	 * chronological order. Always contains at least one entry (`created`).
	 * Items predating this field get an empty array on read; the create
	 * timestamp is preserved separately on `createdAt`.
	 */
	history: NoteHistoryEntry[]
}

/**
 * Shape of one `<notesDir>/pages/<slug>.json` file on disk.
 */
export interface NotesPageFile {
	/** Page path the items are anchored to, e.g. `/inspekce-nemovitosti` or `/`. */
	page: string
	/** ISO timestamp of the most recent mutation. */
	lastUpdated: string
	items: NoteItem[]
}

/**
 * Patch payload for `updateItem`. All fields are optional; only the provided
 * ones are merged onto the existing item.
 */
export interface NoteItemPatch {
	body?: string
	status?: NoteStatus
	range?: NoteRange | null
	targetSnippet?: string
	targetSourcePath?: string
	targetSourceLine?: number
}
