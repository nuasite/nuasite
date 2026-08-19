/**
 * Whole-collection entry loading.
 *
 * `getEntries` is a cursor-paginated endpoint, which is the right shape for a "load more" list
 * but the wrong one for a host that sorts, searches or counts across the whole collection — that
 * host has to exhaust the cursor first. Doing so means knowing the sidecar's page cap and that a
 * `hasMore` page always carries a `cursor`, which is contract knowledge, not UI knowledge, so it
 * belongs here rather than in each host's list component.
 */

import type { CollectionEntryInfo } from '@nuasite/cms-types'
import type { CmsClient } from './client'

/**
 * The sidecar caps a page at 1000 (its `MAX_LIMIT`); asking for exactly that keeps a
 * whole-collection load to a single round trip for all but the largest collections.
 */
const ENTRIES_PAGE_SIZE = 1000

/**
 * Called with each page as it lands, for a UI that wants to be usable before the whole
 * collection has arrived. `more` says whether another page is still coming. Pages are
 * already `cap`-trimmed, so concatenating them yields exactly the final `entries`.
 */
export type LoadAllEntriesOnPage = (entries: CollectionEntryInfo[], more: boolean) => void

export interface LoadAllEntriesResult {
	entries: CollectionEntryInfo[]
	/** True when a `cap` was reached before the collection was exhausted — the entries are truncated. */
	truncated: boolean
}

/**
 * Load every entry of a collection by exhausting the cursor. `fields` is the sparse projection
 * (`'slug,title'`, `'*'`), and drafts are included — a host listing entries to edit wants them.
 *
 * `cap` bounds how many rows are pulled into memory for very large collections; the result's
 * `truncated` flag reports whether more exist beyond it. Omit it to load all.
 *
 * `onPage` streams pages to the caller as they land — the difference between a picker that
 * waits for the whole collection and one that is usable after a single round trip.
 */
export async function loadAllEntries(
	client: Pick<CmsClient, 'getEntries'>,
	collection: string,
	fields: string,
	cap?: number,
	onPage?: LoadAllEntriesOnPage,
): Promise<LoadAllEntriesResult> {
	const rows: CollectionEntryInfo[] = []
	let cursor: string | undefined
	let hasMore = true

	while (hasMore) {
		const result = await client.getEntries(collection, { fields, draft: 'all', limit: ENTRIES_PAGE_SIZE, cursor })
		hasMore = result.hasMore
		// Trim before accumulating, so `onPage` only ever sees rows the caller keeps.
		const room = cap === undefined ? result.entries.length : Math.max(0, cap - rows.length)
		const page = result.entries.length <= room ? result.entries : result.entries.slice(0, room)
		rows.push(...page)

		const capped = cap !== undefined && rows.length >= cap
		onPage?.(page, hasMore && !capped)
		if (capped) return { entries: rows, truncated: hasMore || result.entries.length > page.length }
		if (hasMore) {
			// A page that says there is more but hands back no cursor would loop forever on the
			// same page; fail loudly instead.
			if (result.cursor === undefined) throw new Error('The CMS entries response is missing a pagination cursor.')
			cursor = result.cursor
		}
	}

	return { entries: rows, truncated: false }
}
