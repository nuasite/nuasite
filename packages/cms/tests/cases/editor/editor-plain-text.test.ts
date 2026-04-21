import { afterEach, beforeEach, expect, test } from 'bun:test'
import { insertPlainTextAtRange, startEditMode, stopEditMode } from '../../../src/editor/editor'
import type { CmsConfig, CmsManifest } from '../../../src/editor/types'

const mockConfig: CmsConfig = {
	apiBase: '/_nua/cms',
	highlightColor: '#005AE0',
	debug: false,
}

const mockManifest: CmsManifest = {
	entries: {
		'styleable': {
			id: 'styleable',
			tag: 'p',
			text: 'plain body text',
			sourcePath: '/test.astro',
			sourceLine: 1,
		},
		'non-styleable': {
			id: 'non-styleable',
			tag: 'meta',
			text: 'attribute value',
			sourcePath: '/test.astro',
			sourceLine: 1,
			allowStyling: false,
			variableName: 'description',
		},
	},
	components: {},
	componentDefinitions: {},
}

beforeEach(() => {
	document.body.innerHTML = ''
	Object.defineProperty(window, 'location', {
		value: { pathname: '/', href: 'http://localhost/' },
		writable: true,
	})
	;(global as any).fetch = async (url: string | Request) => {
		const urlStr = url.toString()
		if (urlStr.includes('/cms-manifest.json') || urlStr.includes('/index.json')) {
			return new Response(JSON.stringify(mockManifest), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}
		return new Response('Not found', { status: 404 })
	}
})

afterEach(() => {
	document.body.innerHTML = ''
	stopEditMode(() => {})
})

function dispatchBeforeInput(el: HTMLElement, inputType: string): boolean {
	const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent
	Object.defineProperty(event, 'inputType', { value: inputType })
	return el.dispatchEvent(event)
}

function makeClipboardEvent(html: string, text: string): Event {
	const event = new Event('paste', { bubbles: true, cancelable: true })
	Object.defineProperty(event, 'clipboardData', {
		value: {
			getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : ''),
		},
	})
	return event
}

function makeDragEvent(type: string, html: string, text: string, clientX = 0, clientY = 0): Event {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(event, 'dataTransfer', {
		value: {
			getData: (t: string) => (t === 'text/html' ? html : t === 'text/plain' ? text : ''),
		},
	})
	Object.defineProperty(event, 'clientX', { value: clientX })
	Object.defineProperty(event, 'clientY', { value: clientY })
	return event
}

test('insertPlainTextAtRange inserts text at the caret and collapses to the end', () => {
	document.body.innerHTML = '<div id="target">Hello world</div>'
	const target = document.getElementById('target')!
	const range = document.createRange()
	// Place caret after "Hello "
	range.setStart(target.firstChild!, 6)
	range.collapse(true)

	const ok = insertPlainTextAtRange(range, 'bold ')
	expect(ok).toBe(true)
	expect(target.textContent).toBe('Hello bold world')
})

test('insertPlainTextAtRange returns false for empty text', () => {
	document.body.innerHTML = '<div id="target">Hello</div>'
	const target = document.getElementById('target')!
	const range = document.createRange()
	range.selectNodeContents(target)
	expect(insertPlainTextAtRange(range, '')).toBe(false)
	expect(target.textContent).toBe('Hello')
})

test('insertPlainTextAtRange replaces selected content', () => {
	document.body.innerHTML = '<div id="target">Hello world</div>'
	const target = document.getElementById('target')!
	const range = document.createRange()
	// Select "world"
	range.setStart(target.firstChild!, 6)
	range.setEnd(target.firstChild!, 11)

	insertPlainTextAtRange(range, 'universe')
	expect(target.textContent).toBe('Hello universe')
})

test('format shortcuts are blocked on non-styleable elements', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">attribute value</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	const allowed = dispatchBeforeInput(el, 'formatBold')
	// dispatchEvent returns false when preventDefault was called
	expect(allowed).toBe(false)
})

test('format shortcuts are NOT blocked on styleable elements', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">plain body text</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const allowed = dispatchBeforeInput(el, 'formatBold')
	expect(allowed).toBe(true)
})

test('insertText is never blocked, even on non-styleable elements', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">attribute value</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	const allowed = dispatchBeforeInput(el, 'insertText')
	expect(allowed).toBe(true)
})

test('paste on non-styleable element strips HTML and inserts plain text', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	// Place caret at end of content
	const range = document.createRange()
	range.selectNodeContents(el)
	range.collapse(false)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)

	el.dispatchEvent(makeClipboardEvent('<b>world</b>', ' world'))

	expect(el.innerHTML).not.toContain('<b>')
	expect(el.textContent).toBe('hello world')
})

test('paste on styleable element is NOT intercepted', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">plain body text</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const event = makeClipboardEvent('<b>bold</b>', 'bold')
	el.dispatchEvent(event)

	// Our handler isn't attached, so defaultPrevented stays false
	expect(event.defaultPrevented).toBe(false)
})

test('drop on non-styleable element strips HTML and inserts plain text', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	// Pre-position caret at end so the drop-point fallback lands there
	const range = document.createRange()
	range.selectNodeContents(el)
	range.collapse(false)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)

	const event = makeDragEvent('drop', '<b>world</b>', ' world')
	el.dispatchEvent(event)

	expect(el.innerHTML).not.toContain('<b>')
	expect(el.textContent).toContain(' world')
})

test('drop on styleable element is NOT intercepted', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">plain body text</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const event = makeDragEvent('drop', '<b>bold</b>', 'bold')
	el.dispatchEvent(event)

	expect(event.defaultPrevented).toBe(false)
})

test('drop with HTML-only payload (no text/plain) still dispatches input so editor state resyncs', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	let inputFired = false
	el.addEventListener('input', () => {
		inputFired = true
	})

	const event = makeDragEvent('drop', '<b>stripped</b>', '')
	el.dispatchEvent(event)

	expect(event.defaultPrevented).toBe(true)
	expect(inputFired).toBe(true)
	expect(el.textContent).toBe('hello')
})
