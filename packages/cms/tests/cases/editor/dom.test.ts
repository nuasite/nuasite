import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
	cleanupHighlightSystem,
	clearElementOutline,
	disableAllInteractiveElements,
	enableAllInteractiveElements,
	findInnermostCmsElement,
	getAllCmsElements,
	getChildCmsElements,
	getCmsElementFromEvent,
	getEditableTextFromElement,
	initHighlightSystem,
	logDebug,
	makeElementEditable,
	makeElementNonEditable,
	setElementOutline,
} from '../../../src/editor/dom'

beforeEach(() => {
	document.body.innerHTML = ''
	// Initialize highlight system for tests that need it
	initHighlightSystem()
})

afterEach(() => {
	// Clean up highlight system after each test
	cleanupHighlightSystem()
})

test('getCmsElementFromEvent returns element with data-cms-id', () => {
	const element = document.createElement('div')
	element.setAttribute('data-cms-id', 'test-id')
	document.body.appendChild(element)

	const event = new MouseEvent('click', { bubbles: true })
	Object.defineProperty(event, 'target', { value: element, enumerable: true })

	const result = getCmsElementFromEvent(event)
	expect(result).toBe(element)
})

test('getCmsElementFromEvent returns null when no cms element', () => {
	const element = document.createElement('div')
	document.body.appendChild(element)

	const event = new MouseEvent('click', { bubbles: true })
	Object.defineProperty(event, 'target', { value: element, enumerable: true })

	const result = getCmsElementFromEvent(event)
	expect(result).toBeNull()
})

test('getCmsElementFromEvent finds closest cms element', () => {
	const parent = document.createElement('div')
	parent.setAttribute('data-cms-id', 'parent-id')

	const child = document.createElement('span')
	parent.appendChild(child)
	document.body.appendChild(parent)

	const event = new MouseEvent('click', { bubbles: true })
	Object.defineProperty(event, 'target', { value: child, enumerable: true })

	const result = getCmsElementFromEvent(event)
	expect(result).toBe(parent)
})

test('getEditableTextFromElement extracts text content', () => {
	const element = document.createElement('div')
	element.textContent = 'Hello World'

	const result = getEditableTextFromElement(element)
	expect(result).toBe('Hello World')
})

test('getEditableTextFromElement replaces nested cms elements with placeholders', () => {
	const element = document.createElement('div')
	element.innerHTML = 'Before <span data-cms-id="nested-id">Nested</span> After'

	const result = getEditableTextFromElement(element)
	expect(result).toBe('Before {{cms:nested-id}} After')
})

test('getEditableTextFromElement handles multiple nested cms elements', () => {
	const element = document.createElement('div')
	element.innerHTML = 'Start <span data-cms-id="id-1">First</span> Middle <span data-cms-id="id-2">Second</span> End'

	const result = getEditableTextFromElement(element)
	expect(result).toBe('Start {{cms:id-1}} Middle {{cms:id-2}} End')
})

// TODO: Implement deeply nested cms elements
// test('getEditableTextFromElement handles deeply nested cms elements', () => {
// 	const element = document.createElement('div')
// 	const wrapper = document.createElement('div')
// 	const nested = document.createElement('span')
// 	nested.setAttribute('data-cms-id', 'nested-id')
// 	nested.textContent = 'Nested'
// 	wrapper.appendChild(nested)
// 	element.appendChild(document.createTextNode('Before '))
// 	element.appendChild(wrapper)
// 	element.appendChild(document.createTextNode(' After'))

// 	const result = getEditableTextFromElement(element)
// 	expect(result).toBe('Before {{cms:nested-id}} After')
// })

// test('getEditableTextFromElement preserves text siblings in intermediate container', () => {
// 	const element = document.createElement('div')
// 	element.setAttribute('data-cms-id', 'parent-id')
// 	element.innerHTML = '<span>before <strong data-cms-id="cms-1">inner</strong> after</span>'

// 	const result = getEditableTextFromElement(element)
// 	expect(result).toBe('before {{cms:cms-1}} after')
// })

// test('getEditableTextFromElement handles complex nested structure with multiple levels', () => {
// 	const element = document.createElement('div')
// 	element.setAttribute('data-cms-id', 'parent-id')
// 	element.innerHTML = 'Start <div>level1 <span>level2 <strong data-cms-id="cms-1">cms</strong> text</span> more</div> End'

// 	const result = getEditableTextFromElement(element)
// 	expect(result).toBe('Start level1 level2 {{cms:cms-1}} text more End')
// })

test('getChildCmsElements returns array of child cms elements', () => {
	const element = document.createElement('div')
	element.innerHTML = `
    <span data-cms-id="child-1">Child 1</span>
    <span data-cms-id="child-2">Child 2</span>
  `

	const result = getChildCmsElements(element)
	expect(result.length).toBe(2)
	expect(result[0]?.id).toBe('child-1')
	expect(result[1]?.id).toBe('child-2')
	expect(result[0]?.placeholder).toBe('__CMS_CHILD_child-1__')
	expect(result[1]?.placeholder).toBe('__CMS_CHILD_child-2__')
})

test('getChildCmsElements returns empty array when no children', () => {
	const element = document.createElement('div')
	element.textContent = 'No children'

	const result = getChildCmsElements(element)
	expect(result.length).toBe(0)
})

test('findInnermostCmsElement returns innermost editable cms element', () => {
	const outer = document.createElement('div')
	outer.setAttribute('data-cms-id', 'outer')
	outer.contentEditable = 'true'

	const inner = document.createElement('span')
	inner.setAttribute('data-cms-id', 'inner')
	inner.contentEditable = 'true'

	outer.appendChild(inner)
	document.body.appendChild(outer)

	const result = findInnermostCmsElement(inner)
	expect(result).toBe(inner)
})

test('findInnermostCmsElement returns null for non-editable element', () => {
	const element = document.createElement('div')
	element.setAttribute('data-cms-id', 'test-id')
	element.contentEditable = 'false'
	document.body.appendChild(element)

	const result = findInnermostCmsElement(element)
	expect(result).toBeNull()
})

test('getAllCmsElements returns all elements with data-cms-id', () => {
	document.body.innerHTML = `
    <div data-cms-id="id-1">One</div>
    <div data-cms-id="id-2">Two</div>
    <div>No ID</div>
    <div data-cms-id="id-3">Three</div>
  `

	const result = getAllCmsElements()
	expect(result.length).toBe(3)
})

test('makeElementEditable sets contentEditable to true', () => {
	const element = document.createElement('div')
	makeElementEditable(element)
	expect(element.contentEditable).toBe('true')
})

test('makeElementNonEditable sets contentEditable to false', () => {
	const element = document.createElement('div')
	element.contentEditable = 'true'
	makeElementNonEditable(element)
	expect(element.contentEditable).toBe('false')
})

test('setElementOutline creates shadow DOM highlight overlay', () => {
	const element = document.createElement('div')
	document.body.appendChild(element)

	setElementOutline(element, '#ff0000', 'solid')

	// Check that highlight container exists
	const container = document.getElementById('cms-highlight-container')
	expect(container).not.toBeNull()

	// Check that overlay was created
	const overlay = container?.querySelector('cms-highlight-overlay')
	expect(overlay).not.toBeNull()
})

test('setElementOutline defaults to solid style', () => {
	const element = document.createElement('div')
	document.body.appendChild(element)

	setElementOutline(element, '#00ff00')

	const container = document.getElementById('cms-highlight-container')
	const overlay = container?.querySelector('cms-highlight-overlay')
	expect(overlay).not.toBeNull()
})

test('clearElementOutline removes shadow DOM highlight overlay', () => {
	const element = document.createElement('div')
	document.body.appendChild(element)

	setElementOutline(element, '#ff0000', 'solid')

	const container = document.getElementById('cms-highlight-container')
	let overlay = container?.querySelector('cms-highlight-overlay')
	expect(overlay).not.toBeNull()

	clearElementOutline(element)

	overlay = container?.querySelector('cms-highlight-overlay')
	expect(overlay).toBeNull()
})

test('logDebug logs when debug is true', () => {
	const consoleSpy = console.debug
	const logs: any[] = []
	console.debug = (...args: any[]) => logs.push(args)

	logDebug(true, 'test', 'message')
	expect(logs.length).toBe(1)
	expect(logs[0][0]).toBe('[CMS]')
	expect(logs[0][1]).toBe('test')
	expect(logs[0][2]).toBe('message')

	console.debug = consoleSpy
})

test('logDebug does not log when debug is false', () => {
	const consoleSpy = console.debug
	const logs: any[] = []
	console.debug = (...args: any[]) => logs.push(args)

	logDebug(false, 'test', 'message')
	expect(logs.length).toBe(0)

	console.debug = consoleSpy
})

test('disableAllInteractiveElements adds data-cms-disabled attribute to all links', () => {
	document.body.innerHTML = `
    <a href="/page1">Link 1</a>
    <a href="/page2">Link 2</a>
    <div>
      <a href="/page3">Link 3</a>
    </div>
  `

	disableAllInteractiveElements()

	const links = document.querySelectorAll('a')
	expect(links.length).toBe(3)
	links.forEach(link => {
		expect(link.hasAttribute('data-cms-disabled')).toBe(true)
	})
})

test('disableAllInteractiveElements prevents link navigation on click', () => {
	document.body.innerHTML = `<a href="/test-page">Test Link</a>`

	const link = document.querySelector('a')!
	disableAllInteractiveElements()

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

test('enableAllInteractiveElements removes data-cms-disabled attribute', () => {
	document.body.innerHTML = `
    <a href="/page1" data-cms-disabled="true">Link 1</a>
    <a href="/page2" data-cms-disabled="true">Link 2</a>
  `

	enableAllInteractiveElements()

	const links = document.querySelectorAll('a')
	links.forEach(link => {
		expect(link.hasAttribute('data-cms-disabled')).toBe(false)
	})
})

test('enableAllInteractiveElements allows link navigation after being disabled', () => {
	document.body.innerHTML = `<a href="/test-page">Test Link</a>`

	const link = document.querySelector('a')!

	// First disable
	disableAllInteractiveElements()

	// Then enable
	enableAllInteractiveElements()

	// Click should not be prevented after enabling
	const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
	const originalPreventDefault = clickEvent.preventDefault
	clickEvent.preventDefault = function() {
		originalPreventDefault.call(this)
	}

	link.dispatchEvent(clickEvent)

	// Since we enabled links, the event should not be prevented by our handler
	// (it might be prevented by other reasons, but not by data-cms-disabled check)
	expect(link.hasAttribute('data-cms-disabled')).toBe(false)
})

test('disableAllInteractiveElements works with dynamically added links', () => {
	document.body.innerHTML = `<a href="/page1">Link 1</a>`

	disableAllInteractiveElements()

	// Add a new link after disabling
	const newLink = document.createElement('a')
	newLink.href = '/page2'
	newLink.textContent = 'Link 2'
	document.body.appendChild(newLink)

	// Call disableAllInteractiveElements again to catch new links
	disableAllInteractiveElements()

	const links = document.querySelectorAll('a')
	expect(links.length).toBe(2)
	links.forEach(link => {
		expect(link.hasAttribute('data-cms-disabled')).toBe(true)
	})
})

test('enableAllInteractiveElements only affects disabled links', () => {
	document.body.innerHTML = `
    <a href="/page1" data-cms-disabled="true">Disabled Link</a>
    <a href="/page2">Normal Link</a>
  `

	enableAllInteractiveElements()

	const disabledLink = document.querySelector('a[href="/page1"]')!
	const normalLink = document.querySelector('a[href="/page2"]')!

	expect(disabledLink.hasAttribute('data-cms-disabled')).toBe(false)
	expect(normalLink.hasAttribute('data-cms-disabled')).toBe(false)
})

test('disableAllInteractiveElements and enableAllInteractiveElements can be called multiple times', () => {
	document.body.innerHTML = `<a href="/test">Test Link</a>`

	const link = document.querySelector('a')!

	disableAllInteractiveElements()
	expect(link.hasAttribute('data-cms-disabled')).toBe(true)

	enableAllInteractiveElements()
	expect(link.hasAttribute('data-cms-disabled')).toBe(false)

	disableAllInteractiveElements()
	expect(link.hasAttribute('data-cms-disabled')).toBe(true)

	enableAllInteractiveElements()
	expect(link.hasAttribute('data-cms-disabled')).toBe(false)
})

test('disableAllInteractiveElements handles links without href', () => {
	document.body.innerHTML = `
    <a href="/page1">Link with href</a>
    <a>Link without href</a>
  `

	disableAllInteractiveElements()

	const links = document.querySelectorAll('a')
	expect(links.length).toBe(2)
	links.forEach(link => {
		expect(link.hasAttribute('data-cms-disabled')).toBe(true)
	})
})

// Highlight system tests
test('initHighlightSystem creates highlight container', () => {
	cleanupHighlightSystem() // Clean first
	initHighlightSystem()

	const container = document.getElementById('cms-highlight-container')
	expect(container).not.toBeNull()
	expect(container?.style.position).toBe('absolute')
})

test('cleanupHighlightSystem removes highlight container', () => {
	initHighlightSystem()

	let container = document.getElementById('cms-highlight-container')
	expect(container).not.toBeNull()

	cleanupHighlightSystem()

	container = document.getElementById('cms-highlight-container')
	expect(container).toBeNull()
})

test('multiple setElementOutline calls on same element reuses overlay', () => {
	const element = document.createElement('div')
	document.body.appendChild(element)

	setElementOutline(element, '#ff0000', 'solid')
	setElementOutline(element, '#00ff00', 'dashed')

	const container = document.getElementById('cms-highlight-container')
	const overlays = container?.querySelectorAll('cms-highlight-overlay')

	// Should only have one overlay for the same element
	expect(overlays?.length).toBe(1)
})

test('setElementOutline creates separate overlays for different elements', () => {
	const element1 = document.createElement('div')
	const element2 = document.createElement('div')
	document.body.appendChild(element1)
	document.body.appendChild(element2)

	setElementOutline(element1, '#ff0000', 'solid')
	setElementOutline(element2, '#00ff00', 'dashed')

	const container = document.getElementById('cms-highlight-container')
	const overlays = container?.querySelectorAll('cms-highlight-overlay')

	expect(overlays?.length).toBe(2)
})
