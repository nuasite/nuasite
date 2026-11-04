import { expect, test } from 'bun:test'
import { mappedRoutes } from '../../src/route-map-writer'

test('keeps the page routes, with entrypoints relative to the root, and leaves out what the sidecar cannot read', () => {
	const routes = mappedRoutes([
		{ type: 'page', entrypoint: 'src/pages/blog/[slug].astro', pattern: '/blog/[slug]' },
		{ type: 'page', entrypoint: '/site/src/routes/author.astro', pattern: '/people/[id]' },
		{ type: 'endpoint', entrypoint: 'src/pages/feed.xml.ts', pattern: '/feed.xml' },
		{ type: 'page', entrypoint: '/elsewhere/page.astro', pattern: '/elsewhere' },
	], '/site')

	expect(routes).toEqual([
		{ entrypoint: 'src/pages/blog/[slug].astro', pattern: '/blog/[slug]' },
		{ entrypoint: 'src/routes/author.astro', pattern: '/people/[id]' },
	])
})
