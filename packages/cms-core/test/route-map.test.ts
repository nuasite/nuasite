import { describe, expect, test } from 'bun:test'
import { normalizeSiteBase, parseRouteMap, serializeRouteMap, sitePathname } from '../src/route-map.ts'

describe('sitePathname', () => {
	test('puts a route path under the base, with the trailing slash the site uses', () => {
		expect(sitePathname('/blog/post', { base: '', trailingSlash: 'ignore' })).toBe('/blog/post')
		expect(sitePathname('/blog/post', { base: '/docs', trailingSlash: 'never' })).toBe('/docs/blog/post')
		expect(sitePathname('/blog/post', { base: '/docs', trailingSlash: 'always' })).toBe('/docs/blog/post/')
		expect(sitePathname('/blog/', { base: '', trailingSlash: 'never' })).toBe('/blog')
	})

	test('the index is the base itself', () => {
		expect(sitePathname('/', { base: '', trailingSlash: 'always' })).toBe('/')
		expect(sitePathname('/', { base: '/docs', trailingSlash: 'ignore' })).toBe('/docs')
		expect(sitePathname('/', { base: '/docs', trailingSlash: 'always' })).toBe('/docs/')
	})
})

test('normalizeSiteBase spells every form of the config base one way', () => {
	expect(['/', '', '/docs', '/docs/', 'docs'].map(normalizeSiteBase)).toEqual(['', '', '/docs', '/docs', '/docs'])
})

describe('parseRouteMap', () => {
	test('reads back what serializeRouteMap writes', () => {
		const map = { base: '/docs', trailingSlash: 'always' as const, routes: [{ entrypoint: 'src/pages/[slug].astro', pattern: '/[slug]' }] }
		expect(parseRouteMap(serializeRouteMap(map))).toEqual(map)
	})

	test('refuses another version, a broken file and unknown settings, and drops malformed routes', () => {
		expect(parseRouteMap('{"version":2,"base":"","trailingSlash":"ignore","routes":[]}')).toBeNull()
		expect(parseRouteMap('{')).toBeNull()
		expect(parseRouteMap('{"version":1,"base":"","trailingSlash":"sometimes","routes":[]}')).toBeNull()
		expect(parseRouteMap('{"version":1,"base":"","trailingSlash":"ignore","routes":[{"entrypoint":1},{"entrypoint":"a.astro","pattern":"/a"}]}'))
			.toEqual({ base: '', trailingSlash: 'ignore', routes: [{ entrypoint: 'a.astro', pattern: '/a' }] })
	})
})
