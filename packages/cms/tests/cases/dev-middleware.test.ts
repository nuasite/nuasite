import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { enhanceManifestInBackground } from '../../src/dev-middleware'
import { ManifestWriter } from '../../src/manifest-writer'
import { clearSourceFinderCache } from '../../src/source-finder'
import type { CmsMarkerOptions, CollectionDefinition, ManifestEntry } from '../../src/types'
import { defaultMockConfig } from '../utils/mocks'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../utils/temp-directory'

const config: Required<CmsMarkerOptions> = {
	...defaultMockConfig,
	excludeTags: ['script', 'style', 'noscript', 'svg', 'path'],
	manifestFile: 'cms-manifest.json',
	seo: {},
}

function makeNewsDefs(
	entries: CollectionDefinition['entries'],
): Record<string, CollectionDefinition> {
	return {
		news: {
			name: 'news',
			label: 'News',
			path: 'src/content/news',
			entryCount: entries?.length ?? 0,
			fields: [
				{ name: 'title', type: 'text', required: true },
				{ name: 'image', type: 'image', required: true },
			],
			fileExtension: 'mdx',
			entries,
		},
	}
}

const newsArticle = `---\ntitle: My News Title\nimage: ./hero.jpg\n---\n\nBody content.`

describe('enhanceManifestInBackground — collection text on listing pages', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('dev-mw-')
		await ctx.mkdir('src/components')
		await ctx.mkdir('src/pages')
		await ctx.mkdir('src/layouts')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	test('resolves collection text to data file via lookupCollectionText fallback', async () => {
		// The literal text does NOT appear in the template — it's fetched dynamically
		// via getCollection(), so AST/variable lookup won't find it and resolution
		// must fall through to lookupCollectionText.
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const allNews = await getCollection("news")',
				'const articles = allNews.map(n => ({ ...n.data, url: `/news/${n.id}` }))',
				'---',
				'<div>',
				'  {articles.map(a => (',
				'    <a href={a.url}>{a.title}</a>',
				'  ))}',
				'</div>',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/my-article.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'my-article', sourcePath: 'src/content/news/my-article.mdx' }])

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'a',
				text: 'My News Title',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 8,
			},
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/my-article.mdx')
		expect(entry?.sourceSnippet).toContain('title:')
		expect(entry?.sourceSnippet).toContain('My News Title')
		expect(entry?.collectionName).toBe('news')
		expect(entry?.collectionSlug).toBe('my-article')
	})

	test('resolves JSON data collection text on listing page', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const allPartners = await getCollection("partners")',
				'const partners = allPartners.map(p => p.data)',
				'---',
				'<div>',
				'  {partners.map(p => (',
				'    <span>{p.name}</span>',
				'  ))}',
				'</div>',
			].join('\n'),
		)
		await ctx.writeFile('src/content/partners/acme.json', JSON.stringify({ name: 'ACME Corp', logo: '/logo.png' }, null, 2))

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
			'cms-1': { id: 'cms-1', tag: 'span', text: 'ACME Corp', sourcePath: 'src/pages/index.astro', sourceLine: 8 },
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/partners', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/partners')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/partners/acme.json')
		expect(entry?.sourceSnippet).toContain('ACME Corp')
		expect(entry?.collectionName).toBe('partners')
	})

	test('resolves collection text with .data. expression via field name extraction', async () => {
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
		await ctx.writeFile('src/content/news/my-article.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'my-article', sourcePath: 'src/content/news/my-article.mdx' }])

		const entries: Record<string, ManifestEntry> = {
			'cms-wrapper': {
				id: 'cms-wrapper',
				tag: 'div',
				text: '',
				sourcePath: 'src/pages/listing.astro',
				collectionName: 'news',
				collectionSlug: 'my-article',
			},
			'cms-1': {
				id: 'cms-1',
				tag: 'a',
				text: 'My Article Title',
				sourcePath: 'src/pages/listing.astro',
				sourceLine: 7,
				parentComponentId: 'cms-wrapper',
			},
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/listing', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/listing')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/my-article.mdx')
		expect(entry?.collectionName).toBe('news')
		expect(entry?.collectionSlug).toBe('my-article')
	})

	test('without collectionDefinitions, text stays at template source', async () => {
		await ctx.writeFile('src/pages/index.astro', '---\nconst title = "Hello World"\n---\n<h1>{title}</h1>')

		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'h1', text: 'Hello World', sourcePath: 'src/pages/index.astro', sourceLine: 4 },
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, undefined, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
	})

	test('fallback: entry without sourcePath still resolves via search index', async () => {
		await ctx.writeFile('src/pages/index.astro', '---\n---\n<h1>Static Title</h1>')

		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'h1', text: 'Static Title' },
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, undefined, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.sourceLine).toBeDefined()
	})
})
