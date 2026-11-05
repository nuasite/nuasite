import { describe, expect, test } from 'bun:test'
import { astroRedirectRejection, redirectsAstroServes } from '../src/redirects'

describe('astroRedirectRejection', () => {
	test.each([
		['/stare', '/nove'],
		['/blog/[slug]', '/clanky/[slug]'],
		['/docs/[...rest]', '/manual/[...rest]'],
		['/a/[$id_2]', '/b/[$id_2]'],
		['/ven', 'https://example.com/'],
		['/letaky/a.pdf', '/uploads/a.pdf'],
	])('passes %s -> %s', (from, to) => {
		expect(astroRedirectRejection(from, to)).toBeNull()
	})

	test.each([
		['/blog-old/[post-id]', '/blog', 'its parameter "[post-id]" is not named with letters, digits, _ or $'],
		['/a/[x][y]', '/b', 'its parameters must be separated'],
		['/a/[x', '/b', 'its brackets are unbalanced'],
		['/mail', 'mailto:info@example.com', 'its destination "mailto:info@example.com" is not an http(s) URL'],
	])('refuses %s -> %s', (from, to, reason) => {
		expect(astroRedirectRejection(from, to)).toBe(reason)
	})
})

describe('redirectsAstroServes', () => {
	test('leaves out the redirects Astro refuses and says which', () => {
		const warnings: string[] = []
		const served = redirectsAstroServes({ '/stare': { destination: '/nove', status: 301 }, '/blog-old/[post-id]': '/blog' }, w => warnings.push(w))

		expect(served).toEqual({ '/stare': { destination: '/nove', status: 301 } })
		expect(warnings).toEqual([
			'The dev server leaves out the redirect from "/blog-old/[post-id]", which Astro rejects: its parameter "[post-id]" is not named with letters, digits, _ or $.',
		])
	})
})
