import { describe, expect, test } from 'bun:test'
import { extractAstroImageOriginalUrl } from '../../src/source-finder/snippet-utils'
import { relativeImportPath } from '../../src/utils'

describe('relativeImportPath', () => {
	test('same directory', () => {
		expect(relativeImportPath('/project/src/pages/index.astro', '/project/src/pages/Hero.astro')).toBe('./Hero.astro')
	})

	test('parent directory', () => {
		expect(relativeImportPath('/project/src/pages/index.astro', '/project/src/components/Card.astro')).toBe('../components/Card.astro')
	})

	test('deeply nested', () => {
		expect(relativeImportPath('/project/src/pages/blog/[slug].astro', '/project/src/components/ui/Button.astro')).toBe(
			'../../components/ui/Button.astro',
		)
	})

	test('same directory with subdirectory target', () => {
		expect(relativeImportPath('/project/src/pages/index.astro', '/project/src/pages/partials/Nav.astro')).toBe('./partials/Nav.astro')
	})

	test('sibling files at root ensure ./ prefix', () => {
		expect(relativeImportPath('/project/a.ts', '/project/b.ts')).toBe('./b.ts')
	})
})

describe('extractAstroImageOriginalUrl', () => {
	test('standard Astro image URL', () => {
		expect(extractAstroImageOriginalUrl('/_image?href=%2Fimages%2Fhero.jpg&w=1024')).toBe('/images/hero.jpg')
	})

	test('with multiple params', () => {
		expect(extractAstroImageOriginalUrl('/_image?href=%2Fassets%2Fphoto.webp&w=800&q=80')).toBe('/assets/photo.webp')
	})

	test('not an Astro URL (regular path)', () => {
		expect(extractAstroImageOriginalUrl('/images/photo.jpg')).toBeUndefined()
	})

	test('not an Astro URL (external)', () => {
		expect(extractAstroImageOriginalUrl('https://cdn.example.com/photo.jpg')).toBeUndefined()
	})

	test('empty string', () => {
		expect(extractAstroImageOriginalUrl('')).toBeUndefined()
	})

	test('Astro URL without href param', () => {
		expect(extractAstroImageOriginalUrl('/_image?w=1024')).toBeUndefined()
	})

	test('Astro sub-path', () => {
		expect(extractAstroImageOriginalUrl('/_image/sub?href=%2Fphoto.jpg')).toBe('/photo.jpg')
	})
})
