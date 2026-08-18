import type { CollectionEntryInfo } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import type { CmsClient, CmsEntriesListResult, GetEntriesOptions } from '../src/client'
import { loadAllEntries } from '../src/entries'

const row = (slug: string): CollectionEntryInfo => ({ slug, sourcePath: `src/content/articles/${slug}.md` })

/** A lister answering from a scripted page queue, recording the options it was asked with. */
function lister(pages: CmsEntriesListResult[]): Pick<CmsClient, 'getEntries'> & { calls: GetEntriesOptions[] } {
	const calls: GetEntriesOptions[] = []
	let i = 0
	return {
		calls,
		getEntries: (_collection, options = {}) => {
			calls.push(options)
			const page = pages[i++]
			if (!page) throw new Error(`Unexpected page request #${i}`)
			return Promise.resolve(page)
		},
	}
}

describe('loadAllEntries', () => {
	test('a single page ends in one round trip', async () => {
		const client = lister([{ entries: [row('a'), row('b')], hasMore: false }])
		const result = await loadAllEntries(client, 'articles', 'slug,title')

		expect(result.entries.map(e => e.slug)).toEqual(['a', 'b'])
		expect(result.truncated).toBe(false)
		expect(client.calls).toEqual([{ fields: 'slug,title', draft: 'all', limit: 1000, cursor: undefined }])
	})

	test('exhausts the cursor, carrying each page cursor into the next request', async () => {
		const client = lister([
			{ entries: [row('a')], hasMore: true, cursor: 'c1' },
			{ entries: [row('b')], hasMore: true, cursor: 'c2' },
			{ entries: [row('c')], hasMore: false },
		])
		const result = await loadAllEntries(client, 'articles', '*')

		expect(result.entries.map(e => e.slug)).toEqual(['a', 'b', 'c'])
		expect(result.truncated).toBe(false)
		expect(client.calls.map(c => c.cursor)).toEqual([undefined, 'c1', 'c2'])
	})

	test('drafts are included — a host listing entries to edit wants them', async () => {
		const client = lister([{ entries: [], hasMore: false }])
		await loadAllEntries(client, 'articles', 'slug')

		expect(client.calls[0]?.draft).toBe('all')
	})

	test('a cap truncates and says so, without asking for another page', async () => {
		const client = lister([{ entries: [row('a'), row('b'), row('c')], hasMore: true, cursor: 'c1' }])
		const result = await loadAllEntries(client, 'articles', 'slug', 2)

		expect(result.entries.map(e => e.slug)).toEqual(['a', 'b'])
		expect(result.truncated).toBe(true)
		expect(client.calls).toHaveLength(1)
	})

	test('a cap the collection does not reach reports nothing truncated', async () => {
		const client = lister([{ entries: [row('a')], hasMore: false }])
		const result = await loadAllEntries(client, 'articles', 'slug', 10)

		expect(result.entries).toHaveLength(1)
		expect(result.truncated).toBe(false)
	})

	test('a page claiming more but handing back no cursor fails loudly instead of looping', async () => {
		const client = lister([{ entries: [row('a')], hasMore: true }])

		await expect(loadAllEntries(client, 'articles', 'slug')).rejects.toThrow(/missing a pagination cursor/)
	})
})
