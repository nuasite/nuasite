/**
 * Preview-URL resolution for a media value held in an editor widget.
 *
 * A value is whatever the author (or an agent) wrote, and each kind loads from a different
 * place — there is no single origin that serves them all:
 *
 * - `https://cdn.example.com/…`, `//…`, `data:…` — carries its own origin, loads directly.
 * - `/uploads/hero.webp` — a repository file at its *runtime* path. It exists wherever the site
 *   is built, which is not where the editor is served: a host that proxies the project (the
 *   webmaster BFF) answers unknown paths with its own SPA shell, so this renders a broken image
 *   unless it goes through `mediaAssetUrl`.
 * - `../../src/assets/hero.webp` — resolved against the entry's source file, so only the project
 *   can resolve it, and only with the owning entry's slug (`mediaFileUrl`).
 *
 * Both builders are optional on {@link MediaSource}: a host that serves the project from the
 * same origin as the editor needs neither, and for it a root-relative value is already loadable
 * — so that branch falls back to the value itself and such a host behaves exactly as before. An
 * entry-relative value has no such fallback: it resolves against the entry's source directory,
 * never against the editor's own URL, so without a resolver there is nothing to show.
 */
import type { MediaContext, MediaSource } from './media-source'

/** `https://…`, `//…` (protocol-relative) or `data:…` — carries its own origin. */
const SELF_LOADING = /^(https?:)?\/\/|^data:/i

/**
 * The URL to put in `<img src>` for a media value, or `''` when nothing can load it.
 *
 * An entry-relative value is the only kind that needs the owning entry, so it is the only kind
 * without a preview where no entry exists yet (creating a new one).
 */
export function mediaPreviewSrc(media: MediaSource | undefined, value: string, context?: MediaContext): string {
	if (value === '') return ''
	if (SELF_LOADING.test(value)) return value
	if (value.startsWith('/')) return media?.mediaAssetUrl?.(value) ?? value

	const collection = context?.collection
	const entry = context?.entry
	if (collection === undefined || entry === undefined) return ''
	return media?.mediaFileUrl?.(collection, entry, value) ?? ''
}
