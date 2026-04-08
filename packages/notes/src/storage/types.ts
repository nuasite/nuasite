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
 * Item lifecycle. Notes start as `open`. Reviewers (or the agency) move them
 * through the other states. `applied` is reserved for suggestions that have
 * been written back to the source file via the apply flow (Phase 4).
 */
export type NoteStatus = 'open' | 'resolved' | 'applied' | 'rejected' | 'stale'

export type NoteType = 'comment' | 'suggestion'

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
