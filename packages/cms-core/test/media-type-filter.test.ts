/**
 * `listFilteredMedia` — the server half of `?type=`.
 *
 * The point of it is that the *client* stops draining: a filtered page has to come back full
 * whenever the source still has matches, and the cursor on it has to be one the source minted, so
 * following it resumes the unfiltered listing exactly where this page left it.
 */
import type { MediaItem, MediaListOptions, MediaListResult } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { listFilteredMedia, parseMediaTypeFilter } from '../src/media/type-filter'

function item(filename: string, contentType: string): MediaItem {
	return { id: filename, url: `/uploads/${filename}`, filename, contentType }
}

const photo = (n: number) => item(`p${n}.jpg`, 'image/jpeg')
const doc = (n: number) => item(`d${n}.pdf`, 'application/pdf')

/** A paged source whose cursor is the next page's index, recording what it was asked for. */
function source(pages: MediaItem[][], folders: MediaListResult['folders'] = []) {
	const calls: MediaListOptions[] = []
	const list = async (options: MediaListOptions): Promise<MediaListResult> => {
		calls.push(options)
		const index = options.cursor === undefined ? 0 : Number.parseInt(options.cursor, 10)
		const hasMore = index < pages.length - 1
		return { items: pages[index] ?? [], folders, hasMore, cursor: hasMore ? String(index + 1) : undefined }
	}
	return { list, calls }
}

describe('listFilteredMedia', () => {
	test('passes an unfiltered listing straight through, untouched and unannotated', async () => {
		const { list, calls } = source([[photo(1), doc(1)]])

		const page = await listFilteredMedia(list, { limit: 10, type: 'all' })

		expect(page.items.map(i => i.filename)).toEqual(['p1.jpg', 'd1.pdf'])
		expect(page.appliedType).toBeUndefined()
		expect(calls).toHaveLength(1)
	})

	test('pulls further source pages until the filtered page is full', async () => {
		const { list, calls } = source([[doc(1), photo(1)], [doc(2)], [photo(2), photo(3)]])

		const page = await listFilteredMedia(list, { limit: 3, type: 'photo' })

		expect(page.items.map(i => i.filename)).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg'])
		expect(calls.map(c => c.cursor)).toEqual([undefined, '1', '2'])
	})

	test('says it filtered, so a client knows it has nothing left to do', async () => {
		const { list } = source([[photo(1)]])

		expect((await listFilteredMedia(list, { limit: 10, type: 'photo' })).appliedType).toBe('photo')
	})

	test('ends the page when the source runs out, matches or not', async () => {
		const { list } = source([[photo(1)], [photo(2)]])

		const page = await listFilteredMedia(list, { limit: 50, type: 'document' })

		expect(page.items).toEqual([])
		expect(page.hasMore).toBe(false)
		expect(page.cursor).toBeUndefined()
	})

	test('hands back a cursor the source minted, so the listing resumes where it stopped', async () => {
		const { list, calls } = source([[photo(1)], [photo(2)], [photo(3)]])

		const first = await listFilteredMedia(list, { limit: 1, type: 'photo' })
		expect(first.items.map(i => i.filename)).toEqual(['p1.jpg'])
		expect(first.cursor).toBe('1')

		const second = await listFilteredMedia(list, { limit: 1, cursor: first.cursor, type: 'photo' })
		expect(second.items.map(i => i.filename)).toEqual(['p2.jpg'])
		expect(calls.at(-1)?.cursor).toBe('1')
	})

	test('stops at the page cap instead of walking a whole library for one tab', async () => {
		// Nothing matches, so without the cap this would read all 100 pages in one request.
		const { list, calls } = source(Array.from({ length: 100 }, (_, n) => [photo(n)]))

		const page = await listFilteredMedia(list, { limit: 10, type: 'document' }, 5)

		expect(calls).toHaveLength(5)
		// Still more to come: the caller can ask again rather than being told the library is empty.
		expect(page.hasMore).toBe(true)
		expect(page.cursor).toBe('5')
	})

	test('carries the first page folders, which the later ones are not asked to repeat', async () => {
		const { list } = source([[doc(1)], [photo(1)]], [{ name: 'logos', path: 'logos' }])

		const page = await listFilteredMedia(list, { limit: 10, type: 'photo' })

		expect(page.folders).toEqual([{ name: 'logos', path: 'logos' }])
	})
})

describe('parseMediaTypeFilter', () => {
	test('reads every tab, and treats an absent parameter as no filter', () => {
		expect(parseMediaTypeFilter(null)).toBe('all')
		expect(parseMediaTypeFilter(undefined)).toBe('all')
		expect(parseMediaTypeFilter('')).toBe('all')
		expect(parseMediaTypeFilter('photo')).toBe('photo')
		expect(parseMediaTypeFilter('graphic')).toBe('graphic')
		expect(parseMediaTypeFilter('video')).toBe('video')
		expect(parseMediaTypeFilter('document')).toBe('document')
	})

	test('rejects anything else rather than silently listing everything', () => {
		expect(parseMediaTypeFilter('image')).toBeNull()
		expect(parseMediaTypeFilter('PHOTO')).toBeNull()
	})
})
