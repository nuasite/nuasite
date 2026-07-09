import { describe, expect, test } from 'bun:test'
import { buildRouteMap, type ResolvedRouteLike } from '../../src/route-map-writer'

/** A dynamic route whose `generate` interpolates params into `prefix/<param>` (with optional base). */
function dynamicRoute(entrypoint: string, prefix: string, params: string[] = ['slug'], base = ''): ResolvedRouteLike {
	const dynamicParam = params[0] ?? 'slug'
	const segments = [
		...prefix.split('/').filter(Boolean).map(content => [{ content, dynamic: false, spread: false }]),
		[{ content: dynamicParam, dynamic: true, spread: false }],
	]
	return {
		type: 'page',
		params,
		segments,
		entrypoint,
		generate: (data = {}) => `${base}${prefix}/${params.map(p => data[p] ?? '').join('/')}`,
	}
}

function staticRoute(entrypoint: string, pathname: string): ResolvedRouteLike {
	return {
		type: 'page',
		params: [],
		pathname,
		segments: pathname.split('/').filter(Boolean).map(content => [{ content, dynamic: false, spread: false }]),
		entrypoint,
		generate: () => pathname,
	}
}

const gsp = (collection: string) =>
	`---\nimport { getCollection } from 'astro:content'\nexport async function getStaticPaths() {\n  const items = await getCollection('${collection}')\n  return items.map((e) => ({ params: { slug: e.data.slug }, props: { entry: e } }))\n}\n---\n<h1>x</h1>\n`

const sourceOf = (map: Record<string, string>) => async (entrypoint: string) => map[entrypoint] ?? null

describe('buildRouteMap', () => {
	test('maps a per-item collection to its authoritative base from Astro generate', async () => {
		const routes = [dynamicRoute('src/pages/produkty/[slug].astro', '/produkty')]
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/produkty/[slug].astro': gsp('products') }))
		expect(map).toEqual({ products: { base: '/produkty', perItem: true } })
	})

	test("carries the config `base` prefix that a filepath scan can't see", async () => {
		const routes = [dynamicRoute('src/pages/produkty/[slug].astro', '/produkty', ['slug'], '/app')]
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/produkty/[slug].astro': gsp('products') }))
		expect(map.products).toEqual({ base: '/app/produkty', perItem: true })
	})

	test('a root-level [slug] route yields base `/`', async () => {
		const routes = [dynamicRoute('src/pages/[slug].astro', '')]
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/[slug].astro': gsp('pages') }))
		expect(map.pages).toEqual({ base: '/', perItem: true })
	})

	test('captures every collection a shared detail drives', async () => {
		const src =
			`---\nimport { getCollection } from 'astro:content'\nexport async function getStaticPaths() {\n  const [a, b] = await Promise.all([getCollection('products'), getCollection('references')])\n  return [...a, ...b].map((e) => ({ params: { slug: e.data.slug }, props: { entry: e } }))\n}\n---\n`
		const routes = [dynamicRoute('src/pages/[slug].astro', '')]
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/[slug].astro': src }))
		expect(map).toEqual({ products: { base: '/', perItem: true }, references: { base: '/', perItem: true } })
	})

	test('maps a static listing page to its own URL, no slug', async () => {
		const routes = [staticRoute('src/pages/faq.astro', '/faq')]
		const src = `---\nimport { getCollection } from 'astro:content'\nconst faqs = await getCollection('faq')\n---\n`
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/faq.astro': src }))
		expect(map.faq).toEqual({ base: '/faq', perItem: false })
	})

	test('the first route (default locale) wins over a later locale-prefixed duplicate', async () => {
		const routes = [
			dynamicRoute('src/pages/produkty/[slug].astro', '/produkty'),
			dynamicRoute('src/pages/produkty/[slug].astro', '/produkty', ['slug'], '/de'),
		]
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/produkty/[slug].astro': gsp('products') }))
		expect(map.products).toEqual({ base: '/produkty', perItem: true })
	})

	test('per-item beats a shared page for the same collection regardless of order', async () => {
		const routes = [
			staticRoute('src/pages/produkty.astro', '/produkty'),
			dynamicRoute('src/pages/detail/[slug].astro', '/detail'),
		]
		const map = await buildRouteMap(
			routes,
			sourceOf({
				'src/pages/produkty.astro': `---\nimport { getCollection } from 'astro:content'\nconst p = await getCollection('products')\n---\n`,
				'src/pages/detail/[slug].astro': gsp('products'),
			}),
		)
		expect(map.products).toEqual({ base: '/detail', perItem: true })
	})

	test('falls back to segment prefix when generate throws', async () => {
		const route: ResolvedRouteLike = {
			type: 'page',
			params: ['slug'],
			segments: [[{ content: 'produkty', dynamic: false, spread: false }], [{ content: 'slug', dynamic: true, spread: false }]],
			entrypoint: 'src/pages/produkty/[slug].astro',
			generate: () => {
				throw new Error('boom')
			},
		}
		const map = await buildRouteMap([route], sourceOf({ 'src/pages/produkty/[slug].astro': gsp('products') }))
		expect(map.products).toEqual({ base: '/produkty', perItem: true })
	})

	test('ignores endpoints, non-astro entrypoints, and pages with no getCollection', async () => {
		const routes: ResolvedRouteLike[] = [
			{ type: 'endpoint', params: [], segments: [], entrypoint: 'src/pages/rss.xml.js', generate: () => '/rss.xml' },
			staticRoute('src/pages/about.astro', '/about'),
		]
		const map = await buildRouteMap(routes, sourceOf({ 'src/pages/about.astro': `---\nconst title = 'About'\n---\n` }))
		expect(map).toEqual({})
	})
})
