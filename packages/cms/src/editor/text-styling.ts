/**
 * Text styling utilities for applying Tailwind classes to text selections.
 * Supports inline styling of partial text content within CMS elements.
 * Uses inline styles for immediate visual feedback.
 * CSS values can be overridden by AvailableTextStyles from the manifest.
 */

import type { AvailableTextStyles, TextStyleValue as ManifestTextStyleValue } from './types'

/**
 * Tailwind text style categories with their class mappings and CSS values.
 * These are fallback defaults when manifest styles are not available.
 */
export const TAILWIND_STYLES = {
	weight: {
		normal: { class: 'font-normal', label: 'Normal', css: { fontWeight: '400' } },
		medium: { class: 'font-medium', label: 'Medium', css: { fontWeight: '500' } },
		semibold: { class: 'font-semibold', label: 'Semibold', css: { fontWeight: '600' } },
		bold: { class: 'font-bold', label: 'Bold', css: { fontWeight: '700' } },
	},
	decoration: {
		none: { class: 'no-underline', label: 'None', css: { textDecoration: 'none' } },
		underline: { class: 'underline', label: 'Underline', css: { textDecoration: 'underline' } },
		lineThrough: { class: 'line-through', label: 'Strikethrough', css: { textDecoration: 'line-through' } },
	},
	style: {
		normal: { class: 'not-italic', label: 'Normal', css: { fontStyle: 'normal' } },
		italic: { class: 'italic', label: 'Italic', css: { fontStyle: 'italic' } },
	},
	color: {
		inherit: { class: 'text-inherit', label: 'Inherit', css: { color: 'inherit' } },
		slate: { class: 'text-slate-700', label: 'Slate', css: { color: '#334155' } },
		gray: { class: 'text-gray-700', label: 'Gray', css: { color: '#374151' } },
		red: { class: 'text-red-600', label: 'Red', css: { color: '#dc2626' } },
		orange: { class: 'text-orange-600', label: 'Orange', css: { color: '#ea580c' } },
		amber: { class: 'text-amber-600', label: 'Amber', css: { color: '#d97706' } },
		green: { class: 'text-green-600', label: 'Green', css: { color: '#16a34a' } },
		blue: { class: 'text-blue-600', label: 'Blue', css: { color: '#2563eb' } },
		purple: { class: 'text-purple-600', label: 'Purple', css: { color: '#9333ea' } },
	},
	highlight: {
		none: { class: '', label: 'None', css: { backgroundColor: 'transparent' } },
		yellow: { class: 'bg-yellow-200', label: 'Yellow', css: { backgroundColor: '#fef08a' } },
		green: { class: 'bg-green-200', label: 'Green', css: { backgroundColor: '#bbf7d0' } },
		blue: { class: 'bg-blue-200', label: 'Blue', css: { backgroundColor: '#bfdbfe' } },
		pink: { class: 'bg-pink-200', label: 'Pink', css: { backgroundColor: '#fbcfe8' } },
	},
	size: {
		xs: { class: 'text-xs', label: 'XS', css: { fontSize: '0.75rem', lineHeight: '1rem' } },
		sm: { class: 'text-sm', label: 'SM', css: { fontSize: '0.875rem', lineHeight: '1.25rem' } },
		base: { class: 'text-base', label: 'Base', css: { fontSize: '1rem', lineHeight: '1.5rem' } },
		lg: { class: 'text-lg', label: 'LG', css: { fontSize: '1.125rem', lineHeight: '1.75rem' } },
		xl: { class: 'text-xl', label: 'XL', css: { fontSize: '1.25rem', lineHeight: '1.75rem' } },
		'2xl': { class: 'text-2xl', label: '2XL', css: { fontSize: '1.5rem', lineHeight: '2rem' } },
	},
} as const

export type StyleCategory = keyof typeof TAILWIND_STYLES
export type StyleValue<C extends StyleCategory> = keyof (typeof TAILWIND_STYLES)[C]

export interface TextStyle {
	weight?: StyleValue<'weight'>
	decoration?: StyleValue<'decoration'>
	style?: StyleValue<'style'>
	color?: StyleValue<'color'>
	highlight?: StyleValue<'highlight'>
	size?: StyleValue<'size'>
}

export interface TextSelection {
	startOffset: number
	endOffset: number
	text: string
	range: Range
	anchorNode: Node
	focusNode: Node
}

/** Default values for each style category (no visual styling) */
const DEFAULT_VALUES: Record<StyleCategory, string> = {
	weight: 'normal',
	decoration: 'none',
	style: 'normal',
	color: 'inherit',
	highlight: 'none',
	size: 'base',
}

/** Pre-computed reverse lookup: class name -> { category, key } */
const CLASS_TO_STYLE_MAP = new Map<string, { category: StyleCategory; key: string }>()

// Build the reverse lookup map once at module load
for (const [category, values] of Object.entries(TAILWIND_STYLES)) {
	for (const [key, config] of Object.entries(values)) {
		if (config.class) {
			CLASS_TO_STYLE_MAP.set(config.class, { category: category as StyleCategory, key })
		}
	}
}

/** Set of all known styling classes for quick lookup */
const KNOWN_STYLE_CLASSES = new Set(CLASS_TO_STYLE_MAP.keys())

/**
 * Get the current text selection within a CMS element
 */
export function getTextSelection(cmsElement: HTMLElement): TextSelection | null {
	const selection = window.getSelection()
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
		return null
	}

	const range = selection.getRangeAt(0)

	// Check if selection is within the CMS element
	if (!cmsElement.contains(range.commonAncestorContainer)) {
		return null
	}

	const text = selection.toString()
	if (!text.trim()) {
		return null
	}

	const anchorNode = selection.anchorNode
	const focusNode = selection.focusNode
	if (!anchorNode || !focusNode) {
		return null
	}

	return {
		startOffset: range.startOffset,
		endOffset: range.endOffset,
		text,
		range,
		anchorNode,
		focusNode,
	}
}

/**
 * Build the class string from a TextStyle object
 */
export function buildStyleClasses(style: TextStyle): string {
	const classes: string[] = []

	for (const [category, value] of Object.entries(style)) {
		if (value === undefined) continue

		const defaultValue = DEFAULT_VALUES[category as StyleCategory]
		if (value === defaultValue) continue

		const styleConfig = TAILWIND_STYLES[category as StyleCategory]
		const config = styleConfig[value as keyof typeof styleConfig] as { class: string } | undefined
		if (config?.class) {
			classes.push(config.class)
		}
	}

	return classes.join(' ')
}

/**
 * Map style category to manifest property name
 */
const CATEGORY_TO_MANIFEST: Record<StyleCategory, keyof AvailableTextStyles | null> = {
	weight: 'fontWeight',
	size: 'fontSize',
	decoration: 'textDecoration',
	style: 'fontStyle',
	color: null, // Colors are handled separately via availableColors
	highlight: null, // Highlights are handled separately via availableColors
}

/**
 * Resolve CSS properties for a class name from the manifest.
 * Falls back to hardcoded TAILWIND_STYLES if not found in manifest.
 */
function resolveCssFromManifest(
	className: string,
	availableTextStyles: AvailableTextStyles | undefined,
): Record<string, string> | undefined {
	if (availableTextStyles) {
		// Check each category in the manifest
		for (const category of ['fontWeight', 'fontSize', 'textDecoration', 'fontStyle'] as const) {
			const styles = availableTextStyles[category]
			if (styles) {
				const found = styles.find(s => s.class === className)
				if (found) {
					return found.css
				}
			}
		}
	}
	return undefined
}

/**
 * Build inline CSS styles from a TextStyle object.
 * Uses manifest styles when available, falls back to hardcoded defaults.
 */
export function buildInlineStyles(
	style: TextStyle,
	availableTextStyles?: AvailableTextStyles,
): Record<string, string> {
	const cssStyles: Record<string, string> = {}

	for (const [category, value] of Object.entries(style)) {
		if (value === undefined) continue

		const styleConfig = TAILWIND_STYLES[category as StyleCategory]
		const config = styleConfig[value as keyof typeof styleConfig] as { class?: string; css?: Record<string, string> } | undefined

		if (config?.class) {
			// Try to resolve from manifest first
			const manifestCss = resolveCssFromManifest(config.class, availableTextStyles)
			if (manifestCss) {
				Object.assign(cssStyles, manifestCss)
			} else if (config.css) {
				// Fall back to hardcoded defaults
				Object.assign(cssStyles, config.css)
			}
		}
	}

	return cssStyles
}

/** Stored reference to available text styles for internal functions */
let _availableTextStyles: AvailableTextStyles | undefined

/**
 * Set the available text styles from manifest.
 * Call this when manifest is loaded.
 */
export function setAvailableTextStyles(styles: AvailableTextStyles | undefined): void {
	_availableTextStyles = styles
}

/**
 * Apply inline styles to an element from a TextStyle object
 */
function applyInlineStyles(element: HTMLElement, style: TextStyle): void {
	const cssStyles = buildInlineStyles(style, _availableTextStyles)
	for (const [property, value] of Object.entries(cssStyles)) {
		element.style[property as any] = value
	}
}

/**
 * Clear inline styles that correspond to text styling
 */
function clearTextInlineStyles(element: HTMLElement): void {
	element.style.fontWeight = ''
	element.style.textDecoration = ''
	element.style.fontStyle = ''
	element.style.color = ''
	element.style.backgroundColor = ''
	element.style.fontSize = ''
	element.style.lineHeight = ''
}

/**
 * Parse Tailwind classes from a class string back to TextStyle.
 * Uses O(n) lookup via pre-computed map instead of O(n*m) nested loops.
 */
export function parseStyleClasses(classString: string): TextStyle {
	if (!classString) return {}

	const classes = classString.split(/\s+/).filter(Boolean)
	const style: TextStyle = {}

	for (const cls of classes) {
		const mapping = CLASS_TO_STYLE_MAP.get(cls)
		if (mapping) {
			// Type-safe assignment using the mapping
			;(style as Record<string, string>)[mapping.category] = mapping.key
		}
	}

	return style
}

/**
 * Separate styling classes from non-styling classes
 */
export function separateClasses(classString: string): { styleClasses: string[]; otherClasses: string[] } {
	const classes = classString.split(/\s+/).filter(Boolean)
	const styleClasses: string[] = []
	const otherClasses: string[] = []

	for (const cls of classes) {
		if (KNOWN_STYLE_CLASSES.has(cls)) {
			styleClasses.push(cls)
		} else {
			otherClasses.push(cls)
		}
	}

	return { styleClasses, otherClasses }
}

/**
 * Check if an element is a styled span created by the CMS
 */
export function isStyledSpan(element: Element | null): element is HTMLElement {
	return element instanceof HTMLElement && element.hasAttribute('data-cms-styled')
}

/**
 * Create a new styled span element with both classes and inline styles
 */
function createStyledSpan(style: TextStyle): HTMLSpanElement {
	const span = document.createElement('span')
	span.setAttribute('data-cms-styled', 'true')
	const classString = buildStyleClasses(style)
	if (classString) {
		span.className = classString
	}
	// Apply inline styles for immediate visual feedback
	applyInlineStyles(span, style)
	return span
}

/**
 * Get the styled span element if the selection is entirely within one.
 * Returns null if selection spans multiple elements or is not in a styled span.
 */
export function getStyledSpanFromSelection(cmsElement: HTMLElement): HTMLElement | null {
	const selection = window.getSelection()
	if (!selection || selection.rangeCount === 0) {
		return null
	}

	const range = selection.getRangeAt(0)
	const container = range.commonAncestorContainer

	// Start from the container (or its parent if it's a text node)
	let currentElement: HTMLElement | null = container.nodeType === Node.TEXT_NODE
		? (container.parentElement as HTMLElement | null)
		: (container as HTMLElement)

	// Walk up the tree to find a styled span
	while (currentElement !== null && currentElement !== cmsElement) {
		if (currentElement.hasAttribute('data-cms-styled')) {
			return currentElement
		}
		currentElement = currentElement.parentElement
	}

	return null
}

/**
 * Remove styling from a styled span element, keeping only the text content.
 * Used to "unstyle" previously styled text.
 */
export function removeStyleFromElement(styledSpan: HTMLElement): void {
	const parent = styledSpan.parentNode
	if (!parent) return

	// Move all children out of the span
	while (styledSpan.firstChild) {
		parent.insertBefore(styledSpan.firstChild, styledSpan)
	}

	// Remove the now-empty span
	parent.removeChild(styledSpan)

	// Normalize to merge adjacent text nodes
	parent.normalize()
}

/**
 * Update styles on an existing styled span.
 * Preserves non-styling classes and applies inline styles for immediate feedback.
 */
export function updateStyledSpan(span: HTMLElement, newStyle: Partial<TextStyle>): void {
	const existingStyle = parseStyleClasses(span.className)
	const { otherClasses } = separateClasses(span.className)

	// Merge new style with existing
	const mergedStyle = { ...existingStyle, ...newStyle }

	// Build new class string
	const newStyleClasses = buildStyleClasses(mergedStyle)

	if (newStyleClasses || otherClasses.length > 0) {
		span.className = [...otherClasses, newStyleClasses].filter(Boolean).join(' ')
		// Clear existing inline styles and reapply
		clearTextInlineStyles(span)
		applyInlineStyles(span, mergedStyle)
	} else {
		// No styles left, remove the span wrapper
		removeStyleFromElement(span)
	}
}

/**
 * Flatten nested styled spans into a single span with merged styles.
 * Processes the fragment recursively.
 */
function flattenStyledSpans(fragment: DocumentFragment, targetSpan: HTMLSpanElement): void {
	const processNode = (node: Node): void => {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const htmlElement = node as HTMLElement

			if (htmlElement.hasAttribute('data-cms-styled')) {
				// Merge classes from nested styled span
				const nestedStyle = parseStyleClasses(htmlElement.className)
				const currentStyle = parseStyleClasses(targetSpan.className)
				// Nested span's styles take precedence
				const mergedStyle = { ...currentStyle, ...nestedStyle }
				targetSpan.className = buildStyleClasses(mergedStyle) || ''
				// Apply inline styles for immediate visual feedback
				clearTextInlineStyles(targetSpan)
				applyInlineStyles(targetSpan, mergedStyle)

				// Recursively process children of the nested span
				const children = Array.from(htmlElement.childNodes) as ChildNode[]
				for (const child of children) {
					processNode(child)
				}
			} else {
				// Clone the element (without children) and process children recursively
				const clonedElement = htmlElement.cloneNode(false) as HTMLElement
				const children = Array.from(htmlElement.childNodes) as ChildNode[]
				for (const child of children) {
					// For regular elements, we need to keep their structure
					if (child.nodeType === Node.ELEMENT_NODE) {
						const childElement = child as HTMLElement
						if (childElement.hasAttribute('data-cms-styled')) {
							// Flatten nested styled spans within regular elements
							const innerChildren = Array.from(childElement.childNodes) as ChildNode[]
							for (const innerChild of innerChildren) {
								clonedElement.appendChild(innerChild.cloneNode(true))
							}
							// Merge styles
							const nestedStyle = parseStyleClasses(childElement.className)
							const currentStyle = parseStyleClasses(targetSpan.className)
							const mergedStyle = { ...currentStyle, ...nestedStyle }
							targetSpan.className = buildStyleClasses(mergedStyle) || ''
							// Apply inline styles
							clearTextInlineStyles(targetSpan)
							applyInlineStyles(targetSpan, mergedStyle)
						} else {
							clonedElement.appendChild(child.cloneNode(true))
						}
					} else {
						clonedElement.appendChild(child.cloneNode(true))
					}
				}
				targetSpan.appendChild(clonedElement)
			}
		} else {
			// Text nodes and other node types - just append
			targetSpan.appendChild(node.cloneNode(true))
		}
	}

	// Process all children of the fragment
	const nodes = Array.from(fragment.childNodes) as ChildNode[]
	for (const node of nodes) {
		processNode(node)
	}
}

/**
 * Check if two elements are directly adjacent (no meaningful content between them)
 */
function isDirectlyAdjacent(first: Element, second: Element): boolean {
	let node: Node | null = first.nextSibling

	while (node && node !== second) {
		if (node.nodeType === Node.TEXT_NODE) {
			// Only whitespace is allowed between
			if (node.textContent && node.textContent.trim() !== '') {
				return false
			}
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			return false
		}
		node = node.nextSibling
	}

	return node === second
}

/**
 * Remove empty styled spans from the element
 */
export function cleanupEmptyStyledSpans(cmsElement: HTMLElement): void {
	const styledSpans = Array.from(cmsElement.querySelectorAll('[data-cms-styled]'))

	for (const span of styledSpans) {
		if (!span.textContent && !span.querySelector('*')) {
			span.remove()
		}
	}
}

/**
 * Merge adjacent styled spans that have the same classes
 */
export function mergeAdjacentStyledSpans(cmsElement: HTMLElement): void {
	let styledSpans = Array.from(cmsElement.querySelectorAll('[data-cms-styled]'))
	let merged = true

	// Keep merging until no more merges are possible
	while (merged) {
		merged = false
		styledSpans = Array.from(cmsElement.querySelectorAll('[data-cms-styled]'))

		for (let i = 0; i < styledSpans.length - 1; i++) {
			const current = styledSpans[i] as HTMLElement
			const next = styledSpans[i + 1] as HTMLElement

			if (!current.parentNode || !next.parentNode) continue

			// Check if they are truly adjacent (no significant content between them)
			const isAdjacent = isDirectlyAdjacent(current, next)

			if (isAdjacent && current.className === next.className) {
				// Move all children from next to current
				while (next.firstChild) {
					current.appendChild(next.firstChild)
				}
				// Remove the empty next span
				next.remove()
				merged = true
				break // Restart the loop after merging
			}
		}
	}

	// Clean up empty styled spans
	cleanupEmptyStyledSpans(cmsElement)

	cmsElement.normalize()
}

/**
 * Wrap selected text in a span with Tailwind classes.
 * If the selection is already inside a styled span, just update that span's classes.
 * Returns the styled span element or null if failed.
 */
export function wrapSelectionWithStyle(cmsElement: HTMLElement, selection: TextSelection, style: TextStyle): HTMLSpanElement | null {
	const classString = buildStyleClasses(style)

	// Check if we're already inside a styled span
	const existingSpan = getStyledSpanFromSelection(cmsElement)
	if (existingSpan) {
		// Check if we're selecting the entire span content
		const selectionRange = selection.range
		const spanRange = document.createRange()
		spanRange.selectNodeContents(existingSpan)

		const isFullSelection = selectionRange.compareBoundaryPoints(Range.START_TO_START, spanRange) === 0
			&& selectionRange.compareBoundaryPoints(Range.END_TO_END, spanRange) === 0

		if (isFullSelection) {
			// Update the entire span's styles
			updateStyledSpan(existingSpan, style)
			return existingSpan
		}

		// Partial selection within existing span - need to split
		return splitAndStyleSelection(cmsElement, existingSpan, selection, style)
	}

	if (!classString) {
		return null
	}

	try {
		// Create the wrapper span
		const span = createStyledSpan(style)

		// Extract the selected content and wrap it
		const contents = selection.range.extractContents()

		// Flatten any nested styled spans from the extracted content
		flattenStyledSpans(contents, span)

		selection.range.insertNode(span)

		// Normalize the parent to merge adjacent text nodes
		cmsElement.normalize()

		// Merge adjacent styled spans with same classes
		mergeAdjacentStyledSpans(cmsElement)

		return span
	} catch (error) {
		console.error('[CMS] Failed to wrap selection:', error)
		return null
	}
}

/**
 * Handle partial selection within an existing styled span by splitting it
 */
function splitAndStyleSelection(
	cmsElement: HTMLElement,
	existingSpan: HTMLElement,
	selection: TextSelection,
	newStyle: TextStyle,
): HTMLSpanElement | null {
	try {
		const range = selection.range
		const existingStyle = parseStyleClasses(existingSpan.className)

		// Create a range for the content before the selection
		const beforeRange = document.createRange()
		beforeRange.setStart(existingSpan, 0)
		beforeRange.setEnd(range.startContainer, range.startOffset)

		// Create a range for the content after the selection
		const afterRange = document.createRange()
		afterRange.setStart(range.endContainer, range.endOffset)
		afterRange.setEndAfter(existingSpan.lastChild || existingSpan)

		// Extract contents
		const beforeContents = beforeRange.extractContents()
		const selectedContents = range.extractContents()
		const afterContents = afterRange.extractContents()

		// Get parent for insertion
		const parent = existingSpan.parentNode
		if (!parent) return null

		// Create spans for each section
		const beforeSpan = beforeContents.textContent?.trim() || beforeContents.querySelector('*')
			? createStyledSpan(existingStyle)
			: null

		const selectedSpan = createStyledSpan({ ...existingStyle, ...newStyle })

		const afterSpan = afterContents.textContent?.trim() || afterContents.querySelector('*')
			? createStyledSpan(existingStyle)
			: null

		// Populate spans
		if (beforeSpan) {
			beforeSpan.appendChild(beforeContents)
		}
		selectedSpan.appendChild(selectedContents)
		if (afterSpan) {
			afterSpan.appendChild(afterContents)
		}

		// Insert new spans before the existing one
		if (beforeSpan) parent.insertBefore(beforeSpan, existingSpan)
		parent.insertBefore(selectedSpan, existingSpan)
		if (afterSpan) parent.insertBefore(afterSpan, existingSpan)

		// Remove the original span
		existingSpan.remove()

		// Cleanup and merge
		cleanupEmptyStyledSpans(cmsElement)
		mergeAdjacentStyledSpans(cmsElement)
		cmsElement.normalize()

		return selectedSpan
	} catch (error) {
		console.error('[CMS] Failed to split and style selection:', error)
		return null
	}
}

/**
 * Apply a specific style category to the current selection.
 * This is a convenience function for single-style application.
 */
export function applyStyleToSelection<C extends StyleCategory>(
	cmsElement: HTMLElement,
	category: C,
	value: StyleValue<C>,
): HTMLSpanElement | null {
	const selection = getTextSelection(cmsElement)
	if (!selection) {
		return null
	}

	const style: TextStyle = { [category]: value }
	return wrapSelectionWithStyle(cmsElement, selection, style)
}

/**
 * Toggle a style value on the selection or styled element.
 * If the style is already applied, it removes it; otherwise applies it.
 */
export function toggleStyle<C extends StyleCategory>(cmsElement: HTMLElement, category: C, value: StyleValue<C>): HTMLSpanElement | null {
	const styledSpan = getStyledSpanFromSelection(cmsElement)

	if (styledSpan) {
		const currentStyle = parseStyleClasses(styledSpan.className)
		const currentValue = currentStyle[category] as string | undefined

		// Check if this exact value is already applied
		if (currentValue === value) {
			// Remove this style (set to default)
			const defaultValue = DEFAULT_VALUES[category]
			updateStyledSpan(styledSpan, { [category]: defaultValue } as TextStyle)
			return null
		} else {
			// Update to the new value
			updateStyledSpan(styledSpan, { [category]: value } as TextStyle)
			return styledSpan
		}
	}

	// No existing styled span, create a new one
	return applyStyleToSelection(cmsElement, category, value)
}

/**
 * Check if a specific style is currently applied to the selection
 */
export function hasStyle<C extends StyleCategory>(cmsElement: HTMLElement, category: C, value: StyleValue<C>): boolean {
	const styledSpan = getStyledSpanFromSelection(cmsElement)
	if (!styledSpan) {
		return false
	}

	const currentStyle = parseStyleClasses(styledSpan.className)
	const currentValue = currentStyle[category] as string | undefined
	return currentValue === value
}

/**
 * Get the current style of the selection
 */
export function getCurrentStyle(cmsElement: HTMLElement): TextStyle {
	const styledSpan = getStyledSpanFromSelection(cmsElement)
	if (!styledSpan) {
		return {}
	}
	return parseStyleClasses(styledSpan.className)
}

/**
 * Remove all styling from the current selection
 */
export function clearAllStyles(cmsElement: HTMLElement): void {
	const styledSpan = getStyledSpanFromSelection(cmsElement)
	if (styledSpan) {
		removeStyleFromElement(styledSpan)
	}
}

/**
 * Check if a style value is valid for a given category
 */
export function isValidStyleValue<C extends StyleCategory>(category: C, value: unknown): value is StyleValue<C> {
	const categoryStyles = TAILWIND_STYLES[category]
	return typeof value === 'string' && value in categoryStyles
}

/**
 * Get the default value for a style category
 */
export function getDefaultValue(category: StyleCategory): string {
	return DEFAULT_VALUES[category]
}

/**
 * Get all Tailwind classes used for text styling.
 */
export function getAllStyleClasses(): string[] {
	return Array.from(KNOWN_STYLE_CLASSES)
}
