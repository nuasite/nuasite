import { describe, expect, test } from 'bun:test'
import type { ChangePayload } from '../../src/editor/types'
import { applyImageChange, findExpressionAltAttribute, findExpressionSrcAttribute } from '../../src/handlers/source-writer'

function makeImageChange(overrides: Partial<ChangePayload>): ChangePayload {
	return {
		cmsId: 'cms-0',
		newValue: '',
		originalValue: '',
		sourcePath: '/test.astro',
		sourceLine: 1,
		sourceSnippet: '',
		...overrides,
	}
}

describe('findExpressionSrcAttribute', () => {
	test.each([
		['simple variable', '<img src={img} alt="test" />', 'src={img}'],
		['property access', '<img src={item.url} alt="test" />', 'src={item.url}'],
		['template literal', '<img src={`/images/${name}.jpg`} alt="test" />', 'src={`/images/${name}.jpg`}'],
		['nested braces', '<img src={getUrl({ id: 1 })} alt="test" />', 'src={getUrl({ id: 1 })}'],
	])('finds expression: %s', (_label, text, expected) => {
		const result = findExpressionSrcAttribute(text)
		expect(result).not.toBeNull()
		expect(text.slice(result!.index, result!.index + result!.length)).toBe(expected)
	})

	test('returns null for static src="..."', () => {
		const result = findExpressionSrcAttribute('<img src="/images/photo.jpg" alt="test" />')
		expect(result).toBeNull()
	})
})

describe('findExpressionAltAttribute', () => {
	test('matches alt with nested template literal', () => {
		const text = 'alt={`${cat.label} - instalace ${imgIdx + 1}`}'
		const result = findExpressionAltAttribute(text)
		expect(result).not.toBeNull()
		expect(text.slice(result!.index, result!.index + result!.length)).toBe(text)
	})

	test('matches alt with simple variable', () => {
		const text = '<img src="x" alt={altText} />'
		const result = findExpressionAltAttribute(text)
		expect(result).not.toBeNull()
		expect(text.slice(result!.index, result!.index + result!.length)).toBe('alt={altText}')
	})
})

describe('applyImageChange', () => {
	test.each([
		['double-quoted', '<img src="/old/image.jpg" alt="Photo" />', '<img src="/uploads/new.jpg" alt="Photo" />'],
		['single-quoted', "<img src='/old/image.jpg' alt='Photo' />", "<img src='/uploads/new.jpg' alt='Photo' />"],
	])('replaces static %s src', (_label, content, expected) => {
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/old/image.jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(expected)
		}
	})

	test('replaces alt text alongside src', () => {
		const content = '<img src="/old/image.jpg" alt="Old description" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/old/image.jpg',
				imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'New description' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="New description" />')
		}
	})

	test('uses URL pathname as fallback candidate', () => {
		const content = '<img src="/images/photo.jpg" alt="test" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: 'https://cdn.example.com/images/photo.jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="test" />')
		}
	})

	test('extracts src from sourceSnippet as fallback candidate', () => {
		const content = '<img src="/assets/photo.png" alt="test" class="w-full" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: 'https://cdn.example.com/optimized/photo.webp',
				sourceSnippet: '<img src="/assets/photo.png" alt="test" class="w-full" />',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="test" class="w-full" />')
		}
	})

	test('expression src={getImageUrl()} is refused rather than corrupted', () => {
		const content = '<div>\n  <img\n    src={getImageUrl()}\n    alt="Photo"\n  />\n</div>'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/rendered/path.jpg',
				sourceLine: 3,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain('dynamic expression')
		}
	})

	test('variable src={imageUrl} is refused rather than corrupted', () => {
		const content = 'const url = "/rendered/path.jpg"\n<div>\n  <img\n    src={imageUrl}\n    alt="Photo"\n  />\n</div>'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/rendered/path.jpg',
				sourceLine: 4,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		// Even though the literal exists in the file, we can't reliably know
		// it's the right one to replace, so refuse the edit
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain('dynamic expression')
		}
	})

	test('returns error when src not found anywhere', () => {
		const content = '<img src="/completely/different.jpg" alt="test" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/nonexistent/image.jpg',
				sourceLine: 0,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(false)
	})

	test('replaces only first occurrence when same src appears multiple times', () => {
		const content = '<img src="/photo.jpg" alt="First" />\n<img src="/photo.jpg" alt="Second" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/photo.jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('src="/uploads/new.jpg"')
			expect(result.content).toContain('src="/photo.jpg"')
		}
	})

	test('escapes special regex characters in src path', () => {
		const content = '<img src="/images/photo (1).jpg" alt="test" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/images/photo (1).jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="test" />')
		}
	})

	test('escapes quotes in alt text', () => {
		const content = '<img src="/photo.jpg" alt="Old" />'
		const result = applyImageChange(
			content,
			makeImageChange({
				originalValue: '/photo.jpg',
				imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'Photo of "sunset"' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('alt="Photo of &quot;sunset&quot;"')
		}
	})

	describe('expression-based src/alt handling', () => {
		test('expression src={img} inside .map() is refused instead of corrupted', () => {
			const content = [
				'{cat.images.map((img, imgIdx) => (',
				'  <img',
				'    src={img}',
				'    alt={`${cat.label} - instalace ${imgIdx + 1}`}',
				'    class="w-full"',
				'  />',
				'))}',
			].join('\n')

			const result = applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/2604-1557-f97ac66b11c3f718b55db500ad4b99fa21bfb60e.png',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/b396a47a-7dec-403b-bfdf-cec65ab44b40.jpeg' },
				}),
			)

			// Should refuse the edit rather than destroying the template
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error).toContain('dynamic expression')
			}
		})

		test('alt expression with nested braces is fully replaced', () => {
			const content = [
				'<img',
				'  src="/assets/photo.jpg"',
				'  alt={`${cat.label} - instalace ${imgIdx + 1}`}',
				'  class="w-full"',
				'/>',
			].join('\n')

			const result = applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/photo.jpg',
					imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'New alt text' },
				}),
			)

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('alt="New alt text"')
				expect(result.content).not.toContain('- instalace ${imgIdx + 1}`}')
			}
		})

		test('alt expression with simple variable (no nested braces) works correctly', () => {
			const content = '<img\n  src="/assets/photo.jpg"\n  alt={altText}\n  class="w-full"\n/>'
			const result = applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/photo.jpg',
					imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'New alt text' },
				}),
			)

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('alt="New alt text"')
				expect(result.content).not.toContain('alt={altText}')
			}
		})
	})
})
