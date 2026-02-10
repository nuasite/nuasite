import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	applyColorChange,
	buildColorClass,
	COLOR_PREVIEW_MAP,
	DEFAULT_TAILWIND_COLORS,
	getColorPreview,
	getColorType,
	getElementColorClasses,
	isColorClass,
	parseColorClass,
	replaceColorClass,
	resolveColorValue,
	SPECIAL_COLORS,
	STANDARD_SHADES,
} from '../../../src/editor/color-utils'

beforeEach(() => {
	document.body.innerHTML = ''
})

afterEach(() => {
	document.body.innerHTML = ''
})

// ============================================================================
// parseColorClass tests
// ============================================================================

describe('parseColorClass', () => {
	test('parses background color class without shade', () => {
		const result = parseColorClass('bg-white')
		expect(result).toEqual({
			prefix: 'bg',
			colorName: 'white',
			shade: undefined,
			isHover: false,
		})
	})

	test('parses background color class with shade', () => {
		const result = parseColorClass('bg-blue-500')
		expect(result).toEqual({
			prefix: 'bg',
			colorName: 'blue',
			shade: '500',
			isHover: false,
		})
	})

	test('parses text color class without shade', () => {
		const result = parseColorClass('text-black')
		expect(result).toEqual({
			prefix: 'text',
			colorName: 'black',
			shade: undefined,
			isHover: false,
		})
	})

	test('parses text color class with shade', () => {
		const result = parseColorClass('text-red-600')
		expect(result).toEqual({
			prefix: 'text',
			colorName: 'red',
			shade: '600',
			isHover: false,
		})
	})

	test('parses border color class', () => {
		const result = parseColorClass('border-gray-300')
		expect(result).toEqual({
			prefix: 'border',
			colorName: 'gray',
			shade: '300',
			isHover: false,
		})
	})

	test('parses hover background color class', () => {
		const result = parseColorClass('hover:bg-blue-600')
		expect(result).toEqual({
			prefix: 'hover:bg',
			colorName: 'blue',
			shade: '600',
			isHover: true,
		})
	})

	test('parses hover text color class', () => {
		const result = parseColorClass('hover:text-white')
		expect(result).toEqual({
			prefix: 'hover:text',
			colorName: 'white',
			shade: undefined,
			isHover: true,
		})
	})

	test('returns undefined for non-color classes', () => {
		expect(parseColorClass('font-bold')).toBeUndefined()
		expect(parseColorClass('text-center')).toBeUndefined()
		expect(parseColorClass('flex')).toBeUndefined()
	})
})

// ============================================================================
// buildColorClass tests
// ============================================================================

describe('buildColorClass', () => {
	test('builds class without shade', () => {
		expect(buildColorClass('bg', 'white')).toBe('bg-white')
		expect(buildColorClass('text', 'black')).toBe('text-black')
	})

	test('builds class with shade', () => {
		expect(buildColorClass('bg', 'blue', '500')).toBe('bg-blue-500')
		expect(buildColorClass('text', 'red', '600')).toBe('text-red-600')
	})

	test('builds hover class', () => {
		expect(buildColorClass('hover:bg', 'blue', '600')).toBe('hover:bg-blue-600')
		expect(buildColorClass('hover:text', 'white')).toBe('hover:text-white')
	})
})

// ============================================================================
// getColorType tests
// ============================================================================

describe('getColorType', () => {
	test('identifies background color classes', () => {
		expect(getColorType('bg-white')).toBe('bg')
		expect(getColorType('bg-blue-500')).toBe('bg')
	})

	test('identifies text color classes', () => {
		expect(getColorType('text-black')).toBe('text')
		expect(getColorType('text-red-600')).toBe('text')
	})

	test('identifies border color classes', () => {
		expect(getColorType('border-gray-300')).toBe('border')
	})

	test('identifies hover color classes', () => {
		expect(getColorType('hover:bg-blue-600')).toBe('hoverBg')
		expect(getColorType('hover:text-white')).toBe('hoverText')
	})

	test('returns undefined for non-color classes', () => {
		expect(getColorType('font-bold')).toBeUndefined()
		expect(getColorType('flex')).toBeUndefined()
	})

	test('returns undefined for non-color text utility classes', () => {
		expect(getColorType('text-center')).toBeUndefined()
		expect(getColorType('text-left')).toBeUndefined()
		expect(getColorType('text-right')).toBeUndefined()
		expect(getColorType('text-justify')).toBeUndefined()
		expect(getColorType('text-start')).toBeUndefined()
		expect(getColorType('text-end')).toBeUndefined()
		expect(getColorType('text-wrap')).toBeUndefined()
		expect(getColorType('text-nowrap')).toBeUndefined()
		expect(getColorType('text-balance')).toBeUndefined()
		expect(getColorType('text-pretty')).toBeUndefined()
		expect(getColorType('text-ellipsis')).toBeUndefined()
		expect(getColorType('text-clip')).toBeUndefined()
	})
})

// ============================================================================
// isColorClass tests
// ============================================================================

describe('isColorClass', () => {
	test('returns true for background color classes', () => {
		expect(isColorClass('bg-white')).toBe(true)
		expect(isColorClass('bg-blue-500')).toBe(true)
	})

	test('returns true for text color classes', () => {
		expect(isColorClass('text-black')).toBe(true)
		expect(isColorClass('text-red-600')).toBe(true)
	})

	test('returns true for border color classes', () => {
		expect(isColorClass('border-gray-300')).toBe(true)
	})

	test('returns true for hover color classes', () => {
		expect(isColorClass('hover:bg-blue-600')).toBe(true)
		expect(isColorClass('hover:text-white')).toBe(true)
	})

	test('returns false for non-color classes', () => {
		expect(isColorClass('font-bold')).toBe(false)
		expect(isColorClass('flex')).toBe(false)
		expect(isColorClass('p-4')).toBe(false)
	})

	test('returns false for non-color text utility classes', () => {
		expect(isColorClass('text-center')).toBe(false)
		expect(isColorClass('text-left')).toBe(false)
		expect(isColorClass('text-right')).toBe(false)
		expect(isColorClass('text-justify')).toBe(false)
		expect(isColorClass('text-start')).toBe(false)
		expect(isColorClass('text-end')).toBe(false)
		expect(isColorClass('text-wrap')).toBe(false)
		expect(isColorClass('text-nowrap')).toBe(false)
		expect(isColorClass('text-balance')).toBe(false)
		expect(isColorClass('text-pretty')).toBe(false)
		expect(isColorClass('text-ellipsis')).toBe(false)
		expect(isColorClass('text-clip')).toBe(false)
	})
})

// ============================================================================
// getColorPreview tests
// ============================================================================

describe('getColorPreview', () => {
	test('returns correct preview for special colors', () => {
		expect(getColorPreview('white')).toBe('#ffffff')
		expect(getColorPreview('black')).toBe('#000000')
		expect(getColorPreview('transparent')).toBe('transparent')
	})

	test('returns base color for standard colors without shade', () => {
		expect(getColorPreview('blue')).toBe('#3b82f6')
		expect(getColorPreview('red')).toBe('#ef4444')
	})

	test('returns base color for standard colors with shade', () => {
		// Currently returns base color regardless of shade
		expect(getColorPreview('blue', '500')).toBe('#3b82f6')
		expect(getColorPreview('red', '600')).toBe('#ef4444')
	})

	test('returns placeholder for unknown colors', () => {
		expect(getColorPreview('unknown')).toBe('#888888')
	})
})

// ============================================================================
// resolveColorValue tests
// ============================================================================

describe('resolveColorValue', () => {
	test('resolves special colors', () => {
		expect(resolveColorValue('white', undefined, undefined)).toBe('#ffffff')
		expect(resolveColorValue('black', undefined, undefined)).toBe('#000000')
		expect(resolveColorValue('transparent', undefined, undefined)).toBe('transparent')
		expect(resolveColorValue('current', undefined, undefined)).toBe('currentColor')
		expect(resolveColorValue('inherit', undefined, undefined)).toBe('inherit')
	})

	test('falls back to preview map when no availableColors', () => {
		expect(resolveColorValue('blue', '500', undefined)).toBe('#3b82f6')
	})

	test('returns undefined for unknown colors without availableColors', () => {
		expect(resolveColorValue('customcolor', '500', undefined)).toBeUndefined()
	})
})

// ============================================================================
// getElementColorClasses tests
// ============================================================================

describe('getElementColorClasses', () => {
	test('extracts background color class', () => {
		const element = document.createElement('div')
		element.className = 'bg-blue-500 p-4 flex'
		document.body.appendChild(element)

		const result = getElementColorClasses(element)
		expect(result.bg).toEqual({ value: 'bg-blue-500' })
	})

	test('extracts text color class', () => {
		const element = document.createElement('div')
		element.className = 'text-white font-bold'
		document.body.appendChild(element)

		const result = getElementColorClasses(element)
		expect(result.text).toEqual({ value: 'text-white' })
	})

	test('extracts multiple color classes', () => {
		const element = document.createElement('div')
		element.className = 'bg-blue-500 text-white border-gray-300'
		document.body.appendChild(element)

		const result = getElementColorClasses(element)
		expect(result.bg).toEqual({ value: 'bg-blue-500' })
		expect(result.text).toEqual({ value: 'text-white' })
		expect(result.border).toEqual({ value: 'border-gray-300' })
	})

	test('does not include non-color text utility classes', () => {
		const element = document.createElement('div')
		element.className = 'text-center text-white bg-blue-500'
		document.body.appendChild(element)

		const result = getElementColorClasses(element)
		expect(result.text).toEqual({ value: 'text-white' })
		expect(result.bg).toEqual({ value: 'bg-blue-500' })
		expect(result['text-center']).toBeUndefined()
	})

	test('preserves text-center when only non-color text classes present', () => {
		const element = document.createElement('div')
		element.className = 'text-center text-left p-4'
		document.body.appendChild(element)

		const result = getElementColorClasses(element)
		expect(result.text).toBeUndefined()
		expect(Object.keys(result)).toHaveLength(0)
	})
})

// ============================================================================
// replaceColorClass tests
// ============================================================================

describe('replaceColorClass', () => {
	test('replaces background color class', () => {
		const element = document.createElement('div')
		element.className = 'bg-blue-500 p-4 flex'
		document.body.appendChild(element)

		const result = replaceColorClass(element, 'bg', 'red', '600')

		expect(result?.oldClass).toBe('bg-blue-500')
		expect(result?.newClass).toBe('bg-red-600')
		expect(element.className).toContain('bg-red-600')
		expect(element.className).not.toContain('bg-blue-500')
	})

	test('replaces text color class', () => {
		const element = document.createElement('div')
		element.className = 'text-white font-bold'
		document.body.appendChild(element)

		const result = replaceColorClass(element, 'text', 'black')

		expect(result?.oldClass).toBe('text-white')
		expect(result?.newClass).toBe('text-black')
		expect(element.className).toContain('text-black')
		expect(element.className).not.toContain('text-white')
	})

	test('does not replace non-color text utility classes', () => {
		const element = document.createElement('div')
		element.className = 'text-center text-white font-bold'
		document.body.appendChild(element)

		const result = replaceColorClass(element, 'text', 'black')

		expect(result?.oldClass).toBe('text-white')
		expect(result?.newClass).toBe('text-black')
		expect(element.className).toContain('text-center')
		expect(element.className).toContain('text-black')
		expect(element.className).not.toContain('text-white')
	})

	test('returns undefined when no matching class found', () => {
		const element = document.createElement('div')
		element.className = 'p-4 flex'
		document.body.appendChild(element)

		const result = replaceColorClass(element, 'bg', 'blue', '500')

		expect(result).toBeUndefined()
	})
})

// ============================================================================
// applyColorChange tests
// ============================================================================

describe('applyColorChange', () => {
	test('applies background color change', () => {
		const element = document.createElement('div')
		element.className = 'bg-blue-500 p-4'
		document.body.appendChild(element)

		const result = applyColorChange(element, 'bg', 'red', '600', undefined)

		expect(result?.oldClass).toBe('bg-blue-500')
		expect(result?.newClass).toBe('bg-red-600')
		expect(element.className).toContain('bg-red-600')
		expect(element.style.backgroundColor).toBe('#ef4444')
	})

	test('applies text color change', () => {
		const element = document.createElement('div')
		element.className = 'text-white font-bold'
		document.body.appendChild(element)

		const result = applyColorChange(element, 'text', 'black', undefined, undefined)

		expect(result?.oldClass).toBe('text-white')
		expect(result?.newClass).toBe('text-black')
		expect(element.className).toContain('text-black')
		expect(element.style.color).toBe('#000000')
	})

	test('adds color class when none exists', () => {
		const element = document.createElement('div')
		element.className = 'p-4 flex'
		document.body.appendChild(element)

		const result = applyColorChange(element, 'bg', 'blue', '500', undefined)

		expect(result?.oldClass).toBe('')
		expect(result?.newClass).toBe('bg-blue-500')
		expect(element.className).toContain('bg-blue-500')
	})

	test('does not remove non-color text utility classes when changing text color', () => {
		const element = document.createElement('div')
		element.className = 'text-center text-white font-bold'
		document.body.appendChild(element)

		const result = applyColorChange(element, 'text', 'black', undefined, undefined)

		expect(result?.oldClass).toBe('text-white')
		expect(result?.newClass).toBe('text-black')
		expect(element.className).toContain('text-center')
		expect(element.className).toContain('text-black')
		expect(element.className).toContain('font-bold')
		expect(element.className).not.toContain('text-white')
	})

	test('preserves text-left when changing text color', () => {
		const element = document.createElement('div')
		element.className = 'text-left text-red-500'
		document.body.appendChild(element)

		applyColorChange(element, 'text', 'blue', '600', undefined)

		expect(element.className).toContain('text-left')
		expect(element.className).toContain('text-blue-600')
	})

	test('preserves text-right when changing text color', () => {
		const element = document.createElement('div')
		element.className = 'text-right text-green-500'
		document.body.appendChild(element)

		applyColorChange(element, 'text', 'purple', '700', undefined)

		expect(element.className).toContain('text-right')
		expect(element.className).toContain('text-purple-700')
	})

	test('preserves text-justify when changing text color', () => {
		const element = document.createElement('div')
		element.className = 'text-justify text-gray-800'
		document.body.appendChild(element)

		applyColorChange(element, 'text', 'slate', '900', undefined)

		expect(element.className).toContain('text-justify')
		expect(element.className).toContain('text-slate-900')
	})

	test('preserves text-wrap when changing text color', () => {
		const element = document.createElement('div')
		element.className = 'text-wrap text-black'
		document.body.appendChild(element)

		applyColorChange(element, 'text', 'white', undefined, undefined)

		expect(element.className).toContain('text-wrap')
		expect(element.className).toContain('text-white')
	})

	test('preserves multiple non-color text utilities when changing text color', () => {
		const element = document.createElement('div')
		element.className = 'text-center text-wrap text-ellipsis text-blue-500'
		document.body.appendChild(element)

		applyColorChange(element, 'text', 'red', '600', undefined)

		expect(element.className).toContain('text-center')
		expect(element.className).toContain('text-wrap')
		expect(element.className).toContain('text-ellipsis')
		expect(element.className).toContain('text-red-600')
		expect(element.className).not.toContain('text-blue-500')
	})
})

// ============================================================================
// Constants tests
// ============================================================================

describe('DEFAULT_TAILWIND_COLORS', () => {
	test('contains expected colors', () => {
		expect(DEFAULT_TAILWIND_COLORS).toContain('red')
		expect(DEFAULT_TAILWIND_COLORS).toContain('blue')
		expect(DEFAULT_TAILWIND_COLORS).toContain('green')
		expect(DEFAULT_TAILWIND_COLORS).toContain('gray')
		expect(DEFAULT_TAILWIND_COLORS).toContain('slate')
	})
})

describe('STANDARD_SHADES', () => {
	test('contains expected shades', () => {
		expect(STANDARD_SHADES).toContain('50')
		expect(STANDARD_SHADES).toContain('100')
		expect(STANDARD_SHADES).toContain('500')
		expect(STANDARD_SHADES).toContain('900')
		expect(STANDARD_SHADES).toContain('950')
	})
})

describe('SPECIAL_COLORS', () => {
	test('contains expected special colors', () => {
		expect(SPECIAL_COLORS).toContain('transparent')
		expect(SPECIAL_COLORS).toContain('current')
		expect(SPECIAL_COLORS).toContain('inherit')
		expect(SPECIAL_COLORS).toContain('white')
		expect(SPECIAL_COLORS).toContain('black')
	})
})

describe('COLOR_PREVIEW_MAP', () => {
	test('has entries for special colors', () => {
		expect(COLOR_PREVIEW_MAP.white).toBe('#ffffff')
		expect(COLOR_PREVIEW_MAP.black).toBe('#000000')
		expect(COLOR_PREVIEW_MAP.transparent).toBe('transparent')
	})

	test('has entries for standard colors', () => {
		expect(COLOR_PREVIEW_MAP.blue).toBeDefined()
		expect(COLOR_PREVIEW_MAP.red).toBeDefined()
		expect(COLOR_PREVIEW_MAP.green).toBeDefined()
	})
})
