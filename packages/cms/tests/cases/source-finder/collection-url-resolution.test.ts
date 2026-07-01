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

import { expect, test } from 'bun:test'
import { findCollectionSource } from '../../../src/source-finder'
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
