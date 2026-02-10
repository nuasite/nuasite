import { afterEach, beforeEach, expect, test } from 'bun:test'
import { startEditMode, stopEditMode } from '../../../src/editor/editor'
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
		},
		components: {},
		componentDefinitions: {},
	} satisfies CmsManifest

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
