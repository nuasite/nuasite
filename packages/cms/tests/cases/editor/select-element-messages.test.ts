import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
// Importing the editor starts it, as on a page: the widget renders into the document.
import '../../../src/editor/index'
import { isSelectMode, selectModeElement, setManifest } from '../../../src/editor/signals'
import type { CmsManifest, CmsPostMessage } from '../../../src/types'

// What the host reads as the user's selection: `cms-element-selected` for the element picked with
// Select Element, `cms-element-deselected` once it is let go. Hovering is not a selection.

const MANIFEST: CmsManifest = {
	entries: {
		'title': { id: 'title', tag: 'h1', text: 'Hello', sourcePath: 'src/pages/index.astro', sourceLine: 3 },
		'claim': { id: 'claim', tag: 'p', text: 'Claim', sourcePath: 'src/pages/index.astro', sourceLine: 4 },
	},
	components: {},
	componentDefinitions: {},
}

let posted: Array<'cms-element-selected' | 'cms-element-deselected'> = []
/** Pathnames of `cms-page-navigated`: a host drops the selection on each. */
let navigated: string[] = []
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')

/** Point the widget at another page, as a navigation does. */
function setPageUrl(url: string): void {
	Object.defineProperty(window, 'location', { value: new URL(url), configurable: true, writable: true })
}
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')
const originalElementsFromPoint = document.elementsFromPoint

beforeAll(() => {
	setPageUrl('http://localhost/')
	Object.defineProperty(window, 'parent', {
		value: {
			postMessage: (message: CmsPostMessage) => {
				if (message.type === 'cms-element-selected' || message.type === 'cms-element-deselected') posted.push(message.type)
				if (message.type === 'cms-page-navigated') navigated.push(message.page.pathname)
			},
		},
		configurable: true,
	})
})

// The widget is unmounted again, so its document listeners do not reach the files run after this one.
afterAll(() => {
	const appRoot = document.getElementById('cms-app-host')?.shadowRoot?.getElementById('cms-app-root')
	if (appRoot) render(null, appRoot)
	document.getElementById('cms-app-host')?.remove()
	document.querySelectorAll('[data-cms-id]').forEach(el => el.remove())
	selectModeElement.value = null
	isSelectMode.value = false
	if (originalParent) Object.defineProperty(window, 'parent', originalParent)
	document.elementsFromPoint = originalElementsFromPoint
	if (originalLocation) Object.defineProperty(window, 'location', originalLocation)
})

beforeEach(async () => {
	document.querySelectorAll('[data-cms-id]').forEach(el => el.remove())
	document.body.insertAdjacentHTML('beforeend', '<h1 data-cms-id="title">Hello</h1><p data-cms-id="claim">Claim</p>')
	await act(() => {
		setManifest(MANIFEST)
		selectModeElement.value = null
		isSelectMode.value = true
	})
	posted = []
	navigated = []
})

const element = (cmsId: string): HTMLElement => {
	const el = document.querySelector<HTMLElement>(`[data-cms-id="${cmsId}"]`)
	if (!el) throw new Error(`no element ${cmsId}`)
	return el
}

/** Move the pointer over an element, as the outline's hit test sees it. */
const hover = async (el: HTMLElement) => {
	document.elementsFromPoint = () => [el]
	await act(() => {
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
	})
}

test('hovering in select mode reports no selection', async () => {
	await hover(element('title'))
	await hover(element('claim'))
	expect(posted).toEqual([])
})

test('a picked element stays selected for the host after the hover outline goes away', async () => {
	await hover(element('title'))
	await act(() => {
		element('title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	})
	await hover(element('claim'))

	expect(selectModeElement.value?.id).toBe('title')
	expect(posted).toEqual(['cms-element-selected'])
})

test('letting the picked element go deselects it for the host', async () => {
	await hover(element('title'))
	await act(() => {
		element('title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	})
	await act(() => {
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
	})

	expect(posted).toEqual(['cms-element-selected', 'cms-element-deselected'])
})

test('after the host lets the picked element go, picking it again selects it again', async () => {
	await hover(element('title'))
	await act(() => {
		element('title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	})
	await act(async () => {
		window.dispatchEvent(new MessageEvent('message', { data: { type: 'cms-deselect-element' } }))
	})
	expect(selectModeElement.value).toBeNull()

	await hover(element('title'))
	await act(() => {
		element('title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	})
	expect(posted).toEqual(['cms-element-selected', 'cms-element-deselected', 'cms-element-selected'])
})

test('hovering and picking an element is no page navigation', async () => {
	await hover(element('title'))
	await act(() => {
		element('title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	})
	await hover(element('claim'))
	expect(navigated).toEqual([])
})

test('a manifest reload for the same page is no navigation, a load for another page is one', async () => {
	await act(() => setManifest({ ...MANIFEST }))
	expect(navigated).toEqual([])

	setPageUrl('http://localhost/other')
	await act(() => setManifest({ ...MANIFEST }))
	await act(() => setManifest({ ...MANIFEST }))
	expect(navigated).toEqual(['/other'])
})

test('a View Transitions navigation lets the picked element go', async () => {
	await hover(element('title'))
	await act(() => {
		element('title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	})
	await act(() => {
		document.dispatchEvent(new Event('astro:after-swap'))
	})
	expect(selectModeElement.value).toBeNull()
	expect(posted).toEqual(['cms-element-selected', 'cms-element-deselected'])
})
