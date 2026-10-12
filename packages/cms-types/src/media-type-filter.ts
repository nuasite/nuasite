import type { MediaItem, MediaTypeFilter } from './index'

/**
 * `image/*` that a raster pipeline cannot usefully resize — they belong under "graphics", not
 * "photos", which is the distinction the galleries' tabs are actually asking about.
 */
const VECTOR_TYPES = new Set(['image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])

/**
 * A content type as it is compared: lowercased and without parameters. An adapter that reports what
 * the uploading browser or a remote store said can hand back `Image/SVG+XML` or
 * `image/svg+xml; charset=utf-8`, and either still names the same tab.
 */
function essence(contentType: string): string {
	const semicolon = contentType.indexOf(';')
	return (semicolon === -1 ? contentType : contentType.slice(0, semicolon)).trim().toLowerCase()
}

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
	const type = essence(contentType)
	if (filter === 'photo') return type.startsWith('image/') && !VECTOR_TYPES.has(type)
	if (filter === 'graphic') return VECTOR_TYPES.has(type)
	if (filter === 'video') return type.startsWith('video/')
	return type === 'application/pdf'
}

export function filterMediaItems<T extends Pick<MediaItem, 'contentType'>>(items: T[], filter: MediaTypeFilter): T[] {
	return filter === 'all' ? items : items.filter(item => matchesMediaType(item.contentType, filter))
}
