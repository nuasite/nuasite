/**
 * `MediaLibrary` paging. The gallery used to issue one unpaged `listMedia` call and
 * show whatever the server's default page held, so item 51 was unreachable; these
 * tests pin the paged behaviour and the hazards that come with it — an abandoned
 * folder's response, a cursor that never advances, a filter that would otherwise
 * only see the loaded page.
 *
 * Rendered for real (`react-dom/client` + `act` on happy-dom) rather than to static
 * markup: everything here lives in effects and state.
 */
import type { MediaItem, MediaListResult, MediaUploadResult } from '@nuasite/cms-types'
import { afterEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MediaLibrary, type MediaLibraryProps } from '../src/media-library'
import type { MediaSource } from '../src/media-source'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** The `limit` the gallery is expected to ask for (`PAGE_SIZE`). */
const PAGE_SIZE = 60
/** The bigger `limit` a filter's drain asks for (`DRAIN_PAGE_SIZE`). */
const DRAIN_PAGE_SIZE = 200
/** Mirrors the gallery's `MAX_PAGES` backstop. */
const MAX_PAGES = 200

// ---- fake media source ----

interface ListCall {
	folder?: string
	cursor?: string
	limit?: number
}

function mediaItem(filename: string, contentType = 'image/png'): MediaItem {
	return { id: filename, url: `/uploads/${filename}`, filename, contentType }
}

/** Turn item batches into pages whose cursor is simply the next page's index. */
function paginate(batches: MediaItem[][], folders: MediaListResult['folders'] = []): MediaListResult[] {
	return batches.map((items, i) => {
		const hasMore = i < batches.length - 1
		return { items, folders, hasMore, cursor: hasMore ? String(i + 1) : undefined }
	})
}

/**
 * A `MediaSource` serving pre-baked pages per folder, keyed by the numeric cursor
 * `paginate` hands out. `pending` holds back a page until the test releases it.
 */
function fakeSource(pages: Record<string, MediaListResult[]>, overrides: Partial<MediaSource> = {}) {
	const calls: ListCall[] = []
	const pending: Array<() => void> = []
	const held = new Set<number>()

	const source: MediaSource = {
		listMedia(options = {}) {
			calls.push({ ...options })
			const folder = options.folder ?? ''
			const list = pages[folder] ?? []
			const index = options.cursor === undefined ? 0 : Number.parseInt(options.cursor, 10)
			const page = list[index]
			if (page === undefined) return Promise.reject(new Error(`no page ${index} for folder "${folder}"`))
			if (!held.has(calls.length)) return Promise.resolve(page)
			return new Promise<MediaListResult>(resolve => pending.push(() => resolve(page)))
		},
		uploadMedia: () => Promise.reject(new Error('unused')),
		...overrides,
	}

	return {
		source,
		calls,
		/** Keep the given listing calls (1-based) in flight until `release()`. */
		hold(...ns: number[]) {
			for (const n of ns) held.add(n)
		},
		release() {
			held.clear()
			for (const resolve of pending.splice(0)) resolve()
		},
	}
}

// ---- render harness ----

let active: { root: Root; host: HTMLElement } | null = null

async function mount(props: Omit<MediaLibraryProps, 'onSelect' | 'onClose'> & Partial<MediaLibraryProps>): Promise<HTMLElement> {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	active = { root, host }
	await act(async () => {
		root.render(<MediaLibrary onSelect={() => {}} onClose={() => {}} {...props} />)
	})
	return host
}

async function unmount(): Promise<void> {
	if (active === null) return
	const { root, host } = active
	active = null
	await act(async () => {
		root.unmount()
	})
	host.remove()
}

afterEach(unmount)

/** Let queued promises, renders and the effects they schedule run to a fixed point. */
async function settle(rounds = 20): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		await act(async () => {
			await Promise.resolve()
		})
	}
}

/** Settle until the source stops being called. Bounded, so a runaway loop fails loudly. */
async function settleUntilQuiet(calls: ListCall[], maxRounds = 1000): Promise<void> {
	let seen = -1
	for (let i = 0; i < maxRounds; i++) {
		if (calls.length === seen) return
		seen = calls.length
		await settle(2)
	}
	throw new Error(`the listing never went quiet — ${calls.length} calls and counting`)
}

async function click(el: HTMLElement): Promise<void> {
	await act(async () => {
		el.click()
	})
	await settle()
}

/** Type into a controlled input the way React's value tracker expects. */
async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
	const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
	await act(async () => {
		nativeValue?.set?.call(el, value)
		el.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await settle()
}

// ---- queries ----

const itemIds = (host: HTMLElement) => [...host.querySelectorAll('[data-cms-media-item]')].map(el => el.getAttribute('data-cms-media-item'))
const folderPaths = (host: HTMLElement) => [...host.querySelectorAll('[data-cms-media-folder]')].map(el => el.getAttribute('data-cms-media-folder'))

function buttonLabelled(host: HTMLElement, label: string): HTMLButtonElement | null {
	for (const el of host.querySelectorAll('button')) {
		if (el.textContent?.trim() === label) return el
	}
	return null
}

function loadMore(host: HTMLElement): HTMLButtonElement {
	const button = buttonLabelled(host, 'Load more')
	if (button === null) throw new Error('no "Load more" button')
	return button
}

async function clickLabelled(host: HTMLElement, label: string): Promise<void> {
	const button = buttonLabelled(host, label)
	if (button === null) throw new Error(`no "${label}" button`)
	await click(button)
}

const searchBox = (host: HTMLElement): HTMLInputElement => {
	const input = host.querySelector('input[placeholder="Search files…"]')
	if (!(input instanceof HTMLInputElement)) throw new Error('no search box')
	return input
}

describe('MediaLibrary — paging', () => {
	test('asks for an explicit page, then follows the cursor and appends', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png'), mediaItem('b.png')], [mediaItem('c.png')], [mediaItem('d.png')]]) })
		const host = await mount({ media: fake.source })

		expect(itemIds(host)).toEqual(['a.png', 'b.png'])
		expect(fake.calls[0]).toEqual({ folder: undefined, cursor: undefined, limit: PAGE_SIZE })

		await click(loadMore(host))
		expect(itemIds(host)).toEqual(['a.png', 'b.png', 'c.png'])
		expect(fake.calls[1]).toEqual({ folder: undefined, cursor: '1', limit: PAGE_SIZE })

		await click(loadMore(host))
		expect(itemIds(host)).toEqual(['a.png', 'b.png', 'c.png', 'd.png'])
		expect(buttonLabelled(host, 'Load more')).toBeNull()
		expect(fake.calls).toHaveLength(3)
	})

	test('keeps the folders a later page omits, and merges one it reveals', async () => {
		const fake = fakeSource({
			'': [
				{ items: [mediaItem('a.png')], folders: [{ name: 'photos', path: 'photos' }], hasMore: true, cursor: '1' },
				// The contract says every page carries the list; this one does not.
				{ items: [mediaItem('b.png')], folders: [], hasMore: true, cursor: '2' },
				{ items: [mediaItem('c.png')], folders: [{ name: 'docs', path: 'docs' }], hasMore: false },
			],
		})
		const host = await mount({ media: fake.source })
		expect(folderPaths(host)).toEqual(['photos'])

		await click(loadMore(host))
		expect(folderPaths(host)).toEqual(['photos'])
		expect(itemIds(host)).toEqual(['a.png', 'b.png'])

		await click(loadMore(host))
		expect(folderPaths(host)).toEqual(['docs', 'photos'])
	})

	test('switching folders resets paging', async () => {
		const fake = fakeSource({
			'': paginate([[mediaItem('a.png')], [mediaItem('b.png')]], [{ name: 'photos', path: 'photos' }]),
			photos: paginate([[mediaItem('p1.png')]]),
		})
		const host = await mount({ media: fake.source })
		await click(loadMore(host))
		expect(itemIds(host)).toEqual(['a.png', 'b.png'])

		const folderTile = host.querySelector('[data-cms-media-folder="photos"]')
		if (!(folderTile instanceof HTMLElement)) throw new Error('no folder tile')
		await click(folderTile)

		expect(itemIds(host)).toEqual(['p1.png'])
		expect(fake.calls.at(-1)).toEqual({ folder: 'photos', cursor: undefined, limit: PAGE_SIZE })
		expect(buttonLabelled(host, 'Load more')).toBeNull()

		// Back to the root: page 1 again, not the cursor the root listing left off at.
		await clickLabelled(host, 'root')
		expect(fake.calls.at(-1)).toEqual({ folder: undefined, cursor: undefined, limit: PAGE_SIZE })
		expect(itemIds(host)).toEqual(['a.png'])
	})

	test('drops a page that lands after the user has left the folder', async () => {
		const fake = fakeSource({
			'': paginate([[mediaItem('a.png')], [mediaItem('stale.png')]], [{ name: 'photos', path: 'photos' }]),
			photos: paginate([[mediaItem('p1.png')]]),
		})
		const host = await mount({ media: fake.source })

		// Page 2 of the root goes in flight and stays there.
		fake.hold(2)
		await act(async () => {
			loadMore(host).click()
		})

		const folderTile = host.querySelector('[data-cms-media-folder="photos"]')
		if (!(folderTile instanceof HTMLElement)) throw new Error('no folder tile')
		await click(folderTile)
		expect(itemIds(host)).toEqual(['p1.png'])

		// The abandoned root page finally answers — it must not land in `photos`.
		await act(async () => {
			fake.release()
		})
		await settle()
		expect(itemIds(host)).toEqual(['p1.png'])
	})

	test('double-clicking "Load more" fetches a single page', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')], [mediaItem('b.png')], [mediaItem('c.png')]]) })
		const host = await mount({ media: fake.source })

		const button = loadMore(host)
		await act(async () => {
			button.click()
			button.click()
		})
		await settle()

		expect(fake.calls).toHaveLength(2)
		expect(itemIds(host)).toEqual(['a.png', 'b.png'])
	})

	test('stops instead of looping when the cursor does not advance', async () => {
		// A server bug: every page says "more" and hands back the very same cursor.
		const calls: ListCall[] = []
		const source: MediaSource = {
			listMedia(options = {}) {
				calls.push({ ...options })
				return Promise.resolve({ items: [mediaItem(`x${calls.length}.png`)], folders: [], hasMore: true, cursor: 'same' })
			},
			uploadMedia: () => Promise.reject(new Error('unused')),
		}
		const host = await mount({ media: source })

		// Page 1 advertises more, so the pager shows; page 2 repeats the same cursor.
		await click(loadMore(host))
		expect(calls).toHaveLength(2)
		expect(buttonLabelled(host, 'Load more')).toBeNull()
		expect(host.textContent).toContain('Stopped loading this folder early')

		// A filter would otherwise drain — the stall must hold it too.
		await clickLabelled(host, 'Photos')
		await settle()
		expect(calls).toHaveLength(2)
	})

	test('caps the pages it follows when the server keeps minting fresh cursors', async () => {
		const calls: ListCall[] = []
		const source: MediaSource = {
			listMedia(options = {}) {
				calls.push({ ...options })
				// Empty pages that always promise one more: the worst case for a drain.
				return Promise.resolve({ items: [], folders: [], hasMore: true, cursor: `c${calls.length}` })
			},
			uploadMedia: () => Promise.reject(new Error('unused')),
		}
		const host = await mount({ media: source })

		// A filter drains, and this server would keep the drain going forever.
		await clickLabelled(host, 'Photos')
		await settleUntilQuiet(calls)

		expect(calls).toHaveLength(MAX_PAGES)
		expect(host.textContent).toContain('Stopped loading this folder early')
	})

	test('stops when a page claims more but hands back no cursor', async () => {
		const fake = fakeSource({ '': [{ items: [mediaItem('a.png')], folders: [], hasMore: true }] })
		const host = await mount({ media: fake.source })

		expect(itemIds(host)).toEqual(['a.png'])
		expect(buttonLabelled(host, 'Load more')).toBeNull()
		expect(host.textContent).toContain('Stopped loading this folder early')
		expect(fake.calls).toHaveLength(1)
	})

	test('a page landing after unmount is dropped', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')]]) })
		fake.hold(1)
		const host = await mount({ media: fake.source })

		await unmount()
		await act(async () => {
			fake.release()
		})
		await settle()

		expect(host.textContent).toBe('')
	})

	test('an upload still prepends, and survives the next page', async () => {
		const upload: MediaUploadResult = { success: true, url: '/uploads/new.png', filename: 'new.png', id: 'new.png' }
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')], [mediaItem('b.png')]]) }, { uploadMedia: () => Promise.resolve(upload) })
		const host = await mount({ media: fake.source })

		const fileInput = host.querySelector('input[type="file"]')
		if (!(fileInput instanceof HTMLInputElement)) throw new Error('no file input')
		await act(async () => {
			const transfer = new DataTransfer()
			transfer.items.add(new File(['x'], 'new.png', { type: 'image/png' }))
			fileInput.files = transfer.files
			fileInput.dispatchEvent(new Event('change', { bubbles: true }))
		})
		await settle()
		expect(itemIds(host)).toEqual(['new.png', 'a.png'])

		await click(loadMore(host))
		expect(itemIds(host)).toEqual(['new.png', 'a.png', 'b.png'])
	})

	test('a folder created optimistically is not wiped by the next page', async () => {
		const fake = fakeSource(
			{ '': paginate([[mediaItem('a.png')], [mediaItem('b.png')]], [{ name: 'photos', path: 'photos' }]) },
			{ createFolder: () => Promise.resolve({ success: true }) },
		)
		const host = await mount({ media: fake.source })

		await clickLabelled(host, 'New folder')
		const nameInput = host.querySelector('input[placeholder="Folder name…"]')
		if (!(nameInput instanceof HTMLInputElement)) throw new Error('no folder-name input')
		await typeInto(nameInput, 'archive')
		await clickLabelled(host, 'Create')
		expect(folderPaths(host)).toEqual(['archive', 'photos'])

		await click(loadMore(host))
		expect(folderPaths(host)).toEqual(['archive', 'photos'])
	})

	test('a 501 still degrades to the "not configured" hint', async () => {
		const source: MediaSource = {
			listMedia: () => Promise.reject(Object.assign(new Error('unsupported'), { status: 501 })),
			uploadMedia: () => Promise.reject(new Error('unused')),
		}
		const host = await mount({ media: source })

		expect(host.textContent).toContain('Media uploads are not configured for this project')
		expect(buttonLabelled(host, 'Load more')).toBeNull()
	})
})

describe('MediaLibrary — filtering a paged listing', () => {
	test('a search drains the remaining pages so it cannot miss a later one', async () => {
		const fake = fakeSource({
			'': paginate([[mediaItem('a.png')], [mediaItem('b.png')], [mediaItem('needle.png')]]),
		})
		const host = await mount({ media: fake.source })
		expect(itemIds(host)).toEqual(['a.png'])

		await typeInto(searchBox(host), 'needle')

		expect(fake.calls).toHaveLength(3)
		expect(itemIds(host)).toEqual(['needle.png'])
		expect(buttonLabelled(host, 'Load more')).toBeNull()
	})

	test('the type filter drains too', async () => {
		const fake = fakeSource({
			'': paginate([[mediaItem('a.png')], [mediaItem('spec.pdf', 'application/pdf')]]),
		})
		const host = await mount({ media: fake.source })

		await clickLabelled(host, 'Documents')

		expect(fake.calls).toHaveLength(2)
		expect(itemIds(host)).toEqual(['spec.pdf'])
	})

	test('never says "no matching files" while pages are still coming in', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')], [mediaItem('needle.png')]]) })
		const host = await mount({ media: fake.source })

		fake.hold(2)
		await typeInto(searchBox(host), 'needle')

		// Page 2 is in flight and nothing loaded matches yet.
		expect(itemIds(host)).toEqual([])
		expect(host.textContent).not.toContain('No matching files')
		expect(host.textContent).toContain('Searching')

		await act(async () => {
			fake.release()
		})
		await settle()

		expect(itemIds(host)).toEqual(['needle.png'])
		expect(host.textContent).not.toContain('Searching')
	})

	test('reports "no matching files" once the whole folder is loaded', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')], [mediaItem('b.png')]]) })
		const host = await mount({ media: fake.source })

		await typeInto(searchBox(host), 'nothing-like-this')

		expect(fake.calls).toHaveLength(2)
		expect(itemIds(host)).toEqual([])
		expect(host.textContent).toContain('No matching files')
	})

	test('a filter hides folder tiles but keeps them for when it is cleared', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')]], [{ name: 'photos', path: 'photos' }]) })
		const host = await mount({ media: fake.source })
		expect(folderPaths(host)).toEqual(['photos'])

		await typeInto(searchBox(host), 'a')
		expect(folderPaths(host)).toEqual([])

		await typeInto(searchBox(host), '')
		expect(folderPaths(host)).toEqual(['photos'])
	})

	test('a filtered listing with no matches says so even when the folder tree is not empty', async () => {
		// The empty check used to count `folders`, which a filter hides — so a folder in the tree
		// sent this down the grid branch and rendered an empty one: a few pixels of padding where
		// the panel belongs.
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')]], [{ name: 'photos', path: 'photos' }]) })
		const host = await mount({ media: fake.source })

		await typeInto(searchBox(host), 'nothing-like-this')

		expect(itemIds(host)).toEqual([])
		expect(folderPaths(host)).toEqual([])
		expect(host.textContent).toContain('No matching files')
	})

	test('says it is still searching, rather than showing an empty grid, while a folder tree drains', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')], [mediaItem('b.png')]], [{ name: 'photos', path: 'photos' }]) })
		fake.hold(2)
		const host = await mount({ media: fake.source })

		await typeInto(searchBox(host), 'b.png')
		expect(itemIds(host)).toEqual([])
		expect(host.textContent).toContain('Searching…')

		fake.release()
		await settle()
		expect(itemIds(host)).toEqual(['b.png'])
	})

	test('drains with a bigger page than the one the first paint asks for', async () => {
		const fake = fakeSource({ '': paginate([[mediaItem('a.png')], [mediaItem('b.png')]]) })
		const host = await mount({ media: fake.source })
		expect(fake.calls[0]?.limit).toBe(PAGE_SIZE)

		await clickLabelled(host, 'Photos')

		expect(fake.calls[1]).toEqual({ folder: undefined, cursor: '1', limit: DRAIN_PAGE_SIZE })
	})
})
