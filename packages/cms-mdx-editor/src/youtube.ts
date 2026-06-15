/** YouTube video ids are always 11 chars from this alphabet. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Path-based forms: youtu.be/<id>, youtube.com/embed/<id>, youtube.com/shorts/<id>, youtube.com/v/<id>. */
const PATH_FORM_RE = /(?:youtu\.be\/|\/(?:embed|shorts|v)\/)([A-Za-z0-9_-]{11})/

/**
 * Extract the 11-char video id from a YouTube URL or a bare id.
 * Returns null when no id can be found, so callers can reject bad input
 * instead of emitting a broken `:::youtube{…}` directive.
 */
export function extractYoutubeId(input: string): string | null {
	const value = input.trim()
	if (!value) return null

	// Bare id.
	if (VIDEO_ID_RE.test(value)) return value

	// watch?v=<id> (and any other `v` query param).
	const queryMatch = /[?&]v=([A-Za-z0-9_-]{11})/.exec(value)
	if (queryMatch) return queryMatch[1] ?? null

	const pathMatch = PATH_FORM_RE.exec(value)
	if (pathMatch) return pathMatch[1] ?? null

	return null
}
