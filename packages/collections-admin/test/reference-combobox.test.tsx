import type { CmsClient, CmsEntriesListResult, GetEntriesOptions } from '@nuasite/cms-client'
import type { FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { type EditorContext, FieldEditor } from '../src/field-editor'

// React's act() refuses to run unless the environment opts in.
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnv.IS_REACT_ACT_ENVIRONMENT = true

// The widget caches loaded options per collection name, so every test gets its own.
let collectionSeq = 0
function refField(collection: string): FieldDefinition {
	return { name: 'author', type: 'reference', required: false, collection }
}

/** A client that serves `total` entries in fixed-size pages behind an offset cursor. */
function pagingClient(total: number, pageSize: number, seen: GetEntriesOptions[] = []): CmsClient {
	return {
		getEntries: (_collection: string, options: GetEntriesOptions = {}): Promise<CmsEntriesListResult> => {
			seen.push(options)
			const offset = options.cursor === undefined ? 0 : Number(options.cursor)
			const slice = Array.from({ length: total }, (_, i) => ({
				slug: `author-${i}`,
				title: `Author ${i}`,
				sourcePath: `src/content/authors/author-${i}.md`,
			})).slice(offset, offset + pageSize)
			const hasMore = offset + pageSize < total
			return Promise.resolve({ entries: slice, hasMore, ...(hasMore ? { cursor: String(offset + pageSize) } : {}) })
		},
	} as unknown as CmsClient
}

interface PagedEntry {
	slug: string
	title: string
	sourcePath: string
}

function entriesFrom(slugs: string[]): PagedEntry[] {
	return slugs.map(slug => ({ slug, title: slug.replace(/-/g, ' '), sourcePath: `src/content/authors/${slug}.md` }))
}

/**
 * A client whose pages land only when the test releases them, so the widget can be
 * observed mid-load.
 */
function gatedClient(pages: string[][], seen: GetEntriesOptions[] = []) {
	const gates: Array<(fail?: boolean) => void> = []
	let served = 0
	const client = {
		getEntries: (_collection: string, options: GetEntriesOptions = {}): Promise<CmsEntriesListResult> => {
			seen.push(options)
			const index = served++
			const last = index === pages.length - 1
			return new Promise<CmsEntriesListResult>((resolve, reject) => {
				gates.push(fail =>
					fail ? reject(new Error('page failed')) : resolve({
						entries: entriesFrom(pages[index] ?? []),
						hasMore: !last,
						...(last ? {} : { cursor: String(index + 1) }),
					})
				)
			})
		},
	} as unknown as CmsClient
	/** Land (or fail) the oldest pending page and let React flush. */
	const release = async (fail = false) => {
		const gate = gates.shift()
		await act(async () => {
			gate?.(fail)
		})
	}
	return { client, release }
}

/**
 * React caches the last value it wrote to an input and ignores an `input` event
 * that does not move it, so drive the change through the prototype setter.
 */
function setInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
	if (setter) setter.call(input, value)
	else input.value = value
}

async function mount(
	client: CmsClient,
	value: string,
	onChange: (v: unknown) => void = () => {},
	widgets = 1,
	collection?: string,
) {
	const container = document.createElement('div')
	document.body.appendChild(container)
	const root = createRoot(container)
	const target = collection ?? `authors-${++collectionSeq}`
	const ctx: EditorContext = { client, collection: 'blog', slug: 'hello' }
	await act(async () => {
		root.render(
			Array.from({ length: widgets }, (_, i) => createElement(FieldEditor, { key: i, field: refField(target), value, onChange, ctx })),
		)
	})
	return {
		container,
		target,
		input: () => container.querySelector('input') as HTMLInputElement,
		options: () => [...container.querySelectorAll('[role="option"]')].map(el => el.textContent ?? ''),
		async type(text: string) {
			const input = container.querySelector('input') as HTMLInputElement
			await act(async () => {
				input.focus()
				setInputValue(input, text)
				input.dispatchEvent(new Event('input', { bubbles: true }))
			})
		},
		/** Focus the input, as a user tabbing or clicking into an unfocused field would. */
		async open() {
			const input = container.querySelector('input') as HTMLInputElement
			await act(async () => {
				input.focus()
				input.dispatchEvent(new FocusEvent('focus', { bubbles: false }))
			})
		},
		/** Click the input while it already holds focus — no focus event fires. */
		async clickInput() {
			const input = container.querySelector('input') as HTMLInputElement
			await act(async () => {
				input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
			})
		},
		activeRow: () => container.querySelector('[data-active="true"]')?.textContent ?? null,
		async press(key: string) {
			const input = container.querySelector('input') as HTMLInputElement
			await act(async () => {
				input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
			})
		},
		cleanup() {
			act(() => root.unmount())
			container.remove()
		},
	}
}

describe('reference combobox', () => {
	test('follows the cursor so entries past the first page are selectable', async () => {
		const seen: GetEntriesOptions[] = []
		const ui = await mount(pagingClient(450, 200, seen), '')
		// Three requests: offsets 0, 200, 400 — one page would have hidden 250 entries.
		expect(seen.length).toBe(3)
		expect(seen.map(o => o.cursor)).toEqual([undefined, '200', '400'])

		await ui.type('author-449')
		expect(ui.options()).toEqual(['Author 449author-449'])
		ui.cleanup()
	})

	test('typing filters on title and slug; Enter commits the highlighted entry', async () => {
		let committed: unknown
		const ui = await mount(pagingClient(30, 500), '', value => {
			committed = value
		})
		await ui.type('author 7')
		// Substring matches ride along, but the slug-prefix hit ranks first.
		expect(ui.options()).toEqual(['Author 7author-7', 'Author 17author-17', 'Author 27author-27'])
		await ui.press('Enter')
		expect(committed).toBe('author-7')
		ui.cleanup()
	})

	test('a non-matching query says so instead of offering a wrong entry', async () => {
		const ui = await mount(pagingClient(5, 500), '')
		await ui.type('nobody')
		expect(ui.options()).toEqual([])
		expect(ui.container.textContent).toContain('No entry matches')
		ui.cleanup()
	})

	test('a closed combobox shows the selected entry title, not the raw slug', async () => {
		const ui = await mount(pagingClient(5, 500), 'author-3')
		expect(ui.input().value).toBe('Author 3')
		ui.cleanup()
	})

	test('a value the collection no longer has is kept and flagged', async () => {
		const ui = await mount(pagingClient(5, 500), 'ghost')
		expect(ui.input().value).toBe('ghost')
		expect(ui.container.textContent).toContain(`is not an entry of ${ui.target}`)
		ui.cleanup()
	})

	test('the picker is usable after the first page, while the rest still loads', async () => {
		const { client, release } = gatedClient([['ada-lovelace', 'alan-turing'], ['grace-hopper']])
		const ui = await mount(client, '')
		// Nothing has landed yet — one round trip is all the user waits for.
		expect(ui.container.textContent).toContain('Loading authors')
		expect(ui.container.querySelector('input')).toBe(null)

		await release()
		await ui.type('ada')
		expect(ui.options()).toEqual(['ada lovelaceada-lovelace'])
		// The still-open list says more is coming rather than pretending it is complete.
		await ui.type('')
		expect(ui.container.textContent).toContain('Loading more entries…')

		await release()
		await ui.type('grace')
		expect(ui.options()).toEqual(['grace hoppergrace-hopper'])
		expect(ui.container.textContent).not.toContain('Loading more entries…')
		ui.cleanup()
	})

	test('an unfinished page never reports "no match"', async () => {
		const { client, release } = gatedClient([['ada-lovelace'], ['grace-hopper']])
		const ui = await mount(client, '')
		await release()
		await ui.type('grace')
		// Page two has not landed; claiming no match would be a lie.
		expect(ui.container.textContent).not.toContain('No entry matches')
		await release()
		expect(ui.options()).toEqual(['grace hoppergrace-hopper'])
		ui.cleanup()
	})

	test('sibling pickers on one collection share a single load', async () => {
		const seen: GetEntriesOptions[] = []
		const ui = await mount(pagingClient(30, 500, seen), '', () => {}, 5)
		// Five reference widgets (an array of references), one request — not five.
		expect(seen.length).toBe(1)
		expect(ui.container.querySelectorAll('input').length).toBe(5)
		ui.cleanup()
	})

	test('a page that fails mid-load keeps the pages that already landed', async () => {
		const { client, release } = gatedClient([['ada-lovelace'], ['grace-hopper']])
		const ui = await mount(client, '')
		await release()
		await release(true)
		// The combobox survives with page one; it must not collapse to a raw text box.
		await ui.type('ada')
		expect(ui.options()).toEqual(['ada lovelaceada-lovelace'])
		expect(ui.container.textContent).not.toContain('Loading more entries…')
		ui.cleanup()
	})

	test('a cold load that fails outright falls back to free text', async () => {
		const { client, release } = gatedClient([['ada-lovelace']])
		const ui = await mount(client, 'ada-lovelace')
		await release(true)
		expect(ui.container.querySelector('[role="combobox"]')).toBe(null)
		expect(ui.input().value).toBe('ada-lovelace')
		ui.cleanup()
	})

	test('a page claiming more without a cursor keeps what landed and says it is partial', async () => {
		const client = {
			getEntries: (): Promise<CmsEntriesListResult> => Promise.resolve({ entries: entriesFrom(['ada-lovelace']), hasMore: true }),
		} as unknown as CmsClient
		const ui = await mount(client, '')
		// Paging on would loop forever on the same page; presenting the one page as the whole
		// collection would be the silent truncation this widget exists to fix.
		expect(ui.container.textContent).toContain('Showing the first 1 entry of')
		await ui.type('ada')
		expect(ui.options()).toEqual(['ada lovelaceada-lovelace'])
		ui.cleanup()
	})

	test('a selection past the visible slice is highlighted and re-committable', async () => {
		let committed: unknown
		const ui = await mount(pagingClient(500, 500), 'author-300', value => {
			committed = value
		})
		expect(ui.input().value).toBe('Author 300')
		await ui.open()
		// The list renders 100 rows; entry 300 leads it rather than being highlighted off-screen.
		expect(ui.options()[0]).toBe('Author 300author-300')
		expect(ui.activeRow()).toBe('Author 300author-300')
		await ui.press('Enter')
		expect(committed).toBe('author-300')
		ui.cleanup()
	})

	test('a value on a page that has not landed yet is not called missing', async () => {
		const { client, release } = gatedClient([['ada-lovelace'], ['grace-hopper']])
		const ui = await mount(client, 'grace-hopper')
		await release()
		expect(ui.container.textContent).not.toContain('is not an entry of')
		await release()
		expect(ui.input().value).toBe('grace hopper')
		expect(ui.container.textContent).not.toContain('is not an entry of')
		ui.cleanup()
	})

	test('the list reopens on a click, with the input already focused', async () => {
		const ui = await mount(pagingClient(3, 500), '')
		await ui.open()
		await ui.press('Enter')
		expect(ui.options()).toEqual([])
		// Committing leaves focus on the input, so no focus event will fire again.
		await ui.clickInput()
		expect(ui.options().length).toBe(3)
		ui.cleanup()
	})

	test('a picker mounting after the last one unmounted reloads, so new entries appear', async () => {
		const seen: GetEntriesOptions[] = []
		const client = pagingClient(3, 500, seen)
		const first = await mount(client, '', () => {}, 1, 'authors-shared')
		expect(seen.length).toBe(1)
		first.cleanup()

		const second = await mount(client, '', () => {}, 1, 'authors-shared')
		expect(seen.length).toBe(2)
		second.cleanup()
	})
})
