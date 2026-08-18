/**
 * Preview-URL resolution for `image`/`file` field values.
 *
 * A field holds whatever the author (or the agent) wrote, and each kind of value loads from a
 * different place — there is no single origin that serves them all:
 *
 * - `https://cdn.nuasite.com/…` — an offloaded asset, loads straight from the CDN.
 * - `data:…` — an inline payload, loads itself.
 * - `/uploads/hero.webp` — a repository file at its runtime path. Only the sidecar can be relied
 *   on to serve it: a host that also serves the project's `public/` on its own origin (the local
 *   studio) would resolve it either way, but a hosted panel answers unknown paths with its own
 *   SPA shell and would render a broken image.
 * - `../../src/assets/hero.webp` — an Astro `image()` value, resolved against the entry source.
 *   Only the sidecar can resolve it, and only with the owning entry's slug.
 *
 * Which bucket a value falls in is a property of the CMS's own value format, so every picker,
 * thumbnail and preview should classify it the same way.
 */

import type { CmsClient } from './client'

/** The asset URL builders of {@link CmsClient}, narrowed so a preview stays testable without one. */
export type MediaUrlBuilder = Pick<CmsClient, 'mediaFileUrl' | 'mediaAssetUrl'>

/** `https://…`, `//…` (protocol-relative) or `data:…` — carries its own origin. */
const SELF_LOADING = /^(https?:)?\/\/|^data:/i

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(\?|#|$)/i

/**
 * The URL to put in `<img src>` for a field value, or `''` when nothing can load it.
 *
 * Entry-relative values are the only ones that need the owning entry, so they are the only ones
 * without a preview in create mode (no slug exists yet); a root-relative value previews there too.
 */
export function mediaPreviewSrc(client: MediaUrlBuilder, value: string, collection: string, entry: string | undefined): string {
	if (value === '') return ''
	if (SELF_LOADING.test(value)) return value
	if (value.startsWith('/')) return client.mediaAssetUrl(value)
	if (entry === undefined) return ''
	return client.mediaFileUrl(collection, entry, value)
}

/** Whether the value looks like an image, so a `file` field does not render a broken thumbnail. */
export function looksLikeImage(value: string): boolean {
	return value.startsWith('data:image/') || IMAGE_EXTENSION.test(value)
}
