import {
	matchesMediaType,
	type MediaFolderItem,
	type MediaItem,
	type MediaListOptions,
	type MediaListResult,
	type MediaTypeFilter,
} from '@nuasite/cms-types'

/** The value of a `?type=` parameter, or `null` when it names no tab we know. */
export function parseMediaTypeFilter(raw: string | null | undefined): MediaTypeFilter | null {
	if (raw === null || raw === undefined || raw === '') return 'all'
	return raw === 'all' || raw === 'photo' || raw === 'graphic' || raw === 'video' || raw === 'document' ? raw : null
}

/**
 * A cursor `listFilteredMedia` refused: not one it minted, or minted under a different tab. A host
 * answers it with a 400 and the message, never by listing from the start.
 */
export class MediaCursorError extends Error {
	override name = 'MediaCursorError'
}

export const MEDIA_INVALID_CURSOR = 'Invalid media cursor'
export const MEDIA_CURSOR_TYPE_MISMATCH =
	'This cursor continues a listing filtered by a different ?type=. Start the listing again when the filter changes'

/**
 * Where a filtered listing continues: the source page that `source` (the source's own cursor,
 * absent for its first page) fetches at `size` items, from its `skip`-th item on. A filtered page
 * that fills up halfway through a source page ends there, and this is how the next one starts at
 * the item after, rather than at the next source page with the rest of this one lost.
 */
interface FilteredPosition {
	source: string | undefined
	skip: number
	size: number
}

const FILTERED_CURSOR_VERSION = 1

function toBase64Url(text: string): string {
	let binary = ''
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(raw: string): string {
	const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
	return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

function encodeFilteredCursor(position: FilteredPosition, type: MediaTypeFilter): string {
	const { source, skip, size } = position
	return toBase64Url(JSON.stringify({ fv: FILTERED_CURSOR_VERSION, type, source, skip, size }))
}

/**
 * The tab and position a filtered cursor carries, or `null` when `raw` is not one `listFilteredMedia`
 * minted. A host that also serves unfiltered listings uses it to refuse one followed without its
 * `?type=`, which the adapter would otherwise read as its own cursor.
 */
export function decodeFilteredMediaCursor(raw: string): (FilteredPosition & { type: MediaTypeFilter }) | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(fromBase64Url(raw))
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null || !('fv' in parsed) || parsed.fv !== FILTERED_CURSOR_VERSION) return null
	const type = 'type' in parsed && typeof parsed.type === 'string' ? parseMediaTypeFilter(parsed.type) : null
	if (type === null || type === 'all') return null
	const source = 'source' in parsed ? parsed.source : undefined
	if (source !== undefined && typeof source !== 'string') return null
	const skip = 'skip' in parsed ? parsed.skip : undefined
	const size = 'size' in parsed ? parsed.size : undefined
	if (typeof skip !== 'number' || !Number.isSafeInteger(skip) || skip < 0) return null
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) return null
	return { type, source, skip, size }
}

/**
 * The smallest source page a filtered listing reads. A tab that matches one item in ten would
 * otherwise spend a source round trip per handful of matches, and against the local adapter each
 * round trip re-reads the whole folder.
 */
const MIN_SOURCE_PAGE = 200

/**
 * One page of a cursor-paged listing, filtered to `type`.
 *
 * A filter cannot be pushed into the adapters: they page over a filesystem, a bucket or a remote
 * API, each with its own cursor. So it is applied here, above whichever one answered, by pulling
 * further pages until this one is full. That keeps the cost of a filter inside a single request:
 * without it the client is the one that drains, one round trip per page, and every round trip that
 * reaches the sidecar's project scan makes it re-walk the project.
 *
 * A filtered page holds at most `limit` items. The source is read at `max(limit, 200)` items a
 * page, so a page usually fills halfway through a source page; the cursor it hands back is one of
 * ours, bound to `type`, and resumes by re-reading that source page and skipping what was already
 * listed. That relies on a source answering the same cursor and size with the same page, which an
 * offset or continuation-token listing does as long as nothing is written in between: the same
 * caveat any offset pager carries. An unfiltered listing is passed straight through, the source's
 * own cursor included.
 *
 * A cursor this did not mint, or minted under another tab, throws `MediaCursorError`.
 * `hasMore` can be true on a page short of `limit`: that is what the page cap below leaves behind.
 */
export async function listFilteredMedia(
	list: (options: MediaListOptions) => Promise<MediaListResult>,
	options: MediaListOptions & { type?: MediaTypeFilter },
	/**
	 * How many source pages one filtered page may pull. The bound matters: a "Documents" tab over a
	 * library of photos matches nothing, and without a cap that is a walk of the whole library in a
	 * single request. Reaching it just ends the page early. `hasMore` still says there is more, so
	 * the caller can ask again.
	 */
	maxPages = 20,
): Promise<MediaListResult> {
	const type = options.type ?? 'all'
	if (type === 'all') return await list(options)

	const { limit } = options
	let position: FilteredPosition = { source: undefined, skip: 0, size: Math.max(limit ?? 0, MIN_SOURCE_PAGE) }
	if (options.cursor !== undefined) {
		const decoded = decodeFilteredMediaCursor(options.cursor)
		if (decoded === null) throw new MediaCursorError(MEDIA_INVALID_CURSOR)
		if (decoded.type !== type) throw new MediaCursorError(MEDIA_CURSOR_TYPE_MISMATCH)
		position = decoded
	}

	const items: MediaItem[] = []
	let folders: MediaFolderItem[] | undefined
	const done = (hasMore: boolean, next: FilteredPosition | undefined): MediaListResult => ({
		items,
		folders: folders ?? [],
		hasMore,
		cursor: next === undefined ? undefined : encodeFilteredCursor(next, type),
		appliedType: type,
	})

	for (let pages = 1;; pages++) {
		const page = await list({ ...options, cursor: position.source, limit: position.size })
		folders ??= page.folders
		const pageItems = page.items
		for (let index = position.skip; index < pageItems.length; index++) {
			const item = pageItems[index]
			if (item === undefined || !matchesMediaType(item.contentType, type)) continue
			items.push(item)
			if (limit === undefined || items.length < limit) continue
			// Full. Stop at this item when the source page still holds a match after it; otherwise
			// the page is spent and the listing continues the way the source does.
			const matchesLeft = pageItems.slice(index + 1).some(later => matchesMediaType(later.contentType, type))
			if (matchesLeft) return done(true, { ...position, skip: index + 1 })
			break
		}
		const next = page.hasMore && page.cursor !== undefined ? { source: page.cursor, skip: 0, size: position.size } : undefined
		const full = limit !== undefined && items.length >= limit
		// An adapter that reports more but hands back no cursor cannot be advanced: say there is more
		// anyway, with no cursor, rather than claim the listing ended.
		if (full || next === undefined || pages >= maxPages) return done(page.hasMore, next)
		position = next
	}
}
