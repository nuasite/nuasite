/**
 * Public types for `@nuasite/notes`.
 *
 * Phase 0: only the integration options live here. Item types
 * (`NoteItem`, `NoteRange`, `NoteStatus`) and storage types are added
 * in Phase 1 alongside the JSON store.
 */

export interface NuaNotesOptions {
	/**
	 * Master switch. Defaults to `true` in dev, ignored in build.
	 */
	enabled?: boolean

	/**
	 * Directory (relative to project root) where note JSON files are stored,
	 * one file per page at `<notesDir>/pages/<slug>.json`.
	 *
	 * Default: `data/notes`
	 */
	notesDir?: string

	/**
	 * Hide the `@nuasite/cms` editor chrome when notes mode is active
	 * (URL flag `?nua-notes` or cookie `nua-notes-mode=1`).
	 *
	 * When `false`, both UIs may render simultaneously and pointer events
	 * collide. Only set to `false` if you know what you're doing.
	 *
	 * Default: `true`
	 */
	hideCmsInReviewMode?: boolean

	/**
	 * URL query flag that activates notes review mode. Reviewers append
	 * this to any page URL to switch from CMS edit mode to notes review mode.
	 *
	 * Default: `nua-notes`
	 */
	urlFlag?: string

	/**
	 * URL query flag that activates agency mode. When set on a URL it grants
	 * agency permissions (Apply, Resolve, Delete, Purge) and persists a sticky
	 * cookie so subsequent navigation stays in agency mode without re-typing.
	 * Without this flag — and without the cookie — the overlay runs in client
	 * mode and the destructive actions are hidden.
	 *
	 * Default: `nua-agency`
	 */
	agencyFlag?: string

	/**
	 * Forward `/_nua/notes/*` requests through this proxy target. Mirrors the
	 * pattern used by `@nuasite/cms` for sandbox/hosted dev. The target backend
	 * must implement the matching `/notes/*` endpoints.
	 *
	 * Example: `http://localhost:8787`
	 */
	proxy?: string
}
