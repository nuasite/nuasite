import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	buildStyleClasses,
	cleanupEmptyStyledSpans,
	getDefaultValue,
	getStyledSpanFromSelection,
	getTextSelection,
	isStyledSpan,
	isValidStyleValue,
	mergeAdjacentStyledSpans,
	parseStyleClasses,
	removeStyleFromElement,
	separateClasses,
	TAILWIND_STYLES,
	type TextStyle,
	updateStyledSpan,
	wrapSelectionWithStyle,
} from '../../../src/editor/text-styling'

beforeEach(() => {
	document.body.innerHTML = ''
})

afterEach(() => {
	document.body.innerHTML = ''
	// Clear any lingering selections
	window.getSelection()?.removeAllRanges()
})

// ============================================================================
// parseStyleClasses tests
// ============================================================================

describe('parseStyleClasses', () => {
	test('parses empty string to empty object', () => {
		const result = parseStyleClasses('')
		expect(result).toEqual({})
	})

	test('parses single weight class', () => {
		const result = parseStyleClasses('font-bold')
		expect(result).toEqual({ weight: 'bold' })
	})

	test('parses single decoration class', () => {
		const result = parseStyleClasses('underline')
		expect(result).toEqual({ decoration: 'underline' })
	})

	test('parses single style class', () => {
		const result = parseStyleClasses('italic')
		expect(result).toEqual({ style: 'italic' })
	})

	test('parses single color class', () => {
		const result = parseStyleClasses('text-red-600')
		expect(result).toEqual({ color: 'red' })
	})

	test('parses single highlight class', () => {
		const result = parseStyleClasses('bg-yellow-200')
		expect(result).toEqual({ highlight: 'yellow' })
	})

	test('parses single size class', () => {
		const result = parseStyleClasses('text-lg')
		expect(result).toEqual({ size: 'lg' })
	})

	test('parses multiple classes', () => {
		const result = parseStyleClasses('font-bold italic underline text-red-600 bg-yellow-200 text-lg')
		expect(result).toEqual({
			weight: 'bold',
			style: 'italic',
			decoration: 'underline',
			color: 'red',
			highlight: 'yellow',
			size: 'lg',
		})
	})

	test('ignores unknown classes', () => {
		const result = parseStyleClasses('font-bold custom-class another-class')
		expect(result).toEqual({ weight: 'bold' })
	})

	test('handles whitespace correctly', () => {
		const result = parseStyleClasses('  font-bold   italic  ')
		expect(result).toEqual({ weight: 'bold', style: 'italic' })
	})

	test('handles all weight variants', () => {
		expect(parseStyleClasses('font-normal')).toEqual({ weight: 'normal' })
		expect(parseStyleClasses('font-medium')).toEqual({ weight: 'medium' })
		expect(parseStyleClasses('font-semibold')).toEqual({ weight: 'semibold' })
		expect(parseStyleClasses('font-bold')).toEqual({ weight: 'bold' })
	})

	test('handles all color variants', () => {
		expect(parseStyleClasses('text-inherit')).toEqual({ color: 'inherit' })
		expect(parseStyleClasses('text-slate-700')).toEqual({ color: 'slate' })
		expect(parseStyleClasses('text-gray-700')).toEqual({ color: 'gray' })
		expect(parseStyleClasses('text-red-600')).toEqual({ color: 'red' })
		expect(parseStyleClasses('text-orange-600')).toEqual({ color: 'orange' })
		expect(parseStyleClasses('text-amber-600')).toEqual({ color: 'amber' })
		expect(parseStyleClasses('text-green-600')).toEqual({ color: 'green' })
		expect(parseStyleClasses('text-blue-600')).toEqual({ color: 'blue' })
		expect(parseStyleClasses('text-purple-600')).toEqual({ color: 'purple' })
	})
})

// ============================================================================
// buildStyleClasses tests
// ============================================================================

describe('buildStyleClasses', () => {
	test('returns empty string for empty style', () => {
		const result = buildStyleClasses({})
		expect(result).toBe('')
	})

	test('returns empty string for default values', () => {
		const result = buildStyleClasses({
			weight: 'normal',
			decoration: 'none',
			style: 'normal',
			color: 'inherit',
			highlight: 'none',
			size: 'base',
		})
		expect(result).toBe('')
	})

	test('builds single weight class', () => {
		const result = buildStyleClasses({ weight: 'bold' })
		expect(result).toBe('font-bold')
	})

	test('builds single decoration class', () => {
		const result = buildStyleClasses({ decoration: 'underline' })
		expect(result).toBe('underline')
	})

	test('builds multiple classes', () => {
		const result = buildStyleClasses({
			weight: 'bold',
			style: 'italic',
			decoration: 'underline',
		})
		// Classes should be present (order may vary)
		expect(result).toContain('font-bold')
		expect(result).toContain('italic')
		expect(result).toContain('underline')
	})

	test('skips undefined values', () => {
		const result = buildStyleClasses({
			weight: 'bold',
			style: undefined,
		})
		expect(result).toBe('font-bold')
	})

	test('skips highlight none (empty class)', () => {
		const result = buildStyleClasses({
			weight: 'bold',
			highlight: 'none',
		})
		expect(result).toBe('font-bold')
	})
})

// ============================================================================
// separateClasses tests
// ============================================================================

describe('separateClasses', () => {
	test('separates styling from non-styling classes', () => {
		const result = separateClasses('font-bold custom-class italic another-class')
		expect(result.styleClasses).toContain('font-bold')
		expect(result.styleClasses).toContain('italic')
		expect(result.otherClasses).toContain('custom-class')
		expect(result.otherClasses).toContain('another-class')
	})

	test('handles only styling classes', () => {
		const result = separateClasses('font-bold italic underline')
		expect(result.styleClasses).toHaveLength(3)
		expect(result.otherClasses).toHaveLength(0)
	})

	test('handles only non-styling classes', () => {
		const result = separateClasses('custom-class another-class')
		expect(result.styleClasses).toHaveLength(0)
		expect(result.otherClasses).toHaveLength(2)
	})

	test('handles empty string', () => {
		const result = separateClasses('')
		expect(result.styleClasses).toHaveLength(0)
		expect(result.otherClasses).toHaveLength(0)
	})
})

// ============================================================================
// isStyledSpan tests
// ============================================================================

describe('isStyledSpan', () => {
	test('returns true for element with data-cms-styled attribute', () => {
		const span = document.createElement('span')
		span.setAttribute('data-cms-styled', 'true')
		expect(isStyledSpan(span)).toBe(true)
	})

	test('returns false for element without data-cms-styled attribute', () => {
		const span = document.createElement('span')
		expect(isStyledSpan(span)).toBe(false)
	})

	test('returns false for null', () => {
		expect(isStyledSpan(null)).toBe(false)
	})

	test('returns false for non-HTMLElement', () => {
		const text = document.createTextNode('test')
		expect(isStyledSpan(text as unknown as Element)).toBe(false)
	})
})

// ============================================================================
// isValidStyleValue tests
// ============================================================================

describe('isValidStyleValue', () => {
	test('returns true for valid weight value', () => {
		expect(isValidStyleValue('weight', 'bold')).toBe(true)
		expect(isValidStyleValue('weight', 'normal')).toBe(true)
		expect(isValidStyleValue('weight', 'medium')).toBe(true)
	})

	test('returns false for invalid weight value', () => {
		expect(isValidStyleValue('weight', 'bolder')).toBe(false)
		expect(isValidStyleValue('weight', 'invalid')).toBe(false)
	})

	test('returns true for valid color value', () => {
		expect(isValidStyleValue('color', 'red')).toBe(true)
		expect(isValidStyleValue('color', 'inherit')).toBe(true)
	})

	test('returns false for invalid color value', () => {
		expect(isValidStyleValue('color', 'pink')).toBe(false)
		expect(isValidStyleValue('color', '#ff0000')).toBe(false)
	})

	test('returns false for non-string value', () => {
		expect(isValidStyleValue('weight', 123)).toBe(false)
		expect(isValidStyleValue('weight', null)).toBe(false)
		expect(isValidStyleValue('weight', undefined)).toBe(false)
	})
})

// ============================================================================
// getDefaultValue tests
// ============================================================================

describe('getDefaultValue', () => {
	test('returns correct default for weight', () => {
		expect(getDefaultValue('weight')).toBe('normal')
	})

	test('returns correct default for decoration', () => {
		expect(getDefaultValue('decoration')).toBe('none')
	})

	test('returns correct default for style', () => {
		expect(getDefaultValue('style')).toBe('normal')
	})

	test('returns correct default for color', () => {
		expect(getDefaultValue('color')).toBe('inherit')
	})

	test('returns correct default for highlight', () => {
		expect(getDefaultValue('highlight')).toBe('none')
	})

	test('returns correct default for size', () => {
		expect(getDefaultValue('size')).toBe('base')
	})
})

// ============================================================================
// DOM-based tests
// ============================================================================

describe('removeStyleFromElement', () => {
	test('removes styled span and preserves text content', () => {
		const container = document.createElement('div')
		container.innerHTML = 'Before <span data-cms-styled="true" class="font-bold">styled text</span> After'
		document.body.appendChild(container)

		const styledSpan = container.querySelector('[data-cms-styled]') as HTMLElement
		removeStyleFromElement(styledSpan)

		expect(container.innerHTML).toBe('Before styled text After')
		expect(container.querySelector('[data-cms-styled]')).toBeNull()
	})

	test('preserves nested elements within styled span', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold"><strong>bold</strong> text</span>'
		document.body.appendChild(container)

		const styledSpan = container.querySelector('[data-cms-styled]') as HTMLElement
		removeStyleFromElement(styledSpan)

		expect(container.innerHTML).toBe('<strong>bold</strong> text')
	})

	test('handles empty styled span', () => {
		const container = document.createElement('div')
		container.innerHTML = 'Before <span data-cms-styled="true" class="font-bold"></span> After'
		document.body.appendChild(container)

		const styledSpan = container.querySelector('[data-cms-styled]') as HTMLElement
		removeStyleFromElement(styledSpan)

		expect(container.innerHTML).toBe('Before  After')
	})
})

describe('updateStyledSpan', () => {
	test('updates existing style', () => {
		const span = document.createElement('span')
		span.setAttribute('data-cms-styled', 'true')
		span.className = 'font-bold'

		const container = document.createElement('div')
		container.appendChild(span)
		span.textContent = 'text'
		document.body.appendChild(container)

		updateStyledSpan(span, { style: 'italic' })

		expect(span.className).toContain('font-bold')
		expect(span.className).toContain('italic')
	})

	test('preserves non-styling classes', () => {
		const span = document.createElement('span')
		span.setAttribute('data-cms-styled', 'true')
		span.className = 'font-bold custom-class'

		const container = document.createElement('div')
		container.appendChild(span)
		span.textContent = 'text'
		document.body.appendChild(container)

		updateStyledSpan(span, { style: 'italic' })

		expect(span.className).toContain('custom-class')
		expect(span.className).toContain('font-bold')
		expect(span.className).toContain('italic')
	})

	test('removes span when no styles remain', () => {
		const container = document.createElement('div')
		const span = document.createElement('span')
		span.setAttribute('data-cms-styled', 'true')
		span.className = 'font-bold'
		span.textContent = 'text'
		container.appendChild(span)
		document.body.appendChild(container)

		// Set weight to default (normal) - which removes the class
		updateStyledSpan(span, { weight: 'normal' })

		// Span should be removed since no styles remain
		expect(container.querySelector('[data-cms-styled]')).toBeNull()
		expect(container.textContent).toBe('text')
	})
})

describe('cleanupEmptyStyledSpans', () => {
	test('removes empty styled spans', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true"></span>Content<span data-cms-styled="true">has text</span>'
		document.body.appendChild(container)

		cleanupEmptyStyledSpans(container)

		const styledSpans = container.querySelectorAll('[data-cms-styled]')
		expect(styledSpans.length).toBe(1)
		expect(styledSpans[0]!.textContent).toBe('has text')
	})

	test('keeps styled spans with nested elements', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true"><img src="test.png" /></span>'
		document.body.appendChild(container)

		cleanupEmptyStyledSpans(container)

		expect(container.querySelectorAll('[data-cms-styled]').length).toBe(1)
	})
})

describe('mergeAdjacentStyledSpans', () => {
	test('merges adjacent spans with same classes', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">Hello</span><span data-cms-styled="true" class="font-bold"> World</span>'
		document.body.appendChild(container)

		mergeAdjacentStyledSpans(container)

		const styledSpans = container.querySelectorAll('[data-cms-styled]')
		expect(styledSpans.length).toBe(1)
		expect(styledSpans[0]!.textContent).toBe('Hello World')
	})

	test('does not merge spans with different classes', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">Hello</span><span data-cms-styled="true" class="italic"> World</span>'
		document.body.appendChild(container)

		mergeAdjacentStyledSpans(container)

		const styledSpans = container.querySelectorAll('[data-cms-styled]')
		expect(styledSpans.length).toBe(2)
	})

	test('merges spans separated by whitespace-only text nodes', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">Hello</span>   <span data-cms-styled="true" class="font-bold">World</span>'
		document.body.appendChild(container)

		mergeAdjacentStyledSpans(container)

		const styledSpans = container.querySelectorAll('[data-cms-styled]')
		expect(styledSpans.length).toBe(1)
	})

	test('does not merge spans separated by text content', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">Hello</span>middle<span data-cms-styled="true" class="font-bold">World</span>'
		document.body.appendChild(container)

		mergeAdjacentStyledSpans(container)

		const styledSpans = container.querySelectorAll('[data-cms-styled]')
		expect(styledSpans.length).toBe(2)
	})
})

// ============================================================================
// Selection-based tests (require mocking window.getSelection)
// ============================================================================

describe('getTextSelection', () => {
	test('returns null when no selection', () => {
		const container = document.createElement('div')
		container.textContent = 'Test content'
		document.body.appendChild(container)

		const result = getTextSelection(container)
		expect(result).toBeNull()
	})

	test('returns null for collapsed selection', () => {
		const container = document.createElement('div')
		container.textContent = 'Test content'
		document.body.appendChild(container)

		// Create a collapsed selection
		const range = document.createRange()
		range.setStart(container.firstChild!, 0)
		range.collapse(true)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const result = getTextSelection(container)
		expect(result).toBeNull()
	})

	test('returns null for selection outside element', () => {
		const container = document.createElement('div')
		container.textContent = 'Test content'
		document.body.appendChild(container)

		const outside = document.createElement('div')
		outside.textContent = 'Outside content'
		document.body.appendChild(outside)

		// Select text in the outside element
		const range = document.createRange()
		range.selectNodeContents(outside)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const result = getTextSelection(container)
		expect(result).toBeNull()
	})

	test('returns selection info for valid selection within element', () => {
		const container = document.createElement('div')
		container.textContent = 'Test content'
		document.body.appendChild(container)

		// Select "Test"
		const range = document.createRange()
		range.setStart(container.firstChild!, 0)
		range.setEnd(container.firstChild!, 4)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const result = getTextSelection(container)
		expect(result).not.toBeNull()
		expect(result?.text).toBe('Test')
		expect(result?.startOffset).toBe(0)
		expect(result?.endOffset).toBe(4)
	})

	test('returns null for whitespace-only selection', () => {
		const container = document.createElement('div')
		container.textContent = 'Before   After'
		document.body.appendChild(container)

		// Select only whitespace
		const range = document.createRange()
		range.setStart(container.firstChild!, 6)
		range.setEnd(container.firstChild!, 9)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const result = getTextSelection(container)
		expect(result).toBeNull()
	})
})

describe('getStyledSpanFromSelection', () => {
	test('returns null when no selection', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">styled</span>'
		document.body.appendChild(container)

		window.getSelection()?.removeAllRanges()

		const result = getStyledSpanFromSelection(container)
		expect(result).toBeNull()
	})

	test('returns styled span when selection is within it', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">styled text</span>'
		document.body.appendChild(container)

		const styledSpan = container.querySelector('[data-cms-styled]')! as HTMLElement
		const textNode = styledSpan.firstChild!

		const range = document.createRange()
		range.setStart(textNode, 0)
		range.setEnd(textNode, 6)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const result = getStyledSpanFromSelection(container)
		expect(result).toBe(styledSpan)
	})

	test('returns null when selection is outside styled spans', () => {
		const container = document.createElement('div')
		container.innerHTML = 'plain text <span data-cms-styled="true">styled</span>'
		document.body.appendChild(container)

		const textNode = container.firstChild!

		const range = document.createRange()
		range.setStart(textNode, 0)
		range.setEnd(textNode, 5)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const result = getStyledSpanFromSelection(container)
		expect(result).toBeNull()
	})
})

describe('wrapSelectionWithStyle', () => {
	test('wraps selected text in styled span', () => {
		const container = document.createElement('div')
		container.textContent = 'Hello World'
		document.body.appendChild(container)

		// Select "World"
		const range = document.createRange()
		range.setStart(container.firstChild!, 6)
		range.setEnd(container.firstChild!, 11)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const textSelection = getTextSelection(container)
		expect(textSelection).not.toBeNull()

		const result = wrapSelectionWithStyle(container, textSelection!, { weight: 'bold' })

		expect(result).not.toBeNull()
		expect(result?.textContent).toBe('World')
		expect(result?.className).toBe('font-bold')
		expect(result?.hasAttribute('data-cms-styled')).toBe(true)
	})

	test('returns null when style produces no classes', () => {
		const container = document.createElement('div')
		container.textContent = 'Hello World'
		document.body.appendChild(container)

		// Select "World"
		const range = document.createRange()
		range.setStart(container.firstChild!, 6)
		range.setEnd(container.firstChild!, 11)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const textSelection = getTextSelection(container)
		expect(textSelection).not.toBeNull()

		// Pass default values - should produce no classes
		const result = wrapSelectionWithStyle(container, textSelection!, { weight: 'normal' })

		expect(result).toBeNull()
	})

	test('updates existing styled span instead of nesting', () => {
		const container = document.createElement('div')
		container.innerHTML = '<span data-cms-styled="true" class="font-bold">styled text</span>'
		document.body.appendChild(container)

		const styledSpan = container.querySelector('[data-cms-styled]')! as HTMLElement
		const textNode = styledSpan.firstChild!

		// Select entire content of styled span
		const range = document.createRange()
		range.selectNodeContents(styledSpan)

		const selection = window.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)

		const textSelection = getTextSelection(container)
		expect(textSelection).not.toBeNull()

		const result = wrapSelectionWithStyle(container, textSelection!, { style: 'italic' })

		// Should update existing span, not create nested one
		expect(container.querySelectorAll('[data-cms-styled]').length).toBe(1)
		expect(result?.className).toContain('font-bold')
		expect(result?.className).toContain('italic')
	})
})

// ============================================================================
// TAILWIND_STYLES validation tests
// ============================================================================

describe('TAILWIND_STYLES', () => {
	test('all weight entries have class and label', () => {
		for (const [key, value] of Object.entries(TAILWIND_STYLES.weight)) {
			expect(typeof value.class).toBe('string')
			expect(typeof value.label).toBe('string')
			expect(value.class.length).toBeGreaterThan(0)
			expect(value.label.length).toBeGreaterThan(0)
		}
	})

	test('all decoration entries have class and label', () => {
		for (const [key, value] of Object.entries(TAILWIND_STYLES.decoration)) {
			expect(typeof value.class).toBe('string')
			expect(typeof value.label).toBe('string')
			// 'none' decoration has an actual class 'no-underline'
			expect(value.label.length).toBeGreaterThan(0)
		}
	})

	test('all style entries have class and label', () => {
		for (const [key, value] of Object.entries(TAILWIND_STYLES.style)) {
			expect(typeof value.class).toBe('string')
			expect(typeof value.label).toBe('string')
		}
	})

	test('all color entries have class and label', () => {
		for (const [key, value] of Object.entries(TAILWIND_STYLES.color)) {
			expect(typeof value.class).toBe('string')
			expect(typeof value.label).toBe('string')
			expect(value.class.length).toBeGreaterThan(0)
		}
	})

	test('all highlight entries have label', () => {
		for (const [key, value] of Object.entries(TAILWIND_STYLES.highlight)) {
			expect(typeof value.class).toBe('string')
			expect(typeof value.label).toBe('string')
			// 'none' highlight has empty class which is expected
		}
	})

	test('all size entries have class and label', () => {
		for (const [key, value] of Object.entries(TAILWIND_STYLES.size)) {
			expect(typeof value.class).toBe('string')
			expect(typeof value.label).toBe('string')
			expect(value.class.length).toBeGreaterThan(0)
		}
	})
})

// ============================================================================
// Round-trip tests (parse -> build -> parse should be consistent)
// ============================================================================

describe('parse/build round-trip', () => {
	test('round-trip for single style', () => {
		const original: TextStyle = { weight: 'bold' }
		const classString = buildStyleClasses(original)
		const parsed = parseStyleClasses(classString)
		expect(parsed).toEqual(original)
	})

	test('round-trip for multiple styles', () => {
		const original: TextStyle = {
			weight: 'bold',
			style: 'italic',
			decoration: 'underline',
			color: 'red',
			highlight: 'yellow',
			size: 'lg',
		}
		const classString = buildStyleClasses(original)
		const parsed = parseStyleClasses(classString)
		expect(parsed).toEqual(original)
	})

	test('round-trip preserves non-default values only', () => {
		const original: TextStyle = {
			weight: 'bold',
			style: 'normal', // default value
		}
		const classString = buildStyleClasses(original)
		const parsed = parseStyleClasses(classString)
		// 'normal' should not be included since it produces no class
		expect(parsed).toEqual({ weight: 'bold' })
	})
})
