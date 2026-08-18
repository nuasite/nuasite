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
 */
export async function loadAllEntries(
	client: Pick<CmsClient, 'getEntries'>,
	collection: string,
	fields: string,
	cap?: number,
): Promise<LoadAllEntriesResult> {
	const rows: CollectionEntryInfo[] = []
	let cursor: string | undefined
	let hasMore = true

	while (hasMore) {
		const result = await client.getEntries(collection, { fields, draft: 'all', limit: ENTRIES_PAGE_SIZE, cursor })
		rows.push(...result.entries)
		hasMore = result.hasMore
		if (cap !== undefined && rows.length >= cap) return { entries: rows.slice(0, cap), truncated: hasMore || rows.length > cap }
		if (hasMore) {
			// A page that says there is more but hands back no cursor would loop forever on the
			// same page; fail loudly instead.
			if (result.cursor === undefined) throw new Error('The CMS entries response is missing a pagination cursor.')
			cursor = result.cursor
		}
	}

	return { entries: rows, truncated: false }
}
