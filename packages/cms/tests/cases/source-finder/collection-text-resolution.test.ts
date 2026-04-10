import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearSourceFinderCache } from '../../../src/source-finder'
import { enhanceManifestWithSourceSnippets } from '../../../src/source-finder/snippet-utils'
import type { CollectionDefinition, ManifestEntry } from '../../../src/types'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../../utils/temp-directory'

describe('enhanceManifestWithSourceSnippets — collection text', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('enhance-text-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	function makeCollectionDefs(
		overrides: Partial<CollectionDefinition> & { entries: CollectionDefinition['entries'] },
	): Record<string, CollectionDefinition> {
		return {
			news: {
				name: 'news',
				label: 'News',
				path: 'src/content/news',
				entryCount: 1,
				fields: [
					{ name: 'title', type: 'text', required: true },
					{ name: 'excerpt', type: 'textarea', required: false },
					{ name: 'image', type: 'image', required: true },
				],
				fileExtension: 'mdx',
				...overrides,
			},
		}
	}

	test('resolves dynamic text expression {post.data.title} to collection data file', async () => {
		await ctx.writeFile(
			'src/pages/listing.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const posts = await getCollection("news")',
				'---',
				'<div>',
				'  {posts.map(post => (',
				'    <a href={post.slug}>{post.data.title}</a>',
				'  ))}',
				'</div>',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/news/my-article.mdx',
			[
				'---',
				'title: My Article Title',
				'image: ./hero.jpg',
				'---',
				'',
				'Body content.',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			entries: [{ slug: 'my-article', sourcePath: 'src/content/news/my-article.mdx' }],
		})

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'div',
				text: '',
				sourcePath: 'src/pages/listing.astro',
				collectionName: 'news',
				collectionSlug: 'my-article',
			},
			'cms-2': {
				id: 'cms-2',
				tag: 'a',
				text: 'My Article Title',
				sourcePath: 'src/pages/listing.astro',
				sourceLine: 7,
				parentComponentId: 'cms-1',
			},
		}

		const result = await enhanceManifestWithSourceSnippets(entries, defs)

		expect(result['cms-2']!.sourcePath).toBe('src/content/news/my-article.mdx')
		expect(result['cms-2']!.sourceSnippet).toContain('title:')
		expect(result['cms-2']!.sourceSnippet).toContain('My Article Title')
		expect(result['cms-2']!.collectionName).toBe('news')
		expect(result['cms-2']!.collectionSlug).toBe('my-article')
	})

	test('resolves static/hardcoded text to collection data file when same text exists in both', async () => {
		// This is the real-world bug: text is hardcoded in the template but
		// also exists in a collection data file. With collectionName/collectionSlug
		// propagated from the wrapper, we should prefer the collection source.
		await ctx.writeFile(
			'src/pages/featured.astro',
			[
				'---',
				'---',
				'<div>',
				'  <a href="/news/my-article">',
				'    My Article Title',
				'  </a>',
				'</div>',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/news/my-article.mdx',
			[
				'---',
				'title: My Article Title',
				'image: ./hero.jpg',
				'---',
				'',
				'Body content.',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			entries: [{ slug: 'my-article', sourcePath: 'src/content/news/my-article.mdx' }],
		})

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'div',
				text: '',
				sourcePath: 'src/pages/featured.astro',
				collectionName: 'news',
				collectionSlug: 'my-article',
			},
			'cms-2': {
				id: 'cms-2',
				tag: 'a',
				text: 'My Article Title',
				sourcePath: 'src/pages/featured.astro',
				sourceLine: 4,
				parentComponentId: 'cms-1',
			},
		}

		const result = await enhanceManifestWithSourceSnippets(entries, defs)

		// Should resolve to the collection data file, NOT the template
		expect(result['cms-2']!.sourcePath).toBe('src/content/news/my-article.mdx')
		expect(result['cms-2']!.sourceSnippet).toContain('title:')
		expect(result['cms-2']!.collectionName).toBe('news')
		expect(result['cms-2']!.collectionSlug).toBe('my-article')
	})

	test('resolves to correct entry when same text exists in multiple collection entries', async () => {
		await ctx.writeFile(
			'src/pages/listing.astro',
			[
				'---',
				'---',
				'<div>',
				'  <a href="/news/first">Shared Title</a>',
				'  <a href="/news/second">Shared Title</a>',
				'</div>',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/news/first.mdx',
			[
				'---',
				'title: Shared Title',
				'image: ./a.jpg',
				'---',
				'First.',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/news/second.mdx',
			[
				'---',
				'title: Shared Title',
				'image: ./b.jpg',
				'---',
				'Second.',
			].join('\n'),
		)

		const defs: Record<string, CollectionDefinition> = {
			news: {
				name: 'news',
				label: 'News',
				path: 'src/content/news',
				entryCount: 2,
				fields: [
					{ name: 'title', type: 'text', required: true },
					{ name: 'image', type: 'image', required: true },
				],
				fileExtension: 'mdx',
				entries: [
					{ slug: 'first', sourcePath: 'src/content/news/first.mdx' },
					{ slug: 'second', sourcePath: 'src/content/news/second.mdx' },
				],
			},
		}

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'a',
				text: 'Shared Title',
				sourcePath: 'src/pages/listing.astro',
				sourceLine: 4,
				collectionName: 'news',
				collectionSlug: 'first',
			},
			'cms-2': {
				id: 'cms-2',
				tag: 'a',
				text: 'Shared Title',
				sourcePath: 'src/pages/listing.astro',
				sourceLine: 5,
				collectionName: 'news',
				collectionSlug: 'second',
			},
		}

		const result = await enhanceManifestWithSourceSnippets(entries, defs)

		// Each entry should resolve to its own collection file despite identical text
		expect(result['cms-1']!.sourcePath).toBe('src/content/news/first.mdx')
		expect(result['cms-2']!.sourcePath).toBe('src/content/news/second.mdx')
	})

	test('resolves text in JSON data collection', async () => {
		await ctx.writeFile(
			'src/pages/partners.astro',
			[
				'---',
				'---',
				'<div>',
				'  <span>ACME Corp</span>',
				'</div>',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/partners/acme.json',
			JSON.stringify({ name: 'ACME Corp', logo: '/logo.png' }, null, 2),
		)

		const defs: Record<string, CollectionDefinition> = {
			partners: {
				name: 'partners',
				label: 'Partners',
				path: 'src/content/partners',
				entryCount: 1,
				type: 'data',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'logo', type: 'image', required: true },
				],
				fileExtension: 'json',
				entries: [{ slug: 'acme', sourcePath: 'src/content/partners/acme.json' }],
			},
		}

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'span',
				text: 'ACME Corp',
				sourcePath: 'src/pages/partners.astro',
				sourceLine: 4,
				collectionName: 'partners',
				collectionSlug: 'acme',
			},
		}

		const result = await enhanceManifestWithSourceSnippets(entries, defs)

		expect(result['cms-1']!.sourcePath).toBe('src/content/partners/acme.json')
		expect(result['cms-1']!.sourceSnippet).toContain('ACME Corp')
		expect(result['cms-1']!.collectionName).toBe('partners')
	})

	test('hardcoded text without collection context stays at template, collection text resolves to data file', async () => {
		// Same page, same text — one entry has collection context, the other doesn't.
		// This is the real scenario: a featured section with hardcoded text AND
		// a collection listing with the same title rendered dynamically.
		await ctx.writeFile(
			'src/pages/homepage.astro',
			[
				'---',
				'---',
				'<section>',
				'  <h2>My Article Title</h2>',
				'  <div>',
				'    <a href="/news/my-article">My Article Title</a>',
				'  </div>',
				'</section>',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/news/my-article.mdx',
			[
				'---',
				'title: My Article Title',
				'image: ./hero.jpg',
				'---',
				'',
				'Body content.',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			entries: [{ slug: 'my-article', sourcePath: 'src/content/news/my-article.mdx' }],
		})

		const entries: Record<string, ManifestEntry> = {
			// Hardcoded text — no collection context
			'cms-1': {
				id: 'cms-1',
				tag: 'h2',
				text: 'My Article Title',
				sourcePath: 'src/pages/homepage.astro',
				sourceLine: 4,
			},
			// Collection wrapper
			'cms-2': {
				id: 'cms-2',
				tag: 'div',
				text: '',
				sourcePath: 'src/pages/homepage.astro',
				collectionName: 'news',
				collectionSlug: 'my-article',
			},
			// Collection text — gets collectionName/Slug from parent
			'cms-3': {
				id: 'cms-3',
				tag: 'a',
				text: 'My Article Title',
				sourcePath: 'src/pages/homepage.astro',
				sourceLine: 6,
				parentComponentId: 'cms-2',
			},
		}

		const result = await enhanceManifestWithSourceSnippets(entries, defs)

		// Hardcoded text stays at the template (sourcePath NOT redirected to data file)
		expect(result['cms-1']!.sourcePath).toBe('src/pages/homepage.astro')

		// Collection text resolves to the data file
		expect(result['cms-3']!.sourcePath).toBe('src/content/news/my-article.mdx')
		expect(result['cms-3']!.sourceSnippet).toContain('title:')
		expect(result['cms-3']!.collectionName).toBe('news')
		expect(result['cms-3']!.collectionSlug).toBe('my-article')
	})
})
