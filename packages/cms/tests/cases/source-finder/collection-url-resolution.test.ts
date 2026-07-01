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

	test('returns undefined for a non-collection page', async () => {
		const ctx = getCtx()
		await ctx.mkdir('content/articles')
		await ctx.writeFile('content/articles/foo.md', article('/alpha/foo', 'Alpha Foo'))

		expect(await findCollectionSource('/kontakty', 'content')).toBeUndefined()
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
