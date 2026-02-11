import {
	clearAllHighlights,
	clearElementHighlight,
	destroyHighlightContainer,
	initHighlightContainer,
	setElementHighlight,
} from './components/highlight-overlay'
import { CSS } from './constants'
import type { ChildCmsElement } from './types'

/**
 * Parse an rgb/rgba color string into r, g, b components.
 */
function parseRgb(color: string): { r: number; g: number; b: number } | null {
	const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
	if (!match) return null
	return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
}

/**
 * Calculate relative luminance of an sRGB color (0 = black, 1 = white).
 */
function relativeLuminance(r: number, g: number, b: number): number {
	const toLinear = (c: number) => {
		const s = c / 255
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * Detect whether the page has a dark background by checking the computed
 * background color of the body and html elements.
 */
export function isPageDark(): boolean {
	if (typeof document === 'undefined') return false
	for (const el of [document.body, document.documentElement]) {
		if (!el) continue
		const bg = getComputedStyle(el).backgroundColor
		if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue
		const parsed = parseRgb(bg)
		if (parsed) return relativeLuminance(parsed.r, parsed.g, parsed.b) < 0.4
	}
	return false
}

/**
 * Get an outline color that contrasts with the page background.
 */
export function getOutlineColor(): string {
	return isPageDark() ? '#FFFFFF' : '#1A1A1A'
}

/** Style element for contenteditable focus styles injected into the host page */
let focusStyleElement: HTMLStyleElement | null = null

/**
 * Get the best CMS element at a specific position using elementsFromPoint.
 * This is more reliable than using event.target for nested elements.
 *
 * @param x - clientX position
 * @param y - clientY position
 * @param manifestEntries - Optional manifest entries to filter by
 */
export function getCmsElementAtPosition(
	x: number,
	y: number,
	manifestEntries?: Record<string, any>,
): HTMLElement | null {
	const elementsAtPoint = document.elementsFromPoint(x, y)

	// First pass: find the deepest CMS element that is editable
	// We prioritize elements that have contentEditable="true" and are in the manifest
	for (const el of elementsAtPoint) {
		if (!(el instanceof HTMLElement)) continue
		if (!el.hasAttribute(CSS.ID_ATTRIBUTE)) continue
		// Skip component roots - they should be handled separately
		if (el.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) continue

		const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)

		// If we have manifest entries, only return elements that are in it
		if (manifestEntries && cmsId && !manifestEntries[cmsId]) {
			continue
		}

		// Check if the element is actually editable
		if (el.contentEditable === 'true') {
			return el
		}
	}

	// Second pass: find any CMS element (even if not editable yet)
	// This handles the case where we're hovering before edit mode is fully set up
	for (const el of elementsAtPoint) {
		if (!(el instanceof HTMLElement)) continue
		if (!el.hasAttribute(CSS.ID_ATTRIBUTE)) continue
		if (el.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) continue

		const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)

		if (manifestEntries && cmsId && !manifestEntries[cmsId]) {
			continue
		}

		return el
	}

	return null
}

/**
 * Get a component element at a specific position.
 * Only returns component roots (elements with data-cms-component-id).
 */
export function getComponentAtPosition(x: number, y: number): HTMLElement | null {
	const elementsAtPoint = document.elementsFromPoint(x, y)

	for (const el of elementsAtPoint) {
		if (!(el instanceof HTMLElement)) continue
		if (el.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) {
			return el
		}
	}

	return null
}

/**
 * Check if a point is near the edge of an element's bounding rect.
 * Used to only trigger component selection when hovering near borders.
 */
export function isNearElementEdge(x: number, y: number, rect: DOMRect, threshold: number = 24): boolean {
	// Check if point is within the rect at all
	if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
		return false
	}

	// Check if near any edge
	const nearLeft = x - rect.left < threshold
	const nearRight = rect.right - x < threshold
	const nearTop = y - rect.top < threshold
	const nearBottom = rect.bottom - y < threshold

	return nearLeft || nearRight || nearTop || nearBottom
}

export function getCmsElementFromEvent(ev: MouseEvent): HTMLElement | null {
	const target = ev.target
	if (!(target instanceof HTMLElement)) return null
	const el = target.closest(`[${CSS.ID_ATTRIBUTE}]`)
	if (!el || !(el instanceof HTMLElement)) return null
	return el
}

/**
 * Check if an element is a CMS-styled span (inline text styling)
 */
export function isStyledSpan(element: HTMLElement): boolean {
	return element.hasAttribute('data-cms-styled')
}

/**
 * Helper function to recursively extract plain text from child nodes,
 * replacing CMS elements with their placeholders.
 * Note: This returns plain text only - for styled content, use innerHTML directly.
 */
function extractTextFromChildNodes(parentNode: HTMLElement): string {
	let text = ''

	parentNode.childNodes.forEach(node => {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.nodeValue || ''
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as HTMLElement
			const tagName = element.tagName.toLowerCase()

			// Preserve <br> tags as-is (textContent strips them)
			if (tagName === 'br') {
				text += '<br>'
				return
			}

			const directCmsId = element.getAttribute(CSS.ID_ATTRIBUTE)

			if (directCmsId) {
				// Element has CMS ID - replace with placeholder
				text += `{{cms:${directCmsId}}}`
			} else {
				// For all other elements (including styled spans), just get their text content
				text += element.textContent || ''
			}
		}
	})

	return text
}

/**
 * Extract plain text content from a CMS element.
 * Styled spans are reduced to their text content (not HTML).
 * Nested CMS elements are replaced with {{cms:id}} placeholders.
 */
export function getEditableTextFromElement(el: HTMLElement): string {
	return extractTextFromChildNodes(el).trim()
}

/**
 * Get the HTML content of a CMS element suitable for saving.
 * Preserves styled spans but cleans up editing artifacts.
 */
export function getEditableHtmlFromElement(el: HTMLElement): string {
	const clone = el.cloneNode(true) as HTMLElement

	// Remove contenteditable attribute
	clone.removeAttribute('contenteditable')

	// Clean up any editing-only attributes but keep styled spans
	clone.querySelectorAll('[contenteditable]').forEach(child => {
		child.removeAttribute('contenteditable')
	})

	return clone.innerHTML
}

export function getChildCmsElements(el: HTMLElement): ChildCmsElement[] {
	return Array.from(el.querySelectorAll(`[${CSS.ID_ATTRIBUTE}]`)).map(child => ({
		id: child.getAttribute(CSS.ID_ATTRIBUTE) || '',
		placeholder: `__CMS_CHILD_${child.getAttribute(CSS.ID_ATTRIBUTE)}__`,
	}))
}

export function findInnermostCmsElement(target: EventTarget | null): HTMLElement | null {
	if (!target || !(target instanceof HTMLElement)) return null

	let element: HTMLElement | null = target

	while (element && element !== document.body) {
		if (element.hasAttribute(CSS.ID_ATTRIBUTE) && element.contentEditable === 'true') {
			return element
		}
		element = element.parentElement
	}

	return null
}

export function getAllCmsElements(): NodeListOf<HTMLElement> {
	return document.querySelectorAll(`[${CSS.ID_ATTRIBUTE}]`)
}

export function makeElementEditable(el: HTMLElement): void {
	el.contentEditable = 'true'
}

export function makeElementNonEditable(el: HTMLElement): void {
	el.contentEditable = 'false'
}

/**
 * Set highlight outline on an element using Shadow DOM overlay.
 * This doesn't modify the element's styles directly.
 */
export function setElementOutline(el: HTMLElement, color: string, style: 'solid' | 'dashed' = 'solid'): void {
	setElementHighlight(el, color, style)
}

/**
 * Clear highlight from an element
 */
export function clearElementOutline(el: HTMLElement): void {
	clearElementHighlight(el)
}

/**
 * Initialize the highlight system (call when starting edit mode)
 */
export function initHighlightSystem(): void {
	initHighlightContainer()
	injectFocusStyles()
}

/**
 * Clean up all highlights (call when stopping edit mode)
 */
export function cleanupHighlightSystem(): void {
	clearAllHighlights()
	destroyHighlightContainer()
	removeFocusStyles()
}

/**
 * Inject styles into the host page to replace the browser's default
 * blue focus outline on contenteditable CMS elements with a subtle,
 * on-brand indicator.
 */
function injectFocusStyles(): void {
	if (focusStyleElement) return
	const dark = isPageDark()
	const focusColor = dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(26, 26, 26, 0.15)'
	focusStyleElement = document.createElement('style')
	focusStyleElement.id = 'cms-focus-styles'
	focusStyleElement.textContent = `
		[contenteditable="true"][data-cms-id]:focus {
			outline: 2px solid ${focusColor};
			outline-offset: 6px;
			border-radius: 4px;
		}
	`
	document.head.appendChild(focusStyleElement)
}

/**
 * Remove injected focus styles from the host page.
 */
function removeFocusStyles(): void {
	if (focusStyleElement) {
		focusStyleElement.remove()
		focusStyleElement = null
	}
}

export function logDebug(debug: boolean, ...args: any[]): void {
	if (!debug) return
	console.debug('[CMS]', ...args)
}

/**
 * Disable all interactive elements (links, buttons, forms) to prevent
 * accidental navigation or form submission while in edit mode.
 */
export function disableAllInteractiveElements(): void {
	// Disable links
	const links = document.querySelectorAll('a')
	links.forEach(link => {
		link.setAttribute('data-cms-disabled', 'true')
		link.addEventListener('click', preventInteraction, true)
	})

	// Disable buttons (submit, button, reset)
	const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"]')
	buttons.forEach(button => {
		button.setAttribute('data-cms-disabled', 'true')
		button.addEventListener('click', preventInteraction, true)
	})

	// Disable form submissions
	const forms = document.querySelectorAll('form')
	forms.forEach(form => {
		form.setAttribute('data-cms-disabled', 'true')
		form.addEventListener('submit', preventInteraction, true)
	})
}

/**
 * Re-enable all interactive elements that were disabled.
 */
export function enableAllInteractiveElements(): void {
	// Re-enable links
	const links = document.querySelectorAll('a[data-cms-disabled]')
	links.forEach(link => {
		link.removeAttribute('data-cms-disabled')
		link.removeEventListener('click', preventInteraction, true)
	})

	// Re-enable buttons
	const buttons = document.querySelectorAll('button[data-cms-disabled], input[data-cms-disabled]')
	buttons.forEach(button => {
		button.removeAttribute('data-cms-disabled')
		button.removeEventListener('click', preventInteraction, true)
	})

	// Re-enable forms
	const forms = document.querySelectorAll('form[data-cms-disabled]')
	forms.forEach(form => {
		form.removeAttribute('data-cms-disabled')
		form.removeEventListener('submit', preventInteraction, true)
	})
}

/**
 * @deprecated Use disableAllInteractiveElements instead
 */
export function disableAllLinks(): void {
	disableAllInteractiveElements()
}

/**
 * @deprecated Use enableAllInteractiveElements instead
 */
export function enableAllLinks(): void {
	enableAllInteractiveElements()
}

function preventInteraction(event: Event): void {
	const target = event.currentTarget as HTMLElement
	if (target.hasAttribute('data-cms-disabled')) {
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
	}
}
