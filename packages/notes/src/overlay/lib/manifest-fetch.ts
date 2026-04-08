/**
 * Read-only fetchers for `@nuasite/cms`'s public manifest endpoints.
 *
 * The overlay uses the per-page manifest to map a `data-cms-id` element back
 * to its source file + line + snippet at the moment a note is created. We
 * intentionally do NOT pull from the global `/cms-manifest.json` here — the
 * per-page file already contains everything we need and is much smaller.
 */

import type { CmsPageManifest } from '../types'

/**
 * Build the per-page manifest URL for a page path.
 *   /                       → /index.json
 *   /inspekce-nemovitosti   → /inspekce-nemovitosti.json
 *   /blog/post              → /blog/post.json
 */
export function manifestUrlForPage(page: string): string {
	if (page === '' || page === '/') return '/index.json'
	const trimmed = page.replace(/^\/+|\/+$/g, '')
	return `/${trimmed}.json`
}

export async function fetchPageManifest(page: string): Promise<CmsPageManifest | null> {
	const url = manifestUrlForPage(page)
	try {
		const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
		if (!res.ok) return null
		const data = (await res.json()) as CmsPageManifest
		return data
	} catch (err) {
		console.warn(`[nuasite-notes] Failed to fetch CMS manifest for "${page}":`, err instanceof Error ? err.message : err)
		return null
	}
}
