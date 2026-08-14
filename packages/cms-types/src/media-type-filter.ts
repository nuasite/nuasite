import type { MediaItem, MediaTypeFilter } from './index'

/**
 * `image/*` that a raster pipeline cannot usefully resize — they belong under "graphics", not
 * "photos", which is the distinction the galleries' tabs are actually asking about.
 */
const VECTOR_TYPES = new Set(['image/svg+xml', 'image/x-icon'])

/**
 * Whether a content type belongs in a media tab.
 *
 * What `MediaTypeFilter` and `MediaListResult.appliedType` *mean*, which is why it lives with the
 * contract rather than with either side of it: a server filtering a page and a gallery filtering
 * one it was handed unfiltered have to agree exactly, or the same tab shows different things
 * depending on which of them answered. It used to be a private copy in each gallery.
 */
export function matchesMediaType(contentType: string, filter: MediaTypeFilter): boolean {
	if (filter === 'all') return true
	if (filter === 'photo') return contentType.startsWith('image/') && !VECTOR_TYPES.has(contentType)
	if (filter === 'graphic') return VECTOR_TYPES.has(contentType)
	if (filter === 'video') return contentType.startsWith('video/')
	return contentType === 'application/pdf'
}

export function filterMediaItems<T extends Pick<MediaItem, 'contentType'>>(items: T[], filter: MediaTypeFilter): T[] {
	return filter === 'all' ? items : items.filter(item => matchesMediaType(item.contentType, filter))
}
