import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type ComponentType, h, render } from 'preact'
import { act } from 'preact/test-utils'
import { BgImageOverlay } from '../../../src/editor/components/bg-image-overlay'
import { CreatePageModal } from '../../../src/editor/components/create-page-modal'
import { ImageOverlay } from '../../../src/editor/components/image-overlay'
import { Toolbar } from '../../../src/editor/components/toolbar'
import { DEFAULT_CONFIG } from '../../../src/editor/config'
import { STORAGE_KEYS } from '../../../src/editor/constants'
import { startEditMode, stopEditMode } from '../../../src/editor/editor'
import { canUndo, clearHistory, undoStack } from '../../../src/editor/history'
import { buildOpenEntryMessage, buildOpenEntryMessageForFile } from '../../../src/editor/post-message'
import {
	config,
	dirtyChangesCount,
	handOverMarkdownEditor,
	isBgImageOverlayOpen,
	isEditing,
	isInlineEditingEnabled,
	isMarkdownEditorOpen,
	isMarkdownPreview,
	isMediaLibraryOpen,
	isSelectMode,
	manifest,
	markdownEditorState,
	openCurrentPageEntry,
	openMarkdownEditorForCurrentPage,
	openMarkdownEditorForEntry,
	openMarkdownEditorForNewPage,
	opensEntriesInParent,
	referencePickerState,
	resetAllState,
	restoreCurrentPageEntry,
	setCreatePageOpen,
	setCurrentEditingId,
	setFeatures,
} from '../../../src/editor/signals'
import { loadEditsFromStorage, loadMarkdownDraft, saveMarkdownDraft } from '../../../src/editor/storage'
import type { CollectionDefinition } from '../../../src/editor/types'
import type { CmsFeatures, CmsManifest, CmsPostMessage, CollectionEntry } from '../../../src/types'

// The features a host app embedding the site sends with `cms-set-features`: `inlineEditing: false`
// leaves the widget a preview companion with nothing that edits, `openEntriesInParent` hands the
// entries of content collections to the host's entry editor instead of the in-page markdown editor.

const NEWS: CollectionDefinition = {
	name: 'news',
	label: 'News',
	path: 'src/content/news',
	entryCount: 1,
	fields: [],
	fileExtension: 'md',
	entries: [{ slug: '2026/hello', sourcePath: 'src/content/news/2026/hello.md', pathname: '/news/hello' }],
}

/** A data collection, e.g. the navigation a site's header reads. */
const NAV: CollectionDefinition = {
	name: 'nav',
	label: 'Navigation',
	path: 'src/content/nav',
	entryCount: 1,
	fields: [],
	type: 'data',
	fileExtension: 'json',
	entries: [{ slug: 'main', sourcePath: 'src/content/nav/main.json' }],
}

/** The page's entry as the URL lookup finds it: the slug is the URL's tail, not the scan's. */
const PAGE_ENTRY: CollectionEntry = {
	collectionName: 'news',
	collectionSlug: 'hello',
	sourcePath: 'src/content/news/2026/hello.md',
	frontmatter: {},
	body: 'Hello',
	bodyStartLine: 3,
}

const manifestWith = (collections?: Record<string, CollectionEntry>): CmsManifest => ({
	entries: {},
	components: {},
	componentDefinitions: {},
	collectionDefinitions: { news: NEWS, nav: NAV },
	collections,
})

let container: HTMLElement
let found: { config: typeof config.value; manifest: typeof manifest.value }
let posted: CmsPostMessage[]
let originalParent: PropertyDescriptor | undefined

function resetEditorState(): void {
	resetAllState()
	clearHistory()
	sessionStorage.clear()
	isSelectMode.value = false
	isMarkdownPreview.value = false
	isBgImageOverlayOpen.value = false
	referencePickerState.value = { ...referencePickerState.value, isOpen: false }
}

beforeEach(() => {
	found = { config: config.value, manifest: manifest.value }
	resetEditorState()
	config.value = { ...DEFAULT_CONFIG }
	container = document.createElement('div')
	document.body.appendChild(container)
	// Framed: postToParent only posts when window.parent is another window.
	posted = []
	originalParent = Object.getOwnPropertyDescriptor(window, 'parent')
	Object.defineProperty(window, 'parent', {
		value: { postMessage: (msg: CmsPostMessage) => posted.push(msg) },
		configurable: true,
	})
})

afterEach(() => {
	render(null, container)
	container.remove()
	resetEditorState()
	config.value = found.config
	manifest.value = found.manifest
	if (originalParent) Object.defineProperty(window, 'parent', originalParent)
})

function host(features: CmsFeatures | undefined, collections?: Record<string, CollectionEntry>): void {
	config.value = { ...DEFAULT_CONFIG, features }
	manifest.value = manifestWith(collections)
}

async function mount<P extends object>(component: ComponentType<P>, props: P): Promise<void> {
	await act(() => render(h(component, props), container))
}

/** The fetch the widget makes: the manifest for manifest URLs, 404 for the rest. Optionally runs `onFetch` first. */
function mockFetch(pageManifest: CmsManifest, onFetch?: () => void): () => void {
	const originalFetch = globalThis.fetch
	globalThis.fetch = Object.assign(
		async (input: Parameters<typeof fetch>[0]) => {
			onFetch?.()
			return /manifest|\.json/.test(String(input)) ? Response.json(pageManifest) : new Response('Not found', { status: 404 })
		},
		{ preconnect: originalFetch?.preconnect ?? (() => {}) },
	)
	return () => {
		globalThis.fetch = originalFetch
	}
}

const HANDOVER: CmsPostMessage = {
	type: 'cms-open-entry',
	entry: { collection: 'news', slug: '2026/hello', sourcePath: 'src/content/news/2026/hello.md', pathname: window.location.pathname },
}

describe('buildOpenEntryMessage', () => {
	test('sends the slug the collection scan knows the entry by, matched by its file', () => {
		const msg = buildOpenEntryMessage(PAGE_ENTRY, manifestWith(), '/news/hello')
		expect(msg).toEqual({
			type: 'cms-open-entry',
			entry: { collection: 'news', slug: '2026/hello', sourcePath: 'src/content/news/2026/hello.md', pathname: '/news/hello' },
		})
	})

	test('matches a file written with a leading ./ or with backslashes', () => {
		expect(buildOpenEntryMessage({ ...PAGE_ENTRY, sourcePath: './src/content/news/2026/hello.md' }, manifestWith(), '/news/hello')?.entry.slug)
			.toBe('2026/hello')
		expect(buildOpenEntryMessageForFile(manifestWith(), 'src\\content\\news\\2026\\hello.md', '/news/hello')?.entry.slug).toBe('2026/hello')
	})

	test('names the collection the scan lists the file in, when the directory holds another one', () => {
		const NEWS_FAQ: CollectionDefinition = {
			...NEWS,
			name: 'news-faq',
			label: 'FAQ',
			parentCollection: 'news',
			entries: [{ slug: 'otazky/proc', sourcePath: 'src/content/news/otazky/proc.md' }],
		}
		const msg = buildOpenEntryMessage(
			{ ...PAGE_ENTRY, collectionSlug: 'proc', sourcePath: 'src/content/news/otazky/proc.md' },
			{ ...manifestWith(), collectionDefinitions: { news: NEWS, 'news-faq': NEWS_FAQ } },
			'/news/otazky/proc',
		)
		expect(msg?.entry).toMatchObject({ collection: 'news-faq', slug: 'otazky/proc' })
	})

	test('finds no entry for a file no collection lists, so its fields stay in the page', () => {
		expect(buildOpenEntryMessageForFile(manifestWith(), 'src/components/Header.astro', '/news/hello')).toBeUndefined()
		expect(buildOpenEntryMessageForFile(manifestWith(), 'src/data/site.json', '/news/hello')).toBeUndefined()
	})

	test('hands over no entry of a data or a hidden collection', () => {
		expect(buildOpenEntryMessageForFile(manifestWith(), 'src/content/nav/main.json', '/')).toBeUndefined()
		const hidden = { ...manifestWith(), collectionDefinitions: { news: { ...NEWS, hidden: true as const } } }
		expect(buildOpenEntryMessageForFile(hidden, 'src/content/news/2026/hello.md', '/news/hello')).toBeUndefined()
		expect(buildOpenEntryMessage(PAGE_ENTRY, hidden, '/news/hello')).toBeUndefined()
	})

	test("falls back to the page entry's own slug when the scan does not list the file", () => {
		const msg = buildOpenEntryMessage({ ...PAGE_ENTRY, sourcePath: 'src/content/news/other.md' }, manifestWith(), '/news/other')
		expect(msg?.entry.slug).toBe('hello')
	})
})

describe('setFeatures', () => {
	test('both flags default to the widget as it always was', () => {
		host(undefined)
		expect(isInlineEditingEnabled.value).toBe(true)
		expect(opensEntriesInParent.value).toBe(false)
	})

	test('merges the new flags into what the host sent before', () => {
		host({ selectElement: true, collectionManagement: false })
		setFeatures({ inlineEditing: false, openEntriesInParent: true })
		expect(config.value.features).toEqual({ selectElement: true, collectionManagement: false, inlineEditing: false, openEntriesInParent: true })
		expect(isInlineEditingEnabled.value).toBe(false)
		expect(opensEntriesInParent.value).toBe(true)
	})

	test('leaves the config alone when nothing changes, a new flag included', () => {
		host({ selectElement: true, inlineEditing: false })
		const before = config.value
		setFeatures({ inlineEditing: false })
		expect(config.value).toBe(before)
		setFeatures({ inlineEditing: true })
		expect(config.value).not.toBe(before)
	})
})

describe('openCurrentPageEntry', () => {
	test('with openEntriesInParent, posts cms-open-entry and opens no markdown editor', async () => {
		host({ openEntriesInParent: true }, { 'news/hello': PAGE_ENTRY })
		expect(await openCurrentPageEntry()).toBe(true)
		expect(posted).toEqual([HANDOVER])
		expect(isMarkdownEditorOpen.value).toBe(false)
	})

	test('with openEntriesInParent on a page that is no entry, posts nothing', async () => {
		host({ openEntriesInParent: true })
		const restore = mockFetch(manifestWith())
		expect(await openCurrentPageEntry()).toBe(false)
		restore()
		expect(posted).toEqual([])
	})

	test('without inline editing and without the host taking entries, opens nothing', async () => {
		host({ inlineEditing: false }, { 'news/hello': PAGE_ENTRY })
		expect(await openCurrentPageEntry()).toBe(false)
		expect(posted).toEqual([])
		expect(isMarkdownEditorOpen.value).toBe(false)
	})
})

describe('markdown editor entry points, when the host edits entries', () => {
	let restoreFetch: () => void
	beforeEach(() => {
		restoreFetch = mockFetch(manifestWith({ 'news/hello': PAGE_ENTRY }))
	})
	afterEach(() => restoreFetch())

	test('an entry opened from the collection browser goes to the host, a data entry opens here', () => {
		host({ openEntriesInParent: true })
		openMarkdownEditorForEntry('news', '2026/hello', 'src/content/news/2026/hello.md', NEWS)
		expect(posted).toEqual([HANDOVER])
		expect(isMarkdownEditorOpen.value).toBe(false)

		openMarkdownEditorForEntry('nav', 'main', 'src/content/nav/main.json', NAV)
		expect(posted).toHaveLength(1)
		expect(isMarkdownEditorOpen.value).toBe(true)
	})

	test('no new entry of a content collection is written here, one of a data collection is', () => {
		host({ openEntriesInParent: true })
		openMarkdownEditorForNewPage('news', NEWS)
		expect(isMarkdownEditorOpen.value).toBe(false)
		openMarkdownEditorForNewPage('nav', NAV)
		expect(isMarkdownEditorOpen.value).toBe(true)
	})

	test('a markdown editor already loading when the host takes entries over hands the entry over instead', async () => {
		host(undefined, { 'news/hello': PAGE_ENTRY })
		restoreFetch()
		restoreFetch = mockFetch(manifestWith({ 'news/hello': PAGE_ENTRY }), () => setFeatures({ openEntriesInParent: true }))
		expect(await openMarkdownEditorForCurrentPage()).toBe(true)
		expect(posted).toEqual([HANDOVER])
		expect(isMarkdownEditorOpen.value).toBe(false)
	})

	test('a markdown editor open when the host takes entries over is handed over, not just closed', async () => {
		host(undefined, { 'news/hello': PAGE_ENTRY })
		saveMarkdownDraft(PAGE_ENTRY.sourcePath, {}, 'Unsaved')
		markdownEditorState.value = {
			...markdownEditorState.value,
			isOpen: true,
			mode: 'edit',
			currentPage: { filePath: PAGE_ENTRY.sourcePath, slug: 'hello', frontmatter: {}, content: 'Unsaved', isDirty: true },
		}
		setFeatures({ openEntriesInParent: true })
		handOverMarkdownEditor()
		expect(posted).toEqual([HANDOVER])
		expect(isMarkdownEditorOpen.value).toBe(false)
		expect(loadMarkdownDraft(PAGE_ENTRY.sourcePath)).toBeNull()
	})

	test('a markdown editor open on a data entry stays open', () => {
		host({ openEntriesInParent: true })
		markdownEditorState.value = {
			...markdownEditorState.value,
			isOpen: true,
			mode: 'edit',
			currentPage: { filePath: 'src/content/nav/main.json', slug: 'main', frontmatter: {}, content: '', isDirty: false },
		}
		handOverMarkdownEditor()
		expect(posted).toEqual([])
		expect(isMarkdownEditorOpen.value).toBe(true)
	})
})

describe('restoring the page entry after a reload, when the host edits entries', () => {
	let restoreFetch: () => void
	beforeEach(() => {
		restoreFetch = mockFetch(manifestWith({ 'news/hello': PAGE_ENTRY }))
	})
	afterEach(() => restoreFetch())

	test("a draft of the page's entry hands it over once, and is dropped so the next reload does not", async () => {
		host({ openEntriesInParent: true }, { 'news/hello': PAGE_ENTRY })
		saveMarkdownDraft(PAGE_ENTRY.sourcePath, {}, 'Unsaved')
		await restoreCurrentPageEntry()
		await restoreCurrentPageEntry()
		expect(posted).toEqual([HANDOVER])
		expect(loadMarkdownDraft(PAGE_ENTRY.sourcePath)).toBeNull()
		expect(isMarkdownEditorOpen.value).toBe(false)
	})

	test('a draft of another file hands nothing over and opens no editor', async () => {
		host({ openEntriesInParent: true }, { 'news/hello': PAGE_ENTRY })
		saveMarkdownDraft('src/content/news/other.md', {}, 'Unsaved')
		await restoreCurrentPageEntry()
		expect(posted).toEqual([])
		expect(isMarkdownEditorOpen.value).toBe(false)
	})

	test('features arriving while the draft loads hand the entry over', async () => {
		host(undefined, { 'news/hello': PAGE_ENTRY })
		saveMarkdownDraft(PAGE_ENTRY.sourcePath, {}, 'Unsaved')
		restoreFetch()
		restoreFetch = mockFetch(manifestWith({ 'news/hello': PAGE_ENTRY }), () => setFeatures({ openEntriesInParent: true }))
		await restoreCurrentPageEntry()
		expect(posted).toEqual([HANDOVER])
		expect(isMarkdownEditorOpen.value).toBe(false)
	})
})

describe('Toolbar', () => {
	const callbacks = { onEdit() {}, onCompare() {}, onSave() {}, onDiscard() {}, onSelectElement() {}, onEditContent() {}, onOpenCollection() {} }

	/** Open the menu, expand every section and read back each item's label. */
	async function menu(): Promise<string[]> {
		await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')?.click())
		return [...container.querySelectorAll<HTMLButtonElement>('button')]
			.map(button => button.textContent ?? '')
			.filter(label => label !== '')
	}

	test('without features the menu is what it always was', async () => {
		host(undefined)
		await mount(Toolbar, { callbacks, collectionDefinitions: { news: NEWS } })
		expect(await menu()).toEqual(['Edit Page', 'New Page', 'Content', 'News', 'Settings', 'Redirects', 'Delete Page'])
	})

	test('without inline editing only element selection is left', async () => {
		host({ selectElement: true, collectionManagement: false, inlineEditing: false })
		await mount(Toolbar, { callbacks, collectionDefinitions: { news: NEWS } })
		expect(await menu()).toEqual(['Select Element'])
	})

	test('without inline editing an entry page still hands its entry to the host', async () => {
		host({ collectionManagement: false, inlineEditing: false, openEntriesInParent: true }, { 'news/hello': PAGE_ENTRY })
		await mount(Toolbar, { callbacks, collectionDefinitions: { news: NEWS } })
		expect(await menu()).toEqual(['Content', 'Edit Content'])
	})

	test('when the host edits entries, an entry page keeps the page editor but not Delete Page', async () => {
		host({ selectElement: true, collectionManagement: false, openEntriesInParent: true }, { 'news/hello': PAGE_ENTRY })
		await mount(Toolbar, { callbacks, collectionDefinitions: { news: NEWS } })
		expect(await menu()).toEqual(['Select Element', 'Edit Page', 'New Page', 'Content', 'Edit Content', 'Settings', 'Redirects'])
	})

	test('when the host edits entries, a page that is no entry keeps Delete Page', async () => {
		host({ collectionManagement: false, openEntriesInParent: true })
		await mount(Toolbar, { callbacks, collectionDefinitions: { news: NEWS } })
		expect(await menu()).toEqual(['Edit Page', 'New Page', 'Settings', 'Redirects', 'Delete Page'])
	})

	test('with nothing left to offer there is no toolbar', async () => {
		host({ collectionManagement: false, inlineEditing: false })
		await mount(Toolbar, { callbacks, collectionDefinitions: { news: NEWS } })
		expect(container.innerHTML).toBe('')
	})
})

describe('CreatePageModal', () => {
	const modeCards = () => [...container.querySelectorAll('button .font-medium')].map(element => element.textContent)

	test('does not offer an entry of a collection the host edits', async () => {
		host({ openEntriesInParent: true })
		manifest.value = { ...manifest.value, collectionDefinitions: { news: NEWS } }
		setCreatePageOpen(true)
		await mount(CreatePageModal, {})
		expect(modeCards()).toEqual(['Blank Page', 'Duplicate Page'])
	})

	test('still offers an entry of a data collection when the host edits entries', async () => {
		host({ openEntriesInParent: true })
		setCreatePageOpen(true)
		await mount(CreatePageModal, {})
		expect(modeCards()).toEqual(['Blank Page', 'Duplicate Page', 'Collection Entry'])
	})
})

describe('image overlays, when the host edits entries', () => {
	const IMAGE_MANIFEST: CmsManifest = {
		...manifestWith({ 'news/hello': PAGE_ENTRY }),
		entries: {
			cover: { id: 'cover', tag: 'img', text: '', sourcePath: 'src/content/news/2026/hello.md', sourceLine: 3 },
			hero: { id: 'hero', tag: 'div', text: '', sourcePath: 'src/content/news/2026/hello.md', sourceLine: 4 },
			logo: { id: 'logo', tag: 'img', text: '', sourcePath: 'src/components/Header.astro', sourceLine: 2 },
		},
	}
	let images: HTMLElement
	beforeEach(() => {
		// happy-dom has no layout: nothing is under the pointer but the overlay.
		Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true })
		images = document.createElement('div')
		images.innerHTML = `
			<img data-cms-id="cover" data-cms-img src="/cover.jpg">
			<div data-cms-id="hero" data-cms-bg-img class="bg-[url('/hero.jpg')]"></div>
			<img data-cms-id="logo" data-cms-img src="/logo.svg">
		`
		document.body.appendChild(images)
	})
	afterEach(() => {
		images.remove()
		Reflect.deleteProperty(document, 'elementsFromPoint')
	})

	async function clickImageOverlay(cmsId: string): Promise<void> {
		const element = images.querySelector<HTMLImageElement>(`[data-cms-id="${cmsId}"]`)
		await mount(ImageOverlay, { visible: true, rect: new DOMRect(0, 0, 10, 10), element, cmsId })
		await act(() => container.querySelector('div')?.shadowRoot?.querySelector<HTMLElement>('.image-overlay')?.click())
	}

	test("an entry's image is handed to the host instead of opening the media library", async () => {
		host({ openEntriesInParent: true })
		manifest.value = IMAGE_MANIFEST
		await clickImageOverlay('cover')
		expect(posted).toEqual([HANDOVER])
		expect(isMediaLibraryOpen.value).toBe(false)
	})

	test('an image from a component still opens the media library', async () => {
		host({ openEntriesInParent: true })
		manifest.value = IMAGE_MANIFEST
		await clickImageOverlay('logo')
		expect(posted).toEqual([])
		expect(isMediaLibraryOpen.value).toBe(true)
	})

	test("an entry's background image is handed to the host instead of opening its panel", async () => {
		host({ openEntriesInParent: true })
		manifest.value = IMAGE_MANIFEST
		const element = images.querySelector<HTMLElement>('[data-cms-id="hero"]')
		await mount(BgImageOverlay, { visible: true, rect: new DOMRect(0, 0, 10, 10), element, cmsId: 'hero' })
		await act(() => container.querySelector<HTMLElement>('[data-cms-ui]')?.click())
		expect(posted).toEqual([HANDOVER])
		expect(isBgImageOverlayOpen.value).toBe(false)
	})
})

describe('edit mode on an entry page, when the host edits entries', () => {
	const PAGE_MANIFEST: CmsManifest = {
		...manifestWith({ 'news/hello': PAGE_ENTRY }),
		entries: {
			'layout-title': { id: 'layout-title', tag: 'span', text: 'Site name', sourcePath: 'src/components/Header.astro', sourceLine: 3 },
			'site-claim': { id: 'site-claim', tag: 'p', text: 'Claim', sourcePath: 'src/data/site.json', sourceLine: 2 },
			'nav-label': { id: 'nav-label', tag: 'span', text: 'Home', sourcePath: 'src/content/nav/main.json', sourceLine: 3 },
			'entry-title': {
				id: 'entry-title',
				tag: 'h1',
				text: 'Hello',
				sourcePath: './src/content/news/2026/hello.md',
				sourceLine: 2,
				collectionName: 'news',
				collectionSlug: 'hello',
			},
			'card-title': { id: 'card-title', tag: 'h2', text: 'Hello', sourcePath: 'src/content/news/2026/hello.md', sourceLine: 2 },
			author: {
				id: 'author',
				tag: 'span',
				text: 'Jane',
				sourcePath: 'src/content/authors/jane.md',
				sourceLine: 2,
				referenceCollection: 'authors',
				referencedBy: [{ collection: 'news', fieldName: 'author' }],
			},
			body: { id: 'body', tag: 'div', text: 'Hello', contentPath: 'src/content/news/2026/hello.md', collectionName: 'news', collectionSlug: 'hello' },
			promo: { id: 'promo', tag: 'div', text: 'Promo', contentPath: 'src/content/snippets/promo.md' },
		},
	}
	const PAGE_HTML = `
		<header>
			<span data-cms-id="layout-title">Site name</span>
			<p data-cms-id="site-claim">Claim</p>
			<a href="/"><span data-cms-id="nav-label">Home</span></a>
		</header>
		<main>
			<h1 data-cms-id="entry-title">Hello</h1>
			<span data-cms-id="author">Jane</span>
			<div data-cms-id="body" data-cms-markdown><p>Hello</p></div>
			<div data-cms-id="promo" data-cms-markdown><p>Promo</p></div>
			<a href="/news/hello"><h2 data-cms-id="card-title">Hello</h2></a>
		</main>
	`
	const element = (id: string) => document.querySelector<HTMLElement>(`[data-cms-id="${id}"]`)!

	/** Type into an element the way the browser does: it is the one being edited, then `input`. */
	function type(id: string, text: string): void {
		setCurrentEditingId(id)
		element(id).textContent = text
		element(id).dispatchEvent(new Event('input', { bubbles: true }))
	}

	let restoreFetch: () => void
	beforeEach(() => {
		restoreFetch = mockFetch(PAGE_MANIFEST)
		document.body.insertAdjacentHTML('beforeend', PAGE_HTML)
	})
	afterEach(() => {
		if (isEditing.value) stopEditMode()
		restoreFetch()
		for (const node of document.body.querySelectorAll('header, main')) node.remove()
	})

	test('layout texts and data-collection fields stay editable in the page, entry fields and the body go to the host', async () => {
		host({ collectionManagement: false, openEntriesInParent: true })
		await startEditMode(DEFAULT_CONFIG)

		expect(element('layout-title').contentEditable).toBe('true')
		expect(element('site-claim').contentEditable).toBe('true')
		expect(element('nav-label').contentEditable).toBe('true')
		expect(element('entry-title').contentEditable).toBe('false')

		element('nav-label').click()
		expect(posted).toEqual([])
		element('entry-title').click()
		element('body').click()
		expect(posted).toEqual([HANDOVER, HANDOVER])
		expect(isMarkdownEditorOpen.value).toBe(false)
	})

	test('an entry field inside a link hands the entry over, and the link does not navigate', async () => {
		host({ openEntriesInParent: true })
		await startEditMode(DEFAULT_CONFIG)

		const click = new MouseEvent('click', { bubbles: true, cancelable: true })
		element('card-title').dispatchEvent(click)
		expect(posted).toEqual([HANDOVER])
		expect(click.defaultPrevented).toBe(true)
	})

	test('a reference hands over the entry whose field holds it, and opens no picker', async () => {
		host({ openEntriesInParent: true })
		await startEditMode(DEFAULT_CONFIG)

		element('author').click()
		expect(posted).toEqual([HANDOVER])
		expect(referencePickerState.value.isOpen).toBe(false)
	})

	test("a markdown body of a file the host does not edit is not handed over as the page's entry", async () => {
		host({ openEntriesInParent: true })
		await startEditMode(DEFAULT_CONFIG)

		element('promo').click()
		expect(posted).toEqual([])
	})

	test('without the flag an entry field is edited in the page as before', async () => {
		host(undefined)
		await startEditMode(DEFAULT_CONFIG)

		expect(element('entry-title').contentEditable).toBe('true')
		element('entry-title').click()
		expect(posted).toEqual([])
	})

	test('features arriving in edit mode drop the page edits of entry fields and keep the rest', async () => {
		host(undefined)
		await startEditMode(DEFAULT_CONFIG)
		type('entry-title', 'Edited')
		type('layout-title', 'New name')
		expect(dirtyChangesCount.value).toBe(2)

		// What the widget does when `openEntriesInParent` arrives in edit mode.
		setFeatures({ openEntriesInParent: true })
		stopEditMode()
		await startEditMode(config.value)

		expect(element('entry-title').textContent).toBe('Hello')
		expect(element('entry-title').contentEditable).toBe('false')
		expect(element('layout-title').textContent).toBe('New name')
		expect(dirtyChangesCount.value).toBe(1)
		expect(Object.keys(loadEditsFromStorage())).toEqual(['layout-title'])
		expect(undoStack.value.some(action => action.cmsId === 'entry-title')).toBe(false)
		expect(canUndo.value).toBe(true)

		element('entry-title').click()
		expect(posted).toEqual([HANDOVER])
	})

	test('a stored page edit of an entry field is not painted when edit mode starts with the flag', async () => {
		sessionStorage.setItem(
			STORAGE_KEYS.PENDING_EDITS,
			JSON.stringify({ 'entry-title': { originalText: 'Hello', newText: 'Edited', currentHTML: 'Edited', hasStyledContent: false } }),
		)
		host({ openEntriesInParent: true })
		manifest.value = PAGE_MANIFEST
		await startEditMode(config.value)

		expect(element('entry-title').textContent).toBe('Hello')
		expect(dirtyChangesCount.value).toBe(0)
		expect(loadEditsFromStorage()).toEqual({})
	})
})
