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
	// The cursor travels through the client, so its size is held to what this module would mint:
	// otherwise a forged one asks the source for any number of items, past every `limit` clamp.
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < MIN_SOURCE_PAGE || size > MAX_FILTERED_MEDIA_LIMIT) return null
	if (skip > size) return null
	return { type, source, skip, size }
}

/**
 * The smallest source page a filtered listing reads. A tab that matches one item in ten would
 * otherwise spend a source round trip per handful of matches, and against the local adapter each
 * round trip re-reads the whole folder.
 */
const MIN_SOURCE_PAGE = 200

/**
 * The largest filtered page, and so the largest source page. The same bound both HTTP layers put on
 * an unfiltered `limit`, applied here again so a caller that forgets to clamp cannot widen the scan.
 */
export const MAX_FILTERED_MEDIA_LIMIT = 1000

/**
 * Source items one filtered page may ask for, all pages together: twenty pages at the smallest
 * source page. A "Documents" tab over a library of photos matches nothing, and without a bound
 * that is a walk of the whole library in a single request.
 */
const MAX_SCANNED = 20 * MIN_SOURCE_PAGE

/** `limit` held to `[1, MAX_FILTERED_MEDIA_LIMIT]`; one that is not a finite number sets no target. */
function clampLimit(limit: number | undefined): number | undefined {
	if (limit === undefined || !Number.isFinite(limit)) return undefined
	return Math.min(Math.max(Math.floor(limit), 1), MAX_FILTERED_MEDIA_LIMIT)
}

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
 * `hasMore` can be true on a page short of `limit`: that is what the scan bound below leaves behind.
 */
export async function listFilteredMedia(
	list: (options: MediaListOptions) => Promise<MediaListResult>,
	options: MediaListOptions & { type?: MediaTypeFilter },
	/**
	 * How many source items one filtered page may ask for, counted as the larger of what each source
	 * page was asked for and what it returned. Reaching it just ends the page early. `hasMore` still
	 * says there is more, so the caller can ask again. The first source page is always read.
	 */
	maxScanned = MAX_SCANNED,
): Promise<MediaListResult> {
	const type = options.type ?? 'all'
	if (type === 'all') return await list(options)

	const limit = clampLimit(options.limit)
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

	for (let scanned = 0;;) {
		const page = await list({ ...options, cursor: position.source, limit: position.size })
		folders ??= page.folders
		const pageItems = page.items
		scanned += Math.max(position.size, pageItems.length)
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
		if (full || next === undefined || scanned >= maxScanned) return done(page.hasMore, next)
		position = next
	}
}
