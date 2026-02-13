import { describe, expect, test } from 'bun:test'
import { extractBackgroundImageClasses } from '../../src/color-patterns'

describe('extractBackgroundImageClasses', () => {
	test('extracts bg-[url()] with single-quoted URL', () => {
		const result = extractBackgroundImageClasses("bg-[url('/path.png')]")
		expect(result).toBeDefined()
		expect(result?.bgImageClass).toBe("bg-[url('/path.png')]")
	})

	test('extracts bg-[url()] with double-quoted URL', () => {
		const result = extractBackgroundImageClasses('bg-[url("/path.png")]')
		expect(result).toBeDefined()
		expect(result?.bgImageClass).toBe('bg-[url("/path.png")]')
	})

	test('extracts bg-[url()] with no quotes', () => {
		const result = extractBackgroundImageClasses('bg-[url(/path.png)]')
		expect(result).toBeDefined()
		expect(result?.bgImageClass).toBe('bg-[url(/path.png)]')
	})

	test('extracts imageUrl correctly from the class', () => {
		const result = extractBackgroundImageClasses("bg-[url('/images/hero.png')]")
		expect(result).toBeDefined()
		expect(result?.imageUrl).toBe('/images/hero.png')
	})

	test('extracts bg-size classes', () => {
		for (const size of ['bg-auto', 'bg-cover', 'bg-contain']) {
			const result = extractBackgroundImageClasses(`bg-[url('/test.png')] ${size}`)
			expect(result).toBeDefined()
			expect(result?.bgSize).toBe(size)
		}
	})

	test('extracts bg-position classes', () => {
		for (
			const position of [
				'bg-center',
				'bg-top',
				'bg-bottom',
				'bg-left',
				'bg-right',
				'bg-top-left',
				'bg-top-right',
				'bg-bottom-left',
				'bg-bottom-right',
			]
		) {
			const result = extractBackgroundImageClasses(`bg-[url('/test.png')] ${position}`)
			expect(result).toBeDefined()
			expect(result?.bgPosition).toBe(position)
		}
	})

	test('extracts bg-repeat classes', () => {
		for (
			const repeat of [
				'bg-repeat',
				'bg-no-repeat',
				'bg-repeat-x',
				'bg-repeat-y',
				'bg-repeat-round',
				'bg-repeat-space',
			]
		) {
			const result = extractBackgroundImageClasses(`bg-[url('/test.png')] ${repeat}`)
			expect(result).toBeDefined()
			expect(result?.bgRepeat).toBe(repeat)
		}
	})

	test('extracts all metadata together when multiple bg utility classes present', () => {
		const result = extractBackgroundImageClasses("bg-[url('/hero.jpg')] bg-cover bg-center bg-no-repeat")
		expect(result).toBeDefined()
		expect(result?.bgImageClass).toBe("bg-[url('/hero.jpg')]")
		expect(result?.imageUrl).toBe('/hero.jpg')
		expect(result?.bgSize).toBe('bg-cover')
		expect(result?.bgPosition).toBe('bg-center')
		expect(result?.bgRepeat).toBe('bg-no-repeat')
	})

	test('returns undefined when no bg-[url()] class present', () => {
		const result = extractBackgroundImageClasses('px-4 py-2 flex items-center')
		expect(result).toBeUndefined()
	})

	test('returns undefined for null input', () => {
		const result = extractBackgroundImageClasses(null)
		expect(result).toBeUndefined()
	})

	test('returns undefined for empty string', () => {
		const result = extractBackgroundImageClasses('')
		expect(result).toBeUndefined()
	})

	test('returns undefined when only bg-size/position/repeat present without bg-[url()]', () => {
		const result = extractBackgroundImageClasses('bg-cover bg-center bg-no-repeat')
		expect(result).toBeUndefined()
	})

	test('handles complex URLs like /assets/images/hero.jpg', () => {
		const result = extractBackgroundImageClasses("bg-[url('/assets/images/hero.jpg')]")
		expect(result).toBeDefined()
		expect(result?.imageUrl).toBe('/assets/images/hero.jpg')
		expect(result?.bgImageClass).toBe("bg-[url('/assets/images/hero.jpg')]")
	})

	test('handles URLs with spaces and special characters', () => {
		const result = extractBackgroundImageClasses("bg-[url('/assets/my-image_2x.jpg')]")
		expect(result).toBeDefined()
		expect(result?.imageUrl).toBe('/assets/my-image_2x.jpg')
	})

	test('ignores non-bg classes like px-4, flex, etc', () => {
		const result = extractBackgroundImageClasses("px-4 flex items-center bg-[url('/test.png')] rounded-lg shadow-md")
		expect(result).toBeDefined()
		expect(result?.bgImageClass).toBe("bg-[url('/test.png')]")
		expect(result?.imageUrl).toBe('/test.png')
		expect(result?.bgSize).toBeUndefined()
		expect(result?.bgPosition).toBeUndefined()
		expect(result?.bgRepeat).toBeUndefined()
	})

	test('only returns last bg-[url()] if multiple present (keeps last)', () => {
		const result = extractBackgroundImageClasses("bg-[url('/first.png')] bg-[url('/second.png')]")
		expect(result).toBeDefined()
		expect(result?.bgImageClass).toBe("bg-[url('/second.png')]")
		expect(result?.imageUrl).toBe('/second.png')
	})
})
