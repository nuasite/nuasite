/**
 * Read-only fetchers for `@nuasite/cms`'s public manifest endpoints.
 *
 * The overlay uses the per-page manifest to map a `data-cms-id` element back
 * to its source file + line + snippet at the moment a note is created. We
 * intentionally do NOT pull from the global `/cms-manifest.json` here — the
 * per-page file already contains everything we need and is much smaller.
 */

import type { CmsManifestEntry, CmsPageManifest } from '../types.ts'

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

/** With `locateEntryId`, the CMS first searches the project for that entry's source. */
export async function fetchPageManifest(page: string, locateEntryId?: string): Promise<CmsPageManifest | null> {
	const pageUrl = manifestUrlForPage(page)
	const url = locateEntryId === undefined ? pageUrl : `${pageUrl}?locate=${encodeURIComponent(locateEntryId)}`
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

/**
 * The entry a note on `cmsId` targets. The page load leaves text whose source is not found yet
 * without `sourcePath`; the CMS is then asked to locate it, so the note records the file to edit.
 */
export async function noteTargetEntry(
	manifest: CmsPageManifest | null,
	page: string,
	cmsId: string,
): Promise<{ entry: CmsManifestEntry | undefined; manifest: CmsPageManifest | null }> {
	const entry = manifest?.entries?.[cmsId]
	if (!entry || entry.sourcePath) return { entry, manifest }
	const located = await fetchPageManifest(page, cmsId)
	if (!located) return { entry, manifest }
	return { entry: located.entries?.[cmsId] ?? entry, manifest: located }
}
