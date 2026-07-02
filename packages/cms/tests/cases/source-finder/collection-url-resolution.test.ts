/**
 * Source finder tests: collection URL resolution
 *
 * A flat collection can hold two entries that share a slug but render under
 * different URL prefixes (e.g. the same article slug published under two topic
 * prefixes). Their files must have distinct names, so one carries a
 * disambiguating suffix and its filename no longer equals its slug. Filename
 * matching alone then maps both URLs to the same (wrong) file. These tests pin
 * that `findCollectionSource` disambiguates by the entry's declared `urlPath`,
 * while entries that declare no URL keep the legacy filename behavior.
 */

import { describe, expect, test } from 'bun:test'
import { declaredSitePathFromData, findCollectionSource } from '../../../src/source-finder'
import type { CollectionDefinition } from '../../../src/types'
import { withTempDir } from '../../utils'

function article(urlPath: string, title: string): string {
	return `---\nslug: "${urlPath.split('/').pop()}"\nurlPath: "${urlPath}"\ntitle: "${title}"\n---\n\nBody of ${title}.\n`
}

withTempDir('findCollectionSource - URL-based disambiguation', (getCtx) => {
	test('resolves same-slug entries under different prefixes to the right file', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/articles')
		// Same slug `foo`, two topic prefixes. The `beta` one is filename-suffixed
		// for on-disk uniqueness; its filename (`foo-beta`) != its slug (`foo`).
		await ctx.writeFile('content/articles/foo.md', article('/alpha/foo', 'Alpha Foo'))
		await ctx.writeFile('content/articles/foo-beta.md', article('/beta/foo', 'Beta Foo'))

		const alpha = await findCollectionSource('/alpha/foo', 'content')
		expect(alpha?.file).toBe('content/articles/foo.md')

		// Before the fix this incorrectly resolved to `foo.md` (the un-suffixed
		// sibling), because `/beta/foo` strips to slug `foo` -> `foo.md`.
		const beta = await findCollectionSource('/beta/foo', 'content')
		expect(beta?.file).toBe('content/articles/foo-beta.md')
		// slug must describe the resolved file (foo-beta.md), not the
		// URL-tail candidate (`foo`) that led to it — collectionSlug lookups
		// downstream key off the file's real slug.
		expect(beta?.slug).toBe('foo-beta')
	})

	test('does not treat a `canonical` field as self-declared identity', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/articles')
		// The filename match for slug `product-b` declares a locale-prefixed
		// urlPath, so it contradicts the (locale-less) requested path and
		// triggers the declared-URL fallback scan of the directory.
		await ctx.writeFile(
			'content/articles/product-b.md',
			`---\nslug: "product-b"\nurlPath: "/en/products/product-b"\ntitle: "Product B"\n---\n\nBody.\n`,
		)
		// An unrelated duplicate/syndicated entry whose `canonical` field points
		// at product-b's preferred URL per normal SEO convention — it does not
		// declare *itself* as that page.
		await ctx.writeFile(
			'content/articles/product-b-clone.md',
			`---\nslug: "product-b-clone"\ncanonical: "/products/product-b"\ntitle: "Clone"\n---\n\nBody.\n`,
		)

		const res = await findCollectionSource('/products/product-b', 'content')
		// Must not be misdirected to the clone via its `canonical` field.
		expect(res?.file).not.toBe('content/articles/product-b-clone.md')
		expect(res?.file).toBe('content/articles/product-b.md')
	})

	test('keeps the fast filename path for non-colliding entries', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/articles')
		await ctx.writeFile('content/articles/only.md', article('/alpha/only', 'Only'))

		const res = await findCollectionSource('/alpha/only', 'content')
		expect(res?.file).toBe('content/articles/only.md')
		expect(res?.name).toBe('articles')
		expect(res?.slug).toBe('only')
	})

	test('falls back to filename matching when entries declare no URL', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/news')
		// No urlPath/permalink/etc. — filename-only projects must be unaffected.
		await ctx.writeFile('content/news/hello.md', `---\ntitle: "Hello"\n---\n\nHi.\n`)

		const res = await findCollectionSource('/blog/hello', 'content')
		expect(res?.file).toBe('content/news/hello.md')
	})

	test('resolves an entry whose filename shares nothing with its URL slug', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/people')
		// People-style: filename encodes a role (`<role>__<slug>.md`) and the page
		// is served at `/<family>/<slug>`, so no URL tail segment ever matches a
		// `<slug>.md` file — the tail-slug loop finds nothing. Resolution must fall
		// back to the declared urlPath.
		await ctx.writeFile(
			'content/people/expert__denia-ratajova.md',
			`---\nslug: "denia-ratajova"\nurlPath: "/lide-sveta-neziskovek/denia-ratajova"\ntitle: "Denia"\n---\n\nBio.\n`,
		)

		const res = await findCollectionSource('/lide-sveta-neziskovek/denia-ratajova', 'content')
		expect(res?.file).toBe('content/people/expert__denia-ratajova.md')
		expect(res?.name).toBe('people')
		expect(res?.slug).toBe('expert__denia-ratajova')
	})

	test('returns undefined for a non-collection page (no declared-URL match)', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/articles')
		await ctx.writeFile('content/articles/foo.md', article('/alpha/foo', 'Alpha Foo'))

		// Even with the declared-URL fallback, a path no entry declares stays unresolved.
		expect(await findCollectionSource('/kontakty', 'content')).toBeUndefined()
	})

	test('does not resolve a single-segment path via the declared-URL fallback', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/pages')
		// An entry declaring a bare single-segment URL. Single-segment requests are
		// almost always static pages (e.g. `/about`); the tail-slug loop never
		// treated them as collection pages, so the fallback must not either — this
		// prevents mis-attributing a static page to a collection entry.
		await ctx.writeFile(
			'content/pages/x.md',
			`---\nslug: "about"\nurlPath: "/about"\ntitle: "About"\n---\n\nBody.\n`,
		)

		expect(await findCollectionSource('/about', 'content')).toBeUndefined()
	})
})

// A collection's declarative `cms.pathname` rule is the highest-priority source
// for reverse resolution: findCollectionSource derives each entry's canonical URL
// from the rule + the entry's frontmatter data and matches it, so URL → source
// works with NO `urlPath` frontmatter and even when the filename differs from the
// URL slug (people stored as `<role>__<slug>.md`). The scanned definitions are
// threaded in from `manifestWriter.getCollectionDefinitions()` on the hot path.
describe('findCollectionSource - cms.pathname spec resolution', () => {
	function makeDef(name: string, pathname: CollectionDefinition['pathname'], entries: CollectionDefinition['entries']): CollectionDefinition {
		return { name, label: name, path: `content/${name}`, entryCount: entries?.length ?? 0, fields: [], fileExtension: 'md', type: 'content', pathname, entries }
	}

	test('resolves a people entry whose filename encodes a role, via urlFamily + slug', async () => {
		const collections = {
			people: makeDef('people', [{ field: 'urlFamily' }, { field: 'slug' }], [
				{ slug: 'expert__adela-lancova', sourcePath: 'content/people/expert__adela-lancova.md', data: { urlFamily: 'lide-sveta-neziskovek', slug: 'adela-lancova' } },
			]),
		}
		const res = await findCollectionSource('/lide-sveta-neziskovek/adela-lancova', 'content', collections)
		expect(res?.file).toBe('content/people/expert__adela-lancova.md')
		expect(res?.name).toBe('people')
		expect(res?.slug).toBe('expert__adela-lancova')
	})

	test('applies a segment `map` (topic → route prefix) when deriving the URL', async () => {
		const collections = {
			articles: makeDef('articles', [{ field: 'topic', map: { aktualne: 'aktualne-z-nezisku' } }, { field: 'slug' }], [
				{ slug: 'foo', sourcePath: 'content/articles/foo.md', data: { topic: 'aktualne', slug: 'foo' } },
			]),
		}
		const res = await findCollectionSource('/aktualne-z-nezisku/foo', 'content', collections)
		expect(res?.file).toBe('content/articles/foo.md')
		expect(res?.slug).toBe('foo')
	})

	test('disambiguates same-slug entries across collections by their derived URL', async () => {
		const collections = {
			articles: makeDef('articles', [{ field: 'topic' }, { field: 'slug' }], [
				{ slug: 'foo', sourcePath: 'content/articles/foo.md', data: { topic: 'fundraising', slug: 'foo' } },
				{ slug: 'foo-lide', sourcePath: 'content/articles/foo-lide.md', data: { topic: 'lide', slug: 'foo' } },
			]),
		}
		expect((await findCollectionSource('/fundraising/foo', 'content', collections))?.file).toBe('content/articles/foo.md')
		expect((await findCollectionSource('/lide/foo', 'content', collections))?.file).toBe('content/articles/foo-lide.md')
	})

	test('a URL no spec produces stays unresolved (does not misattribute)', async () => {
		const collections = {
			podcasts: makeDef('podcasts', [{ literal: 'podcast' }, { field: 'slug' }], [
				{ slug: 'ep1', sourcePath: 'content/podcasts/ep1.md', data: { slug: 'ep1' } },
			]),
		}
		expect((await findCollectionSource('/podcast/ep1', 'content', collections))?.file).toBe('content/podcasts/ep1.md')
		// `/kontakty` is not derivable from any spec → undefined (contentDir absent).
		expect(await findCollectionSource('/kontakty', 'content', collections)).toBeUndefined()
	})
})

// declaredSitePathFromData powers the collections browser's entry links: when a
// collection is served under a dynamic route prefix (e.g. [topic]/[slug]) that
// can't be discovered statically, the entry's own declared urlPath is used as
// its pathname instead of a guessed prefix + slug.
describe('declaredSitePathFromData', () => {
	test('returns the declared urlPath, normalized', () => {
		expect(declaredSitePathFromData({ urlPath: '/lide/kdo-jsme' })).toBe('/lide/kdo-jsme')
		expect(declaredSitePathFromData({ urlPath: '/lide/kdo-jsme/' })).toBe('/lide/kdo-jsme')
	})

	test('honors field preference order (urlPath before url)', () => {
		expect(declaredSitePathFromData({ url: '/from-url', urlPath: '/from-urlpath' })).toBe('/from-urlpath')
	})

	test('is case-insensitive on the field key', () => {
		expect(declaredSitePathFromData({ URLPath: '/lide/x' })).toBe('/lide/x')
	})

	test('ignores non-site-absolute values (external URLs, bare slugs)', () => {
		expect(declaredSitePathFromData({ url: 'https://example.com/x' })).toBeUndefined()
		expect(declaredSitePathFromData({ slug: 'kdo-jsme' })).toBeUndefined()
	})

	test('ignores `canonical` (not a self-identity field)', () => {
		expect(declaredSitePathFromData({ canonical: '/products/a' })).toBeUndefined()
	})

	test('returns undefined for missing or non-object data', () => {
		expect(declaredSitePathFromData(undefined)).toBeUndefined()
		expect(declaredSitePathFromData(null)).toBeUndefined()
		expect(declaredSitePathFromData('string')).toBeUndefined()
		expect(declaredSitePathFromData({ title: 'No URL here' })).toBeUndefined()
	})
})
