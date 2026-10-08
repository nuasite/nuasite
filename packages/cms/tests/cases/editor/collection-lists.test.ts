import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type ComponentType, h, render } from 'preact'
import { act } from 'preact/test-utils'
import { CollectionsBrowser } from '../../../src/editor/components/collections-browser'
import { CreatePageModal } from '../../../src/editor/components/create-page-modal'
import { Toolbar } from '../../../src/editor/components/toolbar'
import {
	closeCollectionsBrowser,
	config,
	manifest,
	openCollectionsBrowser,
	resetCreatePageState,
	setCreatePageMode,
	setCreatePageOpen,
} from '../../../src/editor/signals'
import type { CollectionDefinition } from '../../../src/editor/types'

// The three places the in-page editor lists collections, rendered and read back from the DOM:
// the collections browser, the toolbar's Content menu and the "New Page" picker. All three
// list by the shared arrangement and the *project's* locale — the page under edit here is
// English on purpose, and the project is Czech.

const collection = (name: string, extra: Partial<CollectionDefinition> = {}): CollectionDefinition => ({
	name,
	label: name,
	path: `src/content/${name}`,
	entryCount: 0,
	fields: [],
	fileExtension: 'md',
	...extra,
})

/** Keyed the way a scan hands them over: in no useful order, a hidden one among them. */
const DEFINITIONS: Record<string, CollectionDefinition> = {
	'news-en': collection('news-en', { label: 'News', group: 'English' }),
	redirects: collection('redirects', { label: 'Redirects', hidden: true }),
	chaty: collection('chaty', { label: 'Chaty' }),
	'faq-items': collection('faq-items', { label: 'Otázky', parentCollection: 'faq' }),
	cukr: collection('cukr', { label: 'Cukr' }),
	faq: collection('faq', { label: 'FAQ', order: 1 }),
	hry: collection('hry', { label: 'Hry' }),
	cisla: collection('cisla', { label: 'Čísla' }),
}
const ALL_HIDDEN: Record<string, CollectionDefinition> = {
	redirects: collection('redirects', { label: 'Redirects', hidden: true }),
	tags: collection('tags', { label: 'Tags', hidden: true }),
}

/** `order` first with its nested collection, then labels as Czech sorts them, then the group. No hidden one. */
const IN_CZECH = ['FAQ', '> Otázky', 'Cukr', 'Čísla', 'Hry', 'Chaty', 'News']

let container: HTMLElement
const initialConfig = config.value
const initialManifest = manifest.value
const initialLang = document.documentElement.lang

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	document.documentElement.lang = 'en'
})

afterEach(() => {
	render(null, container)
	container.remove()
	closeCollectionsBrowser()
	resetCreatePageState()
	config.value = initialConfig
	manifest.value = initialManifest
	document.documentElement.lang = initialLang
})

/** Set what the editor knows of the project: its collections, and its language (`undefined`: none declared). */
function project(collectionDefinitions: Record<string, CollectionDefinition>, locale: string | undefined): void {
	manifest.value = { ...initialManifest, collectionDefinitions }
	config.value = { ...initialConfig, locale }
}

async function mount<P extends object>(component: ComponentType<P>, props: P): Promise<void> {
	await act(() => render(h(component, props), container))
}

describe('CollectionsBrowser', () => {
	/** The list as rendered: `## heading`, `> nested collection`, or a top-level label. */
	const rows = () =>
		[...container.querySelectorAll('.overflow-y-auto > *')].map((element) => {
			if (element.tagName !== 'BUTTON') return `## ${element.textContent}`
			const label = element.querySelector('.font-medium')?.textContent ?? ''
			return element.className.includes('ml-8') ? `> ${label}` : label
		})

	test('lists collections by the shared arrangement, with a heading per group', async () => {
		project(DEFINITIONS, 'cs')
		openCollectionsBrowser()
		await mount(CollectionsBrowser, {})
		expect(rows()).toEqual(['FAQ', '> Otázky', 'Cukr', 'Čísla', 'Hry', 'Chaty', '## English', 'News'])
	})

	test('orders by the project locale, not the language of the page under edit', async () => {
		project(DEFINITIONS, 'cs')
		document.documentElement.lang = 'en'
		openCollectionsBrowser()
		await mount(CollectionsBrowser, {})
		const onEnglishPage = rows()

		document.documentElement.lang = 'cs'
		await mount(CollectionsBrowser, {})
		expect(rows()).toEqual(onEnglishPage)

		// A project with no declared language is compared as English on every page, Czech ones included.
		await act(() => project(DEFINITIONS, undefined))
		expect(rows()).toEqual(['FAQ', '> Otázky', 'Chaty', 'Čísla', 'Cukr', 'Hry', '## English', 'News'])
	})

	test('with every collection hidden it lists nothing, and does not say to add files', async () => {
		project(ALL_HIDDEN, 'cs')
		openCollectionsBrowser()
		await mount(CollectionsBrowser, {})
		expect(rows()).toEqual([])
		expect(container.textContent).toContain('No collections to show here.')
		expect(container.textContent).not.toContain('Add markdown files')
	})

	test('a project with no collections at all keeps the hint', async () => {
		project({}, 'cs')
		openCollectionsBrowser()
		await mount(CollectionsBrowser, {})
		expect(container.textContent).toContain('No content collections found.')
		expect(container.textContent).toContain('Add markdown files')
	})
})

describe('Toolbar — Content menu', () => {
	const callbacks = { onEdit() {}, onCompare() {}, onSave() {}, onDiscard() {}, onOpenCollection() {} }

	/** Open the menu and read the Content section: `> ` marks an indented (nested) collection. */
	async function contentMenu(): Promise<string[]> {
		await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')?.click())
		const header = [...container.querySelectorAll('button')].find(button => button.textContent === 'Content')
		const items = header?.parentElement?.querySelectorAll<HTMLButtonElement>('.overflow-hidden button') ?? []
		return [...items].map(item => `${item.className.includes('pl-16') ? '> ' : ''}${item.textContent}`)
	}

	test('lists collections by the shared arrangement and the project locale', async () => {
		project(DEFINITIONS, 'cs')
		config.value = { ...config.value, features: { collectionManagement: true } }
		await mount(Toolbar, { callbacks, collectionDefinitions: DEFINITIONS })
		expect(await contentMenu()).toEqual(IN_CZECH)
	})
})

describe('CreatePageModal', () => {
	const modeCards = () => [...container.querySelectorAll('button .font-medium')].map(element => element.textContent)

	test('"Collection Entry" is offered when there is a collection to pick', async () => {
		project(DEFINITIONS, 'cs')
		setCreatePageOpen(true)
		await mount(CreatePageModal, {})
		expect(modeCards()).toEqual(['Blank Page', 'Duplicate Page', 'Collection Entry'])
	})

	test('"Collection Entry" is not offered when every collection is hidden', async () => {
		project(ALL_HIDDEN, 'cs')
		setCreatePageOpen(true)
		await mount(CreatePageModal, {})
		expect(modeCards()).toEqual(['Blank Page', 'Duplicate Page'])
	})

	test('the collection picker lists what the browser lists, in the same order', async () => {
		project(DEFINITIONS, 'cs')
		setCreatePageOpen(true)
		setCreatePageMode('collection')
		await mount(CreatePageModal, {})
		// Flat here — the picker draws no nesting — so only the order and the absence of the hidden one.
		expect(modeCards()).toEqual(IN_CZECH.map(row => row.replace('> ', '')))
	})
})
