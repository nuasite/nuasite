import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getEditableTextFromElement } from '../../../src/editor/dom'
import { _resetToastThrottles, collapseToSingleLine, insertPlainTextAtRange, startEditMode, stopEditMode } from '../../../src/editor/editor'
import * as signals from '../../../src/editor/signals'
import { STRINGS } from '../../../src/editor/strings'
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
	// Toast throttles are module-level timestamps, so without this a toast raised in one
	// test suppresses the next test's for 3s of wall clock and assertions become order-dependent.
	signals.toasts.value = []
	_resetToastThrottles()
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

test('paste on styleable element is intercepted and inserts plain text', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">plain body text</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const range = document.createRange()
	range.selectNodeContents(el)
	range.collapse(false)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)

	const event = makeClipboardEvent('<b>bold</b>', ' bold')
	el.dispatchEvent(event)

	// Native paste would insert <div>/<br> for multi-line clipboards, so it is intercepted here too
	expect(event.defaultPrevented).toBe(true)
	expect(el.innerHTML).not.toContain('<b>')
	expect(el.textContent).toBe('plain body text bold')
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

test('drop on styleable element is intercepted and strips HTML', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">plain body text</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const range = document.createRange()
	range.selectNodeContents(el)
	range.collapse(false)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)

	const event = makeDragEvent('drop', '<b>bold</b>', ' bold')
	el.dispatchEvent(event)

	expect(event.defaultPrevented).toBe(true)
	expect(el.innerHTML).not.toContain('<b>')
	expect(el.textContent).toBe('plain body text bold')
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

test('collapseToSingleLine flattens CRLF, LF and lone CR into single spaces', () => {
	expect(collapseToSingleLine('one\r\ntwo')).toBe('one two')
	expect(collapseToSingleLine('one\ntwo')).toBe('one two')
	expect(collapseToSingleLine('one\rtwo')).toBe('one two')
	// U+2028/U+2029 are line terminators too — clipboards from PDFs and older Mac apps carry them
	expect(collapseToSingleLine('one\u2028two')).toBe('one two')
	expect(collapseToSingleLine('one\u2029two')).toBe('one two')
	expect(collapseToSingleLine('one \u2028\r\n two')).toBe('one two')
	// Blank lines and the whitespace hugging them collapse to a single space
	expect(collapseToSingleLine('one\n\n\ntwo')).toBe('one two')
	expect(collapseToSingleLine('one  \r\n\t two')).toBe('one two')
	// Single-line text is untouched
	expect(collapseToSingleLine('one two')).toBe('one two')
	expect(collapseToSingleLine('')).toBe('')
})

test('insertPlainTextAtRange collapses pasted line breaks instead of inserting them', () => {
	document.body.innerHTML = '<div id="target">Hello</div>'
	const target = document.getElementById('target')!
	const range = document.createRange()
	range.selectNodeContents(target)
	range.collapse(false)

	expect(insertPlainTextAtRange(range, ' one\r\ntwo\nthree')).toBe(true)
	expect(target.textContent).toBe('Hello one two three')
	expect(target.textContent).not.toContain('\n')
	expect(target.textContent).not.toContain('\r')
})

test('insertPlainTextAtRange turns a bare line break into a space', () => {
	document.body.innerHTML = '<div id="target">Hello</div>'
	const target = document.getElementById('target')!
	const range = document.createRange()
	range.selectNodeContents(target)
	range.collapse(false)

	// Collapsing '\n' yields ' ', which is still a meaningful insert
	expect(insertPlainTextAtRange(range, '\n')).toBe(true)
	expect(target.textContent).toBe('Hello ')
})

// Windows clipboards carry \r\n, so multi-line pastes from Word/Notepad/Outlook are the
// common way line breaks reached the source before paste was intercepted.
test('multi-line CRLF paste into a non-styleable field writes no newlines', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	const range = document.createRange()
	range.selectNodeContents(el)
	range.collapse(false)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)

	el.dispatchEvent(makeClipboardEvent('', ' one\r\ntwo\nthree'))

	expect(el.textContent).toBe('hello one two three')
	expect(getEditableTextFromElement(el)).toBe('hello one two three')
	expect(el.innerHTML).not.toContain('\n')
	expect(el.innerHTML).not.toContain('\r')
})

test('multi-line CRLF paste into a styleable field produces no <br> markup', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">hello</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const range = document.createRange()
	range.selectNodeContents(el)
	range.collapse(false)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)

	el.dispatchEvent(makeClipboardEvent('<p>one</p><p>two</p>', ' one\r\ntwo'))

	// getEditableTextFromElement converts <br> and block elements into literal '<br>' —
	// the markup that used to reach the .astro source verbatim
	expect(getEditableTextFromElement(el)).toBe('hello one two')
	expect(el.innerHTML).not.toContain('<br>')
	expect(el.innerHTML).not.toContain('<p>')
})

// A clipboard carrying only an image/file has neither flavor. Falling through to the browser
// would drop an <img> into the element and the source writer would persist it, so the paste
// stays prevented — but it must say so rather than looking like it silently failed.
test('paste with neither text nor HTML stays prevented and explains itself', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">hello</p>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="styleable"]') as HTMLElement

	const event = makeClipboardEvent('', '')
	el.dispatchEvent(event)

	expect(event.defaultPrevented).toBe(true)
	expect(el.innerHTML).toBe('hello')
	expect(signals.toasts.value.map(t => t.message)).toContain(STRINGS.editor.unsupportedPaste)
})

test('empty paste on a non-styleable element is also prevented and explained', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	const event = makeClipboardEvent('', '')
	el.dispatchEvent(event)

	expect(event.defaultPrevented).toBe(true)
	expect(el.innerHTML).toBe('hello')
	expect(signals.toasts.value.map(t => t.message)).toContain(STRINGS.editor.unsupportedPaste)
})

test('stripping HTML toasts on non-styleable elements but stays quiet on styleable ones', async () => {
	document.body.innerHTML = `<p data-cms-id="styleable">hello</p><span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})

	const styleable = document.querySelector('[data-cms-id="styleable"]') as HTMLElement
	styleable.dispatchEvent(makeClipboardEvent('<b>x</b>', ' x'))
	// Virtually every clipboard carries a text/html flavor, so toasting here would fire on
	// every ordinary paste
	expect(signals.toasts.value.map(t => t.message)).not.toContain(STRINGS.editor.formattingBlocked)

	const nonStyleable = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement
	nonStyleable.dispatchEvent(makeClipboardEvent('<b>x</b>', ' x'))
	expect(signals.toasts.value.map(t => t.message)).toContain(STRINGS.editor.formattingBlocked)
})

test('stopEditMode detaches the plain-text listeners via AbortController', async () => {
	document.body.innerHTML = `<span data-cms-id="non-styleable">hello</span>`
	await startEditMode(mockConfig, () => {})
	const el = document.querySelector('[data-cms-id="non-styleable"]') as HTMLElement

	stopEditMode(() => {})

	// After stopEditMode, the paste handler should no longer preventDefault
	const pasteEvent = makeClipboardEvent('<b>world</b>', ' world')
	el.dispatchEvent(pasteEvent)
	expect(pasteEvent.defaultPrevented).toBe(false)

	// And format beforeinput should no longer be blocked
	const allowed = dispatchBeforeInput(el, 'formatBold')
	expect(allowed).toBe(true)
})
