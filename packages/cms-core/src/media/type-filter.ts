import { filterMediaItems, type MediaItem, type MediaListOptions, type MediaListResult, type MediaTypeFilter } from '@nuasite/cms-types'

/** The value of a `?type=` parameter, or `null` when it names no tab we know. */
export function parseMediaTypeFilter(raw: string | null | undefined): MediaTypeFilter | null {
	if (raw === null || raw === undefined || raw === '') return 'all'
	return raw === 'all' || raw === 'photo' || raw === 'graphic' || raw === 'video' || raw === 'document' ? raw : null
}

/**
 * One page of a cursor-paged listing, filtered to `type`.
 *
 * A filter cannot be pushed into the adapters — they page over a filesystem, a bucket or a remote
 * API, each with its own cursor — so it is applied here, above whichever one answered, by pulling
 * further pages until this one is full. That keeps the cost of a filter inside a single request:
 * without it the client is the one that drains, one round trip per page, and every round trip that
 * reaches the sidecar's project scan makes it re-walk the project.
 *
 * The returned `cursor` is always one the source minted, so following it resumes exactly where the
 * unfiltered listing would have. `hasMore` is the source's too: a filtered page can come back short
 * of `limit` with more still to come, which is what the page cap below leaves behind.
 */
export async function listFilteredMedia(
	list: (options: MediaListOptions) => Promise<MediaListResult>,
	options: MediaListOptions & { type?: MediaTypeFilter },
	/**
	 * How many source pages one filtered page may pull. The bound matters: a "Documents" tab over a
	 * library of photos matches nothing, and without a cap that is a walk of the whole library in a
	 * single request. Reaching it just ends the page early — `hasMore` still says there is more, so
	 * the caller can ask again.
	 */
	maxPages = 20,
): Promise<MediaListResult> {
	const type = options.type ?? 'all'
	if (type === 'all') return await list(options)

	const { limit } = options
	const items: MediaItem[] = []
	let page = await list(options)
	const { folders } = page

	for (let pages = 1;; pages++) {
		items.push(...filterMediaItems(page.items, type))
		const full = limit !== undefined && items.length >= limit
		if (full || !page.hasMore || page.cursor === undefined || pages >= maxPages) {
			return { items, folders, hasMore: page.hasMore, cursor: page.hasMore ? page.cursor : undefined, appliedType: type }
		}
		page = await list({ ...options, cursor: page.cursor })
	}
}
