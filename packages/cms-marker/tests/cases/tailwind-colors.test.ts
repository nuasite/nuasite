import { describe, expect, test } from 'bun:test'
import {
	buildColorClass,
	DEFAULT_TAILWIND_COLORS,
	extractColorClasses,
	getColorType,
	isColorClass,
	parseColorClass,
	parseTailwindConfig,
	replaceColorClass,
	SPECIAL_COLORS,
	STANDARD_SHADES,
} from '../../src/tailwind-colors'

describe('tailwind-colors', () => {
	describe('extractColorClasses', () => {
		test('extracts background color class', () => {
			const result = extractColorClasses('px-4 py-2 bg-blue-500 text-white rounded')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-blue-500')
		})

		test('extracts text color class', () => {
			const result = extractColorClasses('text-red-600 font-bold')
			expect(result).toBeDefined()
			expect(result?.text).toBe('text-red-600')
		})

		test('extracts border color class', () => {
			const result = extractColorClasses('border border-gray-300')
			expect(result).toBeDefined()
			expect(result?.border).toBe('border-gray-300')
		})

		test('extracts hover background color class', () => {
			const result = extractColorClasses('bg-blue-500 hover:bg-blue-600')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-blue-500')
			expect(result?.hoverBg).toBe('hover:bg-blue-600')
		})

		test('extracts hover text color class', () => {
			const result = extractColorClasses('text-white hover:text-gray-100')
			expect(result).toBeDefined()
			expect(result?.text).toBe('text-white')
			expect(result?.hoverText).toBe('hover:text-gray-100')
		})

		test('extracts all color classes', () => {
			const result = extractColorClasses('bg-blue-500 text-white border-blue-600 hover:bg-blue-600 hover:text-gray-100')
			expect(result).toBeDefined()
			expect(result?.allColorClasses).toContain('bg-blue-500')
			expect(result?.allColorClasses).toContain('text-white')
			expect(result?.allColorClasses).toContain('border-blue-600')
			expect(result?.allColorClasses).toContain('hover:bg-blue-600')
			expect(result?.allColorClasses).toContain('hover:text-gray-100')
		})

		test('returns undefined when no color classes', () => {
			const result = extractColorClasses('px-4 py-2 rounded font-bold')
			expect(result).toBeUndefined()
		})

		test('returns undefined for null input', () => {
			const result = extractColorClasses(null)
			expect(result).toBeUndefined()
		})

		test('handles special colors without shades', () => {
			const result = extractColorClasses('bg-white text-black')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-white')
			expect(result?.text).toBe('text-black')
		})

		test('handles custom theme colors', () => {
			const result = extractColorClasses('bg-primary-500 text-accent-200')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-primary-500')
			expect(result?.text).toBe('text-accent-200')
		})
	})

	describe('isColorClass', () => {
		test('identifies bg color class', () => {
			expect(isColorClass('bg-blue-500')).toBe(true)
			expect(isColorClass('bg-white')).toBe(true)
		})

		test('identifies text color class', () => {
			expect(isColorClass('text-red-600')).toBe(true)
			expect(isColorClass('text-black')).toBe(true)
		})

		test('identifies border color class', () => {
			expect(isColorClass('border-gray-300')).toBe(true)
		})

		test('identifies hover color classes', () => {
			expect(isColorClass('hover:bg-blue-600')).toBe(true)
			expect(isColorClass('hover:text-white')).toBe(true)
		})

		test('rejects non-color classes', () => {
			expect(isColorClass('px-4')).toBe(false)
			expect(isColorClass('rounded')).toBe(false)
			expect(isColorClass('font-bold')).toBe(false)
			expect(isColorClass('flex')).toBe(false)
		})
	})

	describe('getColorType', () => {
		test('returns correct type for bg', () => {
			expect(getColorType('bg-blue-500')).toBe('bg')
		})

		test('returns correct type for text', () => {
			expect(getColorType('text-white')).toBe('text')
		})

		test('returns correct type for border', () => {
			expect(getColorType('border-gray-300')).toBe('border')
		})

		test('returns correct type for hoverBg', () => {
			expect(getColorType('hover:bg-blue-600')).toBe('hoverBg')
		})

		test('returns correct type for hoverText', () => {
			expect(getColorType('hover:text-gray-100')).toBe('hoverText')
		})

		test('returns undefined for non-color class', () => {
			expect(getColorType('px-4')).toBeUndefined()
		})
	})

	describe('parseColorClass', () => {
		test('parses bg color with shade', () => {
			const result = parseColorClass('bg-blue-500')
			expect(result).toEqual({
				prefix: 'bg',
				colorName: 'blue',
				shade: '500',
				isHover: false,
			})
		})

		test('parses text color without shade', () => {
			const result = parseColorClass('text-white')
			expect(result).toEqual({
				prefix: 'text',
				colorName: 'white',
				shade: undefined,
				isHover: false,
			})
		})

		test('parses hover bg color', () => {
			const result = parseColorClass('hover:bg-red-600')
			expect(result).toEqual({
				prefix: 'hover:bg',
				colorName: 'red',
				shade: '600',
				isHover: true,
			})
		})

		test('parses hover text color', () => {
			const result = parseColorClass('hover:text-gray-100')
			expect(result).toEqual({
				prefix: 'hover:text',
				colorName: 'gray',
				shade: '100',
				isHover: true,
			})
		})

		test('parses border color', () => {
			const result = parseColorClass('border-emerald-400')
			expect(result).toEqual({
				prefix: 'border',
				colorName: 'emerald',
				shade: '400',
				isHover: false,
			})
		})

		test('returns undefined for non-color class', () => {
			expect(parseColorClass('px-4')).toBeUndefined()
			expect(parseColorClass('rounded-lg')).toBeUndefined()
		})
	})

	describe('buildColorClass', () => {
		test('builds bg color with shade', () => {
			expect(buildColorClass('bg', 'blue', '500')).toBe('bg-blue-500')
		})

		test('builds text color without shade', () => {
			expect(buildColorClass('text', 'white')).toBe('text-white')
		})

		test('builds hover bg color', () => {
			expect(buildColorClass('hover:bg', 'red', '600')).toBe('hover:bg-red-600')
		})

		test('builds border color', () => {
			expect(buildColorClass('border', 'gray', '300')).toBe('border-gray-300')
		})
	})

	describe('replaceColorClass', () => {
		test('replaces bg color class', () => {
			const result = replaceColorClass('px-4 py-2 bg-blue-500 text-white', 'bg-blue-500', 'bg-red-500')
			expect(result).toBe('px-4 py-2 bg-red-500 text-white')
		})

		test('replaces text color class', () => {
			const result = replaceColorClass('text-white font-bold', 'text-white', 'text-black')
			expect(result).toBe('text-black font-bold')
		})

		test('replaces hover color class', () => {
			const result = replaceColorClass('bg-blue-500 hover:bg-blue-600', 'hover:bg-blue-600', 'hover:bg-red-600')
			expect(result).toBe('bg-blue-500 hover:bg-red-600')
		})

		test('preserves other classes', () => {
			const result = replaceColorClass('flex items-center bg-blue-500 rounded-lg shadow-md', 'bg-blue-500', 'bg-green-500')
			expect(result).toBe('flex items-center bg-green-500 rounded-lg shadow-md')
		})
	})

	describe('parseTailwindConfig', () => {
		test('returns default colors', async () => {
			const result = await parseTailwindConfig('/nonexistent/path')
			expect(result.defaultColors).toEqual([...SPECIAL_COLORS, ...DEFAULT_TAILWIND_COLORS])
		})

		test('returns standard shades for default colors', async () => {
			const result = await parseTailwindConfig('/nonexistent/path')
			const blueColor = result.colors.find(c => c.name === 'blue')
			expect(blueColor).toBeDefined()
			expect(blueColor?.shades).toEqual([...STANDARD_SHADES])
		})

		test('special colors have no shades', async () => {
			const result = await parseTailwindConfig('/nonexistent/path')
			const whiteColor = result.colors.find(c => c.name === 'white')
			expect(whiteColor).toBeDefined()
			expect(whiteColor?.shades).toEqual([])
		})
	})

	describe('constants', () => {
		test('DEFAULT_TAILWIND_COLORS contains expected colors', () => {
			expect(DEFAULT_TAILWIND_COLORS).toContain('red')
			expect(DEFAULT_TAILWIND_COLORS).toContain('blue')
			expect(DEFAULT_TAILWIND_COLORS).toContain('green')
			expect(DEFAULT_TAILWIND_COLORS).toContain('gray')
		})

		test('STANDARD_SHADES contains expected shades', () => {
			expect(STANDARD_SHADES).toContain('50')
			expect(STANDARD_SHADES).toContain('500')
			expect(STANDARD_SHADES).toContain('950')
		})

		test('SPECIAL_COLORS contains expected values', () => {
			expect(SPECIAL_COLORS).toContain('white')
			expect(SPECIAL_COLORS).toContain('black')
			expect(SPECIAL_COLORS).toContain('transparent')
		})
	})
})
