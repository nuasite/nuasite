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

		test('extracts hover border color class', () => {
			const result = extractColorClasses('border-gray-300 hover:border-blue-500')
			expect(result).toBeDefined()
			expect(result?.border).toBe('border-gray-300')
			expect(result?.hoverBorder).toBe('hover:border-blue-500')
		})

		test('extracts all color classes', () => {
			const result = extractColorClasses('bg-blue-500 text-white border-blue-600 hover:bg-blue-600 hover:text-gray-100 hover:border-blue-700')
			expect(result).toBeDefined()
			expect(result?.allColorClasses).toContain('bg-blue-500')
			expect(result?.allColorClasses).toContain('text-white')
			expect(result?.allColorClasses).toContain('border-blue-600')
			expect(result?.allColorClasses).toContain('hover:bg-blue-600')
			expect(result?.allColorClasses).toContain('hover:text-gray-100')
			expect(result?.allColorClasses).toContain('hover:border-blue-700')
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

		test('extracts opacity classes separately', () => {
			const result = extractColorClasses('bg-blue-500 bg-opacity-90 text-white text-opacity-80')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-blue-500')
			expect(result?.text).toBe('text-white')
			expect(result?.opacity?.bgOpacity).toBe('bg-opacity-90')
			expect(result?.opacity?.textOpacity).toBe('text-opacity-80')
		})

		test('opacity classes are not included in allColorClasses', () => {
			const result = extractColorClasses('bg-blue-500 bg-opacity-90')
			expect(result).toBeDefined()
			expect(result?.allColorClasses).toContain('bg-blue-500')
			expect(result?.allColorClasses).not.toContain('bg-opacity-90')
		})

		test('extracts border opacity', () => {
			const result = extractColorClasses('border-gray-300 border-opacity-50')
			expect(result).toBeDefined()
			expect(result?.border).toBe('border-gray-300')
			expect(result?.opacity?.borderOpacity).toBe('border-opacity-50')
		})

		test('returns result with only opacity classes', () => {
			const result = extractColorClasses('px-4 bg-opacity-75')
			expect(result).toBeDefined()
			expect(result?.opacity?.bgOpacity).toBe('bg-opacity-75')
			expect(result?.allColorClasses).toBeUndefined()
		})

		test('does not match opacity as a custom color', () => {
			const result = extractColorClasses('bg-opacity-90')
			expect(result?.bg).toBeUndefined()
			expect(result?.opacity?.bgOpacity).toBe('bg-opacity-90')
		})

		test('extracts arbitrary hex color classes', () => {
			const result = extractColorClasses('bg-[#41b883] text-[#fff]')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[#41b883]')
			expect(result?.text).toBe('text-[#fff]')
		})

		test('extracts arbitrary hex with 6 digits', () => {
			const result = extractColorClasses('bg-[#ff5733]')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[#ff5733]')
		})

		test('extracts arbitrary hex with 8 digits (with alpha)', () => {
			const result = extractColorClasses('bg-[#ff573380]')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[#ff573380]')
		})

		test('extracts arbitrary rgb color classes', () => {
			const result = extractColorClasses('bg-[rgb(255,0,0)] text-[rgba(0,0,0,0.5)]')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[rgb(255,0,0)]')
			expect(result?.text).toBe('text-[rgba(0,0,0,0.5)]')
		})

		test('extracts arbitrary hsl color classes', () => {
			const result = extractColorClasses('bg-[hsl(0,100%,50%)] border-[hsla(120,100%,50%,0.3)]')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[hsl(0,100%,50%)]')
			expect(result?.border).toBe('border-[hsla(120,100%,50%,0.3)]')
		})

		test('extracts hover arbitrary color classes', () => {
			const result = extractColorClasses('bg-[#41b883] hover:bg-[#3aa876]')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[#41b883]')
			expect(result?.hoverBg).toBe('hover:bg-[#3aa876]')
		})

		test('mixes arbitrary and named colors', () => {
			const result = extractColorClasses('bg-[#41b883] text-white border-gray-300')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-[#41b883]')
			expect(result?.text).toBe('text-white')
			expect(result?.border).toBe('border-gray-300')
		})

		test('extracts gradient color classes', () => {
			const result = extractColorClasses('bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500')
			expect(result).toBeDefined()
			expect(result?.gradient?.from).toBe('from-blue-500')
			expect(result?.gradient?.via).toBe('via-purple-500')
			expect(result?.gradient?.to).toBe('to-pink-500')
		})

		test('extracts gradient with only from and to', () => {
			const result = extractColorClasses('from-red-500 to-yellow-500')
			expect(result).toBeDefined()
			expect(result?.gradient?.from).toBe('from-red-500')
			expect(result?.gradient?.to).toBe('to-yellow-500')
			expect(result?.gradient?.via).toBeUndefined()
		})

		test('extracts hover gradient classes', () => {
			const result = extractColorClasses('from-blue-500 hover:from-blue-600 to-pink-500 hover:to-pink-600')
			expect(result).toBeDefined()
			expect(result?.gradient?.from).toBe('from-blue-500')
			expect(result?.gradient?.hoverFrom).toBe('hover:from-blue-600')
			expect(result?.gradient?.to).toBe('to-pink-500')
			expect(result?.gradient?.hoverTo).toBe('hover:to-pink-600')
		})

		test('extracts arbitrary gradient colors', () => {
			const result = extractColorClasses('from-[#41b883] to-[#3aa876]')
			expect(result).toBeDefined()
			expect(result?.gradient?.from).toBe('from-[#41b883]')
			expect(result?.gradient?.to).toBe('to-[#3aa876]')
		})

		test('gradient classes are included in allColorClasses', () => {
			const result = extractColorClasses('from-blue-500 via-purple-500 to-pink-500')
			expect(result).toBeDefined()
			expect(result?.allColorClasses).toContain('from-blue-500')
			expect(result?.allColorClasses).toContain('via-purple-500')
			expect(result?.allColorClasses).toContain('to-pink-500')
		})

		test('mixes gradient and regular colors', () => {
			const result = extractColorClasses('bg-white text-gray-900 from-blue-500 to-pink-500')
			expect(result).toBeDefined()
			expect(result?.bg).toBe('bg-white')
			expect(result?.text).toBe('text-gray-900')
			expect(result?.gradient?.from).toBe('from-blue-500')
			expect(result?.gradient?.to).toBe('to-pink-500')
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
			expect(isColorClass('hover:border-gray-400')).toBe(true)
		})

		test('rejects non-color classes', () => {
			expect(isColorClass('px-4')).toBe(false)
			expect(isColorClass('rounded')).toBe(false)
			expect(isColorClass('font-bold')).toBe(false)
			expect(isColorClass('flex')).toBe(false)
		})

		test('identifies arbitrary hex color classes', () => {
			expect(isColorClass('bg-[#41b883]')).toBe(true)
			expect(isColorClass('text-[#fff]')).toBe(true)
			expect(isColorClass('border-[#ff5733]')).toBe(true)
		})

		test('identifies arbitrary rgb/hsl color classes', () => {
			expect(isColorClass('bg-[rgb(255,0,0)]')).toBe(true)
			expect(isColorClass('text-[rgba(0,0,0,0.5)]')).toBe(true)
			expect(isColorClass('bg-[hsl(0,100%,50%)]')).toBe(true)
		})

		test('identifies hover arbitrary color classes', () => {
			expect(isColorClass('hover:bg-[#41b883]')).toBe(true)
			expect(isColorClass('hover:text-[rgb(255,0,0)]')).toBe(true)
		})

		test('identifies gradient color classes', () => {
			expect(isColorClass('from-blue-500')).toBe(true)
			expect(isColorClass('via-purple-500')).toBe(true)
			expect(isColorClass('to-pink-500')).toBe(true)
		})

		test('identifies hover gradient color classes', () => {
			expect(isColorClass('hover:from-blue-600')).toBe(true)
			expect(isColorClass('hover:via-purple-600')).toBe(true)
			expect(isColorClass('hover:to-pink-600')).toBe(true)
		})

		test('identifies arbitrary gradient color classes', () => {
			expect(isColorClass('from-[#41b883]')).toBe(true)
			expect(isColorClass('to-[rgb(255,0,0)]')).toBe(true)
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

		test('returns correct type for hoverBorder', () => {
			expect(getColorType('hover:border-blue-700')).toBe('hoverBorder')
		})

		test('returns correct type for gradient from', () => {
			expect(getColorType('from-blue-500')).toBe('from')
		})

		test('returns correct type for gradient via', () => {
			expect(getColorType('via-purple-500')).toBe('via')
		})

		test('returns correct type for gradient to', () => {
			expect(getColorType('to-pink-500')).toBe('to')
		})

		test('returns correct type for hover gradient', () => {
			expect(getColorType('hover:from-blue-600')).toBe('hoverFrom')
			expect(getColorType('hover:via-purple-600')).toBe('hoverVia')
			expect(getColorType('hover:to-pink-600')).toBe('hoverTo')
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

		test('parses hover border color', () => {
			const result = parseColorClass('hover:border-indigo-600')
			expect(result).toEqual({
				prefix: 'hover:border',
				colorName: 'indigo',
				shade: '600',
				isHover: true,
			})
		})

		test('parses arbitrary hex color', () => {
			const result = parseColorClass('bg-[#41b883]')
			expect(result).toEqual({
				prefix: 'bg',
				colorName: '[#41b883]',
				shade: undefined,
				isHover: false,
				isArbitrary: true,
			})
		})

		test('parses arbitrary rgb color', () => {
			const result = parseColorClass('text-[rgb(255,0,0)]')
			expect(result).toEqual({
				prefix: 'text',
				colorName: '[rgb(255,0,0)]',
				shade: undefined,
				isHover: false,
				isArbitrary: true,
			})
		})

		test('parses hover arbitrary color', () => {
			const result = parseColorClass('hover:bg-[#3aa876]')
			expect(result).toEqual({
				prefix: 'hover:bg',
				colorName: '[#3aa876]',
				shade: undefined,
				isHover: true,
				isArbitrary: true,
			})
		})

		test('parses gradient from color', () => {
			const result = parseColorClass('from-blue-500')
			expect(result).toEqual({
				prefix: 'from',
				colorName: 'blue',
				shade: '500',
				isHover: false,
			})
		})

		test('parses gradient via color', () => {
			const result = parseColorClass('via-purple-500')
			expect(result).toEqual({
				prefix: 'via',
				colorName: 'purple',
				shade: '500',
				isHover: false,
			})
		})

		test('parses gradient to color', () => {
			const result = parseColorClass('to-pink-500')
			expect(result).toEqual({
				prefix: 'to',
				colorName: 'pink',
				shade: '500',
				isHover: false,
			})
		})

		test('parses hover gradient color', () => {
			const result = parseColorClass('hover:from-blue-600')
			expect(result).toEqual({
				prefix: 'hover:from',
				colorName: 'blue',
				shade: '600',
				isHover: true,
			})
		})

		test('parses arbitrary gradient color', () => {
			const result = parseColorClass('from-[#41b883]')
			expect(result).toEqual({
				prefix: 'from',
				colorName: '[#41b883]',
				shade: undefined,
				isHover: false,
				isArbitrary: true,
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

		test('builds hover border color', () => {
			expect(buildColorClass('hover:border', 'purple', '500')).toBe('hover:border-purple-500')
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

		test('replaces hover border color class', () => {
			const result = replaceColorClass('border-gray-300 hover:border-gray-400', 'hover:border-gray-400', 'hover:border-blue-500')
			expect(result).toBe('border-gray-300 hover:border-blue-500')
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

		test('returns standard shades with values for default colors', async () => {
			const result = await parseTailwindConfig('/nonexistent/path')
			const blueColor = result.colors.find(c => c.name === 'blue')
			expect(blueColor).toBeDefined()
			// Check that all standard shades have values
			expect(Object.keys(blueColor?.values ?? {})).toEqual([...STANDARD_SHADES])
			// Check that values are hex colors
			expect(blueColor?.values['500']).toBe('#3b82f6')
		})

		test('special colors have single empty-key value', async () => {
			const result = await parseTailwindConfig('/nonexistent/path')
			const whiteColor = result.colors.find(c => c.name === 'white')
			expect(whiteColor).toBeDefined()
			expect(whiteColor?.values).toEqual({ '': '#ffffff' })
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
