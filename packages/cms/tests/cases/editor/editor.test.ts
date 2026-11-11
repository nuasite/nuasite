import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { _resetToastThrottles, startEditMode, stopEditMode } from '../../../src/editor/editor'
import * as signals from '../../../src/editor/signals'
import type { CmsConfig, CmsManifest } from '../../../src/editor/types'

const mockConfig: CmsConfig = {
	apiBase: '/_nua/cms',
	highlightColor: '#005AE0',
	debug: false,
}

beforeEach(() => {
	document.body.innerHTML = ''

	// Mock window.location for page-specific manifest URL
	Object.defineProperty(window, 'location', {
		value: { pathname: '/', href: 'http://localhost/' },
		writable: true,
	})

	// Mock fetch for manifest - handles both page-specific and global manifests
	const mockManifestData = {
		entries: {
			'test-id-1': {
				id: 'test-id-1',
				tag: 'tag1',
				text: 'Test content 1',
				sourcePath: '/test/path1.md',
				sourceLine: 1,
			},
			'test-id-2': {
				id: 'test-id-2',
				tag: 'tag2',
				text: 'Test content 2',
				sourcePath: '/test/path2.md',
				sourceLine: 1,
			},
			'no-source-id': {
				id: 'no-source-id',
				tag: 'p',
				text: 'Text with no source path',
			},
			'unresolved-text-id': {
				id: 'unresolved-text-id',
				tag: 'p',
				text: 'Text the source finder never located',
				sourcePath: '/test/path3.astro',
				sourceLine: 4,
				textResolved: false,
			},
		},
		components: {},
		componentDefinitions: {},
	} satisfies CmsManifest

	// Reset toast state between tests so assertions on toasts aren't leaky
	signals.toasts.value = []
	_resetToastThrottles()
	;(global as any).fetch = async (url: string | Request) => {
		const urlStr = url.toString()
		// Handle both page-specific manifest (/index.json) and global manifest (/cms-manifest.json)
		if (urlStr.includes('/cms-manifest.json') || urlStr.includes('/index.json')) {
			return new Response(JSON.stringify(mockManifestData), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}
		return new Response('Not found', { status: 404 })
	}
})

afterEach(() => {
	document.body.innerHTML = ''
})

test('startEditMode disables all links on page', async () => {
	document.body.innerHTML = `
    <a href="/page1">Link 1</a>
    <a href="/page2">Link 2</a>
    <div data-cms-id="test-id-1">Editable content</div>
  `

	const onStateChange = () => {}
	await startEditMode(mockConfig, onStateChange)

	const links = document.querySelectorAll('a')
	expect(links.length).toBe(2)
	links.forEach(link => {
		expect(link.hasAttribute('data-cms-disabled')).toBe(true)
	})
})

test('stopEditMode re-enables all links', async () => {
	document.body.innerHTML = `
    <a href="/page1">Link 1</a>
    <div data-cms-id="test-id-1">Editable content</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const linkBeforeStop = document.querySelector('a')!
	expect(linkBeforeStop.hasAttribute('data-cms-disabled')).toBe(true)

	stopEditMode(onStateChange)

	const linkAfterStop = document.querySelector('a')!
	expect(linkAfterStop.hasAttribute('data-cms-disabled')).toBe(false)
})

test('disabled links prevent navigation in edit mode', async () => {
	document.body.innerHTML = `
    <a href="/test-page">Test Link</a>
    <div data-cms-id="test-id-1">Editable content</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const link = document.querySelector('a')!
	let defaultPrevented = false

	const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
	Object.defineProperty(clickEvent, 'preventDefault', {
		value: () => {
			defaultPrevented = true
		},
	})

	link.dispatchEvent(clickEvent)
	expect(defaultPrevented).toBe(true)
})

test('links work normally after exiting edit mode', async () => {
	document.body.innerHTML = `
    <a href="/test-page">Test Link</a>
    <div data-cms-id="test-id-1">Editable content</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)
	stopEditMode(onStateChange)

	const link = document.querySelector('a')!
	expect(link.hasAttribute('data-cms-disabled')).toBe(false)
})

test('startEditMode makes cms elements editable', async () => {
	document.body.innerHTML = `
    <div data-cms-id="test-id-1">Content 1</div>
    <div data-cms-id="test-id-2">Content 2</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const el1 = document.querySelector('[data-cms-id="test-id-1"]') as HTMLElement
	const el2 = document.querySelector('[data-cms-id="test-id-2"]') as HTMLElement

	expect(el1.contentEditable).toBe('true')
	expect(el2.contentEditable).toBe('true')
})

test('stopEditMode makes cms elements non-editable', async () => {
	document.body.innerHTML = `
    <div data-cms-id="test-id-1">Content 1</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const elBefore = document.querySelector('[data-cms-id="test-id-1"]') as HTMLElement
	expect(elBefore.contentEditable).toBe('true')

	stopEditMode(onStateChange)

	const elAfter = document.querySelector('[data-cms-id="test-id-1"]') as HTMLElement
	expect(elAfter.contentEditable).toBe('false')
})

test('startEditMode skips elements not in manifest', async () => {
	document.body.innerHTML = `
    <div data-cms-id="test-id-1">In manifest</div>
    <div data-cms-id="not-in-manifest">Not in manifest</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const inManifest = document.querySelector('[data-cms-id="test-id-1"]') as HTMLElement
	const notInManifest = document.querySelector('[data-cms-id="not-in-manifest"]') as HTMLElement

	expect(inManifest.contentEditable).toBe('true')
	expect(notInManifest.contentEditable).toBe('false')
})

test('edit mode works with links inside cms elements', async () => {
	document.body.innerHTML = `
    <div data-cms-id="test-id-1">
      Content with <a href="/link">a link</a> inside
    </div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const link = document.querySelector('a')!
	expect(link.hasAttribute('data-cms-disabled')).toBe(true)

	// Link inside editable element should still be disabled
	let defaultPrevented = false
	const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
	Object.defineProperty(clickEvent, 'preventDefault', {
		value: () => {
			defaultPrevented = true
		},
	})

	link.dispatchEvent(clickEvent)
	expect(defaultPrevented).toBe(true)
})

test('multiple start/stop cycles work correctly', async () => {
	document.body.innerHTML = `
    <a href="/page">Link</a>
    <div data-cms-id="test-id-1">Content</div>
  `

	const onStateChange = () => {}

	const link = document.querySelector('a')!

	// First cycle
	await startEditMode(mockConfig, onStateChange)
	expect(link.hasAttribute('data-cms-disabled')).toBe(true)

	stopEditMode(onStateChange)
	expect(link.hasAttribute('data-cms-disabled')).toBe(false)

	// Second cycle
	await startEditMode(mockConfig, onStateChange)
	expect(link.hasAttribute('data-cms-disabled')).toBe(true)

	stopEditMode(onStateChange)
	expect(link.hasAttribute('data-cms-disabled')).toBe(false)
})

test('startEditMode handles page with no links', async () => {
	document.body.innerHTML = `
    <div data-cms-id="test-id-1">Content without links</div>
    <p>Just text</p>
  `

	const onStateChange = () => {}

	// Should not throw error
	await startEditMode(mockConfig, onStateChange)

	const cmsEl = document.querySelector('[data-cms-id="test-id-1"]') as HTMLElement
	expect(cmsEl.contentEditable).toBe('true')
})

test('startEditMode handles page with many links', async () => {
	const linksHtml = Array.from({ length: 100 }, (_, i) => `<a href="/page${i}">Link ${i}</a>`).join('\n')

	document.body.innerHTML = `
    ${linksHtml}
    <div data-cms-id="test-id-1">Content</div>
  `

	const onStateChange = () => {}

	await startEditMode(mockConfig, onStateChange)

	const links = document.querySelectorAll('a')
	expect(links.length).toBe(100)
	links.forEach(link => {
		expect(link.hasAttribute('data-cms-disabled')).toBe(true)
	})
})

test('startEditMode locks elements whose manifest entry has no source path', async () => {
	document.body.innerHTML = `
    <div data-cms-id="test-id-1">Editable content</div>
    <div data-cms-id="no-source-id">No source path</div>
  `

	await startEditMode(mockConfig, () => {})

	const editable = document.querySelector('[data-cms-id="test-id-1"]') as HTMLElement
	const locked = document.querySelector('[data-cms-id="no-source-id"]') as HTMLElement

	expect(editable.contentEditable).toBe('true')
	expect(editable.hasAttribute('data-cms-locked')).toBe(false)

	expect(locked.contentEditable).toBe('false')
	expect(locked.getAttribute('data-cms-locked')).toBe('true')
})

test('clicking a locked element shows a toast explaining why it is not editable', async () => {
	document.body.innerHTML = `
    <div data-cms-id="no-source-id">No source path</div>
  `

	await startEditMode(mockConfig, () => {})

	const locked = document.querySelector('[data-cms-id="no-source-id"]') as HTMLElement
	expect(signals.toasts.value).toHaveLength(0)

	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))

	expect(signals.toasts.value).toHaveLength(1)
	expect(signals.toasts.value[0]!.message).toContain("can't be edited")
})

test('locked-element toast is throttled across rapid clicks', async () => {
	document.body.innerHTML = `
    <div data-cms-id="no-source-id">No source path</div>
  `

	await startEditMode(mockConfig, () => {})

	const locked = document.querySelector('[data-cms-id="no-source-id"]') as HTMLElement
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))

	// Throttling coalesces the burst into a single toast so the user isn't spammed.
	expect(signals.toasts.value).toHaveLength(1)
})

test('stopEditMode clears the locked attribute', async () => {
	document.body.innerHTML = `
    <div data-cms-id="no-source-id">No source path</div>
  `

	await startEditMode(mockConfig, () => {})
	const locked = document.querySelector('[data-cms-id="no-source-id"]') as HTMLElement
	expect(locked.getAttribute('data-cms-locked')).toBe('true')

	stopEditMode(() => {})
	expect(locked.hasAttribute('data-cms-locked')).toBe(false)
})

test('an entry whose text was never located is not typeable, but stays selectable', async () => {
	document.body.innerHTML = `
    <p data-cms-id="unresolved-text-id">Text the source finder never located</p>
    <p data-cms-id="no-source-id">Text with no source path</p>
    <p data-cms-id="test-id-1">Editable content</p>
  `

	await startEditMode(mockConfig, () => {})

	const unresolved = document.querySelector('[data-cms-id="unresolved-text-id"]')!
	const noSource = document.querySelector('[data-cms-id="no-source-id"]')!
	const editable = document.querySelector('[data-cms-id="test-id-1"]')!

	// Typing would only fail on save — but its attributes and colour classes are
	// written from the opening tag and still work, so it must not be locked out of
	// selection the way an entry with no source path at all is.
	expect(unresolved.getAttribute('contenteditable')).not.toBe('true')
	expect(unresolved.hasAttribute('data-cms-locked')).toBe(false)
	expect(noSource.getAttribute('data-cms-locked')).toBe('true')
	expect(editable.hasAttribute('data-cms-locked')).toBe(false)
})

/** Answer manifest requests with `entries`, and a `locate=<id>` request with `located` merged in. */
function serveManifest(located: Record<string, CmsManifest['entries'][string]>): string[] {
	const requests: string[] = []
	const entries: CmsManifest['entries'] = {
		'test-id-1': { id: 'test-id-1', tag: 'p', text: 'Editable content', sourcePath: '/test/path1.md', sourceLine: 1 },
		'no-source-id': { id: 'no-source-id', tag: 'p', text: 'Text with no source path' },
	}
	const respond = async (input: RequestInfo | URL): Promise<Response> => {
		const urlStr = input instanceof Request ? input.url : input.toString()
		requests.push(urlStr)
		const locate = new URL(urlStr, 'http://localhost').searchParams.get('locate')
		return Response.json({ entries: locate ? { ...entries, ...located } : entries, components: {}, componentDefinitions: {} })
	}
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign(respond, { preconnect: fetch.preconnect }))
	return requests
}

function lockedElement(): HTMLElement {
	const el = document.querySelector('[data-cms-id="no-source-id"]')
	if (!(el instanceof HTMLElement)) throw new Error('No locked element')
	return el
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

test('clicking a locked element has the server locate it, then makes it editable without restarting edit mode', async () => {
	const requests = serveManifest({
		'no-source-id': { id: 'no-source-id', tag: 'p', text: 'Text with no source path', sourcePath: 'src/data/site.ts', sourceLine: 1 },
	})
	document.body.innerHTML = `
    <p data-cms-id="test-id-1">Editable content</p>
    <p data-cms-id="no-source-id">Text with no source path</p>
  `
	await startEditMode(mockConfig, () => {})
	signals.openAttributeEditor('test-id-1', new DOMRect())

	const locked = lockedElement()
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle()

	// One search for both clicks, asked for this entry.
	expect(requests.filter(url => url.includes('locate=no-source-id'))).toHaveLength(1)
	expect(locked.hasAttribute('data-cms-locked')).toBe(false)
	expect(locked.contentEditable).toBe('true')
	expect(signals.pendingChanges.value.has('no-source-id')).toBe(true)
	// Only that element was wired: the session and its open dialog are as they were.
	expect(signals.isEditing.value).toBe(true)
	expect(signals.isAttributeEditorOpen.value).toBe(true)

	// The click listener of the lock outlives it, and does nothing once the element is editable.
	signals.toasts.value = []
	_resetToastThrottles()
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	expect(signals.toasts.value).toHaveLength(0)
})

test('a locked element the server cannot locate stays locked', async () => {
	serveManifest({})
	document.body.innerHTML = `<p data-cms-id="no-source-id">Text with no source path</p>`
	await startEditMode(mockConfig, () => {})

	const locked = lockedElement()
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle()

	expect(locked.getAttribute('data-cms-locked')).toBe('true')
	expect(locked.contentEditable).toBe('false')
})

test('a search that ends after edit mode stopped leaves the element alone', async () => {
	serveManifest({
		'no-source-id': { id: 'no-source-id', tag: 'p', text: 'Text with no source path', sourcePath: 'src/data/site.ts', sourceLine: 1 },
	})
	document.body.innerHTML = `<p data-cms-id="no-source-id">Text with no source path</p>`
	await startEditMode(mockConfig, () => {})

	const locked = lockedElement()
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	stopEditMode(() => {})
	await settle()

	expect(signals.isEditing.value).toBe(false)
	expect(locked.contentEditable).not.toBe('true')
})

test('a click after edit mode restarted searches again, though the previous session left its search unfinished', async () => {
	const requests = serveManifest({
		'no-source-id': { id: 'no-source-id', tag: 'p', text: 'Text with no source path', sourcePath: 'src/data/site.ts', sourceLine: 1 },
	})
	document.body.innerHTML = `<p data-cms-id="no-source-id">Text with no source path</p>`
	await startEditMode(mockConfig, () => {})
	lockedElement().dispatchEvent(new MouseEvent('click', { bubbles: true }))
	stopEditMode(() => {})

	await startEditMode(mockConfig, () => {})
	const locked = lockedElement()
	locked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle()

	expect(requests.filter(url => url.includes('locate=no-source-id'))).toHaveLength(2)
	expect(locked.hasAttribute('data-cms-locked')).toBe(false)
	expect(locked.contentEditable).toBe('true')
})

/** Answer manifest requests with a pending entry, and a `resolve=<id>` request with `resolved` in its place. */
function servePendingManifest(resolved: CmsManifest['entries'][string]): string[] {
	const requests: string[] = []
	const pending: CmsManifest['entries'][string] = { id: 'pending-id', tag: 'p', text: 'Text not resolved yet', pending: true }
	const respond = async (input: RequestInfo | URL): Promise<Response> => {
		const urlStr = input instanceof Request ? input.url : input.toString()
		requests.push(urlStr)
		const resolve = new URL(urlStr, 'http://localhost').searchParams.get('resolve')
		return Response.json({ entries: { 'pending-id': resolve === 'pending-id' ? resolved : pending }, components: {}, componentDefinitions: {} })
	}
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign(respond, { preconnect: fetch.preconnect }))
	return requests
}

function pendingElement(): HTMLElement {
	const el = document.querySelector('[data-cms-id="pending-id"]')
	if (!(el instanceof HTMLElement)) throw new Error('No pending element')
	return el
}

const RESOLVED: CmsManifest['entries'][string] = {
	id: 'pending-id',
	tag: 'p',
	text: 'Text not resolved yet',
	sourcePath: 'src/pages/index.astro',
	sourceLine: 3,
}

test('a pending element is wired once its first hover has the server resolve its entry', async () => {
	const requests = servePendingManifest(RESOLVED)
	document.body.innerHTML = `<p data-cms-id="pending-id">Text not resolved yet</p>`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	expect(el.contentEditable).toBe('false')
	expect(el.getAttribute('data-cms-pending')).toBe('true')

	el.dispatchEvent(new PointerEvent('pointerenter'))
	el.dispatchEvent(new PointerEvent('pointerenter'))
	await settle()

	expect(requests.filter(url => url.includes('resolve=pending-id'))).toHaveLength(1)
	// Only the page's own manifest is asked for, not the global one.
	expect(requests.filter(url => url.includes('cms-manifest.json'))).toHaveLength(1)
	expect(el.hasAttribute('data-cms-pending')).toBe(false)
	expect(el.contentEditable).toBe('true')
	expect(signals.manifest.value.entries['pending-id']?.sourcePath).toBe('src/pages/index.astro')
	expect(document.activeElement).not.toBe(el)
})

test('a click on a pending element before any hover resolves it and puts the caret in it', async () => {
	servePendingManifest(RESOLVED)
	document.body.innerHTML = `<p data-cms-id="pending-id">Text not resolved yet</p>`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle()

	expect(el.contentEditable).toBe('true')
	expect(document.activeElement).toBe(el)
	expect(signals.toasts.value).toHaveLength(0)
})

test('a pending entry the server resolves without a source becomes locked', async () => {
	servePendingManifest({ id: 'pending-id', tag: 'p', text: 'Text not resolved yet' })
	document.body.innerHTML = `<p data-cms-id="pending-id">Text not resolved yet</p>`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	el.dispatchEvent(new PointerEvent('pointerenter'))
	await settle()

	expect(el.hasAttribute('data-cms-pending')).toBe(false)
	expect(el.getAttribute('data-cms-locked')).toBe('true')
	expect(el.contentEditable).toBe('false')
})

test('an answer that comes after edit mode stopped leaves the pending element alone', async () => {
	servePendingManifest(RESOLVED)
	document.body.innerHTML = `<p data-cms-id="pending-id">Text not resolved yet</p>`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	el.dispatchEvent(new PointerEvent('pointerenter'))
	stopEditMode(() => {})
	await settle()

	expect(el.hasAttribute('data-cms-pending')).toBe(false)
	expect(el.contentEditable).not.toBe('true')
})

test('an unsaved edit stored for a pending element is resolved before wiring, and counts as a change', async () => {
	sessionStorage.clear()
	// Earlier tests leave their elements' changes behind.
	signals.pendingChanges.value = new Map()
	sessionStorage.setItem(
		'cms-pending-edits',
		JSON.stringify({ 'pending-id': { originalText: 'Text not resolved yet', newText: 'Edited', currentHTML: 'Edited', hasStyledContent: false } }),
	)
	const requests = servePendingManifest({ ...RESOLVED, sourceSnippet: '<p>Text not resolved yet</p>' })
	document.body.innerHTML = `<p data-cms-id="pending-id">Text not resolved yet</p>`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	expect(requests.filter(url => url.includes('resolve=pending-id'))).toHaveLength(1)
	expect(el.innerHTML).toBe('Edited')
	expect(el.contentEditable).toBe('true')
	expect(signals.dirtyChanges.value.map(([id]) => id)).toEqual(['pending-id'])
	sessionStorage.clear()
})

test('an answer computed before another one does not turn the entry that one wired back to pending', async () => {
	const pendingEntry = (id: string, text: string): CmsManifest['entries'][string] => ({ id, tag: 'p', text, pending: true })
	const resolvedEntry = (id: string, text: string): CmsManifest['entries'][string] => ({
		id,
		tag: 'p',
		text,
		sourcePath: 'src/pages/index.astro',
		sourceLine: 2,
		sourceSnippet: `<p>${text}</p>`,
	})
	const release: Record<string, () => void> = {}
	const answers: Record<string, Promise<Response>> = {
		// `a` was answered last, `b` first, while `a` was still pending on the server.
		a: new Promise(
			resolve => (release.a = () =>
				resolve(Response.json({ entries: { a: resolvedEntry('a', 'Alpha'), b: resolvedEntry('b', 'Beta') }, components: {} }))),
		),
		b: new Promise(
			resolve => (release.b = () =>
				resolve(Response.json({ entries: { a: pendingEntry('a', 'Alpha'), b: resolvedEntry('b', 'Beta') }, components: {} }))),
		),
	}
	const respond = async (input: RequestInfo | URL): Promise<Response> => {
		const resolve = new URL(input instanceof Request ? input.url : input.toString(), 'http://localhost').searchParams.get('resolve')
		const answer = resolve === null ? undefined : answers[resolve]
		return answer
			?? Response.json({ entries: { a: pendingEntry('a', 'Alpha'), b: pendingEntry('b', 'Beta') }, components: {}, componentDefinitions: {} })
	}
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign(respond, { preconnect: fetch.preconnect }))
	document.body.innerHTML = `<p data-cms-id="a">Alpha</p><p data-cms-id="b">Beta</p>`
	await startEditMode(mockConfig, () => {})

	const a = document.querySelector<HTMLElement>('[data-cms-id="a"]')!
	const b = document.querySelector<HTMLElement>('[data-cms-id="b"]')!
	a.dispatchEvent(new PointerEvent('pointerenter'))
	b.dispatchEvent(new PointerEvent('pointerenter'))
	release.a!()
	await settle()
	release.b!()
	await settle()

	expect(a.contentEditable).toBe('true')
	expect(b.contentEditable).toBe('true')
	expect(signals.manifest.value.entries.a?.pending).toBeUndefined()
	expect(signals.manifest.value.entries.a?.sourceSnippet).toBe('<p>Alpha</p>')
})

test('a pending element whose ask fails is locked instead of left waiting', async () => {
	const requests: string[] = []
	const respond = async (input: RequestInfo | URL): Promise<Response> => {
		const url = input instanceof Request ? input.url : input.toString()
		requests.push(url)
		if (url.includes('resolve=')) return new Response('failed', { status: 500 })
		return Response.json({
			entries: { 'pending-id': { id: 'pending-id', tag: 'p', text: 'Text not resolved yet', pending: true } },
			components: {},
			componentDefinitions: {},
		})
	}
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign(respond, { preconnect: fetch.preconnect }))
	spyOn(console, 'error').mockImplementation(() => {})
	document.body.innerHTML = `<p data-cms-id="pending-id">Text not resolved yet</p>`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	el.dispatchEvent(new PointerEvent('pointerenter'))
	await settle()

	expect(el.hasAttribute('data-cms-pending')).toBe(false)
	expect(el.getAttribute('data-cms-locked')).toBe('true')
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle()
	expect(requests.filter(url => url.includes('locate=pending-id'))).toHaveLength(1)
})

test('a click on a pending image opens the media library once the image is wired', async () => {
	signals.resetMediaLibraryState()
	servePendingManifest({ ...RESOLVED, tag: 'img', imageMetadata: { src: '/photo.webp', alt: 'Photo', srcSet: '' } })
	document.body.innerHTML = `<img data-cms-id="pending-id" data-cms-img src="/photo.webp" alt="Photo">`
	await startEditMode(mockConfig, () => {})

	const el = pendingElement()
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
	await settle()

	expect(el.hasAttribute('data-cms-pending')).toBe(false)
	expect(signals.mediaLibraryState.value.isOpen).toBe(true)
	signals.resetMediaLibraryState()
})
