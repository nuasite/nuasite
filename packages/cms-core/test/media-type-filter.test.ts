/**
 * `listFilteredMedia` — the server half of `?type=`.
 *
 * The point of it is that the *client* stops draining: a filtered page has to come back full
 * whenever the source still has matches, never fuller than `limit`, and the cursor on it has to
 * resume exactly after the last item it listed, even when that sits halfway through a source page.
 */
import { matchesMediaType, type MediaItem, type MediaListOptions, type MediaListResult } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import {
	decodeFilteredMediaCursor,
	listFilteredMedia,
	MAX_FILTERED_MEDIA_LIMIT,
	MediaCursorError,
	parseMediaTypeFilter,
} from '../src/media/type-filter'

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

	test('hands back a cursor that resumes after the last item it listed', async () => {
		const { list, calls } = source([[photo(1)], [photo(2)], [photo(3)]])

		const first = await listFilteredMedia(list, { limit: 1, type: 'photo' })
		expect(first.items.map(i => i.filename)).toEqual(['p1.jpg'])
		expect(decodeFilteredMediaCursor(first.cursor!)).toEqual({ type: 'photo', source: '1', skip: 0, size: 200 })

		const second = await listFilteredMedia(list, { limit: 1, cursor: first.cursor, type: 'photo' })
		expect(second.items.map(i => i.filename)).toEqual(['p2.jpg'])
		expect(calls.at(-1)?.cursor).toBe('1')
	})

	test('never returns more than limit, and resumes mid source page without losing an item', async () => {
		const { list } = source([[photo(1), doc(1), photo(2)], [photo(3), photo(4), doc(2), photo(5)]])

		const seen: string[] = []
		let cursor: string | undefined
		do {
			const page = await listFilteredMedia(list, { limit: 2, cursor, type: 'photo' })
			expect(page.items.length).toBeLessThanOrEqual(2)
			seen.push(...page.items.map(i => i.filename))
			cursor = page.cursor
		} while (cursor !== undefined)

		expect(seen).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'p5.jpg'])
	})

	test('ends the listing on a full page when nothing after it matches', async () => {
		const { list } = source([[photo(1), photo(2), doc(1)]])

		const page = await listFilteredMedia(list, { limit: 2, type: 'photo' })

		expect(page.items.map(i => i.filename)).toEqual(['p1.jpg', 'p2.jpg'])
		expect(page.hasMore).toBe(false)
		expect(page.cursor).toBeUndefined()
	})

	test('reads the source a large page at a time, whatever the caller asked for', async () => {
		const small = source([[photo(1)]])
		await listFilteredMedia(small.list, { limit: 10, type: 'photo' })
		expect(small.calls[0]?.limit).toBe(200)

		const large = source([[photo(1)]])
		await listFilteredMedia(large.list, { limit: 500, type: 'photo' })
		expect(large.calls[0]?.limit).toBe(500)
	})

	test('refuses a cursor minted under another tab, or not minted here at all', async () => {
		const { list } = source([[photo(1)], [photo(2)]])
		const first = await listFilteredMedia(list, { limit: 1, type: 'photo' })

		await expect(listFilteredMedia(list, { limit: 1, cursor: first.cursor, type: 'graphic' })).rejects.toBeInstanceOf(MediaCursorError)
		await expect(listFilteredMedia(list, { limit: 1, cursor: '1', type: 'photo' })).rejects.toBeInstanceOf(MediaCursorError)
	})

	test('stops at the page cap instead of walking a whole library for one tab', async () => {
		// Nothing matches, so without the cap this would read all 100 pages in one request.
		const { list, calls } = source(Array.from({ length: 100 }, (_, n) => [photo(n)]))

		// Five source pages' worth: each is asked for 200 items.
		const page = await listFilteredMedia(list, { limit: 10, type: 'document' }, 5 * 200)

		expect(calls).toHaveLength(5)
		// Still more to come: the caller can ask again rather than being told the library is empty.
		expect(page.hasMore).toBe(true)
		expect(decodeFilteredMediaCursor(page.cursor!)?.source).toBe('5')
	})

	test('carries the first page folders, which the later ones are not asked to repeat', async () => {
		const { list } = source([[doc(1)], [photo(1)]], [{ name: 'logos', path: 'logos' }])

		const page = await listFilteredMedia(list, { limit: 10, type: 'photo' })

		expect(page.folders).toEqual([{ name: 'logos', path: 'logos' }])
	})
})

describe('listFilteredMedia: work per request', () => {
	/** A cursor spelled the way `listFilteredMedia` spells one, with whatever position a client chose. */
	function forged(position: { source?: string; skip: number; size: number }): string {
		return Buffer.from(JSON.stringify({ fv: 1, type: 'photo', ...position }), 'utf8').toString('base64url')
	}

	/** A source of photos that never runs out, honouring whatever `limit` it is asked for. */
	function endless() {
		const calls: MediaListOptions[] = []
		const list = async (options: MediaListOptions): Promise<MediaListResult> => {
			calls.push(options)
			const start = options.cursor === undefined ? 0 : Number.parseInt(options.cursor, 10)
			const size = Math.min(options.limit ?? 50, 5000)
			const items = Array.from({ length: size }, (_, n) => photo(start + n))
			return { items, folders: [], hasMore: true, cursor: String(start + size) }
		}
		return { list, calls }
	}

	test('holds a huge limit to the same maximum the HTTP layers use', async () => {
		const { list, calls } = endless()

		const page = await listFilteredMedia(list, { limit: 1_000_000, type: 'photo' })

		expect(page.items).toHaveLength(MAX_FILTERED_MEDIA_LIMIT)
		expect(calls.every(c => (c.limit ?? 0) <= MAX_FILTERED_MEDIA_LIMIT)).toBe(true)
	})

	test('bounds the items scanned, not just the pages, whatever the limit', async () => {
		// Nothing matches, so every request runs to the bound.
		for (const limit of [1, 60, 1000, 1_000_000, -5, 0, 2.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			const { list, calls } = endless()
			await listFilteredMedia(list, { limit, type: 'document' })
			const asked = calls.reduce((sum, c) => sum + (c.limit ?? 0), 0)
			expect({ limit, asked: asked <= 4000 }).toEqual({ limit, asked: true })
		}
	})

	test('refuses a cursor whose page size or skip it would never have minted', async () => {
		const { list, calls } = endless()

		for (const position of [{ skip: 0, size: 1_000_000 }, { skip: 0, size: 1 }, { skip: 5000, size: 200 }]) {
			await expect(listFilteredMedia(list, { limit: 10, cursor: forged(position), type: 'photo' })).rejects.toBeInstanceOf(MediaCursorError)
		}
		expect(calls).toHaveLength(0)
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

describe('matchesMediaType', () => {
	test('reads a content type case-insensitively and without its parameters', () => {
		expect(matchesMediaType('Image/SVG+XML', 'graphic')).toBe(true)
		expect(matchesMediaType('image/svg+xml; charset=utf-8', 'graphic')).toBe(true)
		expect(matchesMediaType('image/svg+xml; charset=utf-8', 'photo')).toBe(false)
		expect(matchesMediaType('IMAGE/JPEG', 'photo')).toBe(true)
		expect(matchesMediaType('Application/PDF', 'document')).toBe(true)
		expect(matchesMediaType('VIDEO/MP4', 'video')).toBe(true)
	})

	test('files an icon under graphics whichever of its two registered types it was given', () => {
		for (const type of ['image/x-icon', 'image/vnd.microsoft.icon']) {
			expect(matchesMediaType(type, 'graphic')).toBe(true)
			expect(matchesMediaType(type, 'photo')).toBe(false)
		}
	})
})
