import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { manifestUrlForPage, noteTargetEntry } from '../src/overlay/lib/manifest-fetch'
import type { CmsPageManifest } from '../src/overlay/types'

describe('manifestUrlForPage', () => {
	test('root page maps to /index.json', () => {
		expect(manifestUrlForPage('/')).toBe('/index.json')
		expect(manifestUrlForPage('')).toBe('/index.json')
	})

	test('simple page path', () => {
		expect(manifestUrlForPage('/about')).toBe('/about.json')
		expect(manifestUrlForPage('/inspekce-nemovitosti')).toBe('/inspekce-nemovitosti.json')
	})

	test('strips leading and trailing slashes', () => {
		expect(manifestUrlForPage('/about/')).toBe('/about.json')
	})

	test('nested paths', () => {
		expect(manifestUrlForPage('/blog/post')).toBe('/blog/post.json')
	})
})

describe('noteTargetEntry', () => {
	afterEach(() => {
		mock.restore()
	})

	const manifest: CmsPageManifest = {
		page: '/about',
		entries: {
			'cms-0': { tag: 'h1', text: 'Hello', sourcePath: 'src/pages/about.astro', sourceLine: 3 },
			'cms-1': { tag: 'p', text: 'Tagline' },
		},
	}

	test('an entry with a source is used as it is, without a request', async () => {
		const fetchSpy = spyOn(globalThis, 'fetch')
		const target = await noteTargetEntry(manifest, '/about', 'cms-0')
		expect(target.entry?.sourcePath).toBe('src/pages/about.astro')
		expect(target.manifest).toBe(manifest)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('an entry without a source is located through the page manifest', async () => {
		const located: CmsPageManifest = {
			page: '/about',
			entries: { ...manifest.entries, 'cms-1': { tag: 'p', text: 'Tagline', sourcePath: 'src/data/site.ts', sourceLine: 2 } },
		}
		const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(located))
		const target = await noteTargetEntry(manifest, '/about', 'cms-1')
		expect(fetchSpy.mock.calls[0]?.[0]).toBe('/about.json?locate=cms-1')
		expect(target.entry?.sourcePath).toBe('src/data/site.ts')
		expect(target.manifest).toEqual(located)
	})

	test('a failed request keeps the entry it had', async () => {
		spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
		const target = await noteTargetEntry(manifest, '/about', 'cms-1')
		expect(target.entry).toEqual({ tag: 'p', text: 'Tagline' })
		expect(target.manifest).toBe(manifest)
	})
})
