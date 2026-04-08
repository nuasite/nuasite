/**
 * Slug helpers for mapping page paths to JSON file names.
 *
 * The notes overlay anchors items to page paths like `/inspekce-nemovitosti`,
 * `/blog/post-name`, or `/`. We need a stable filesystem-safe representation
 * of those paths so the JSON store can write one file per page.
 *
 * Rules:
 *   - Leading slash is stripped.
 *   - The root page `/` becomes `index`.
 *   - Trailing slashes are stripped.
 *   - Path separators become double underscores so nested paths stay readable.
 *   - Anything outside `[a-z0-9._-]` is replaced with a single dash.
 */

const SAFE_RE = /[^a-z0-9._-]+/g

export function pageToSlug(page: string): string {
	const trimmed = page.trim().replace(/^\/+|\/+$/g, '')
	if (!trimmed) return 'index'
	return trimmed
		.toLowerCase()
		.split('/')
		.map(seg => seg.replace(SAFE_RE, '-').replace(/^-+|-+$/g, '') || '-')
		.join('__')
}

export function normalizePagePath(page: string): string {
	if (!page) return '/'
	let p = page.trim()
	if (!p.startsWith('/')) p = '/' + p
	// Drop trailing slash except for root
	if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
	return p
}
