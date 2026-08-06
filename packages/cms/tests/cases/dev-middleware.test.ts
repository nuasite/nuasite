import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	buildCollectionManifestPages,
	discoverCollectionRoutes,
	enhanceManifestInBackground,
	invalidateCollectionRoutesCache,
} from '../../src/dev-middleware'
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

describe('discoverCollectionRoutes — dynamic route detection', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		invalidateCollectionRoutesCache()
		ctx = await createTempDir('dev-mw-routes-')
		await ctx.mkdir('src/pages')
	})

	afterEach(async () => {
		invalidateCollectionRoutesCache()
		await cleanupTempDir(ctx)
	})

	test('records a usable static prefix for a purely static route file', async () => {
		await ctx.mkdir('src/pages/blog')
		await ctx.writeFile(
			'src/pages/blog/[slug].astro',
			'---\nimport { getCollection } from "astro:content"\nconst posts = await getCollection("blog")\n---\n',
		)

		const routes = await discoverCollectionRoutes()
		expect(routes.get('blog')).toBe('/blog/')
	})

	test('records `true` (routed, no static prefix) for a dynamic ancestor directory', async () => {
		await ctx.mkdir('src/pages/[topic]')
		await ctx.writeFile(
			'src/pages/[topic]/[slug].astro',
			'---\nimport { getCollection } from "astro:content"\nconst articles = await getCollection("articles")\n---\n',
		)

		const routes = await discoverCollectionRoutes()
		expect(routes.get('articles')).toBe(true)
	})

	test('does not record a collection no page ever calls getCollection() on', async () => {
		await ctx.mkdir('src/pages/blog')
		await ctx.writeFile(
			'src/pages/blog/[slug].astro',
			'---\nimport { getCollection } from "astro:content"\nconst posts = await getCollection("blog")\n---\n',
		)

		const routes = await discoverCollectionRoutes()
		expect(routes.get('team')).toBeUndefined()
	})
})

describe('buildCollectionManifestPages — fragment collections own no URL', () => {
	/** A collection keyed as `name` with one entry per slug. */
	function makeDef(
		name: string,
		slugs: string[],
		overrides: Partial<CollectionDefinition> = {},
	): CollectionDefinition {
		return {
			name,
			label: name,
			path: `src/content/${name}`,
			entryCount: slugs.length,
			fields: [{ name: 'title', type: 'text', required: true }],
			fileExtension: 'md',
			entries: slugs.map(slug => ({ slug, title: slug, sourcePath: `src/content/${name}/${slug}.md` })),
			...overrides,
		}
	}

	test('a fragment collection keeps pathname undefined even under a discovered route prefix', () => {
		const def = makeDef('kratceZNezisku', ['pozice-1'], { fragment: true })
		const routes = new Map<string, string | true>([['kratceZNezisku', '/aktualne/']])

		const { collectionDefinitions, entryPages } = buildCollectionManifestPages({ kratceZNezisku: def }, routes)

		expect(collectionDefinitions['kratceZNezisku']?.entries?.[0]?.pathname).toBeUndefined()
		// …and it contributes no page, so nothing claims `/aktualne/pozice-1`.
		expect(entryPages).toEqual([])
	})

	test('a fragment collection drops the pathname addPage() left from the page that rendered it', () => {
		// `tags` renders inside `/burza-prace`; manifest-writer's addPage() stamped that URL
		// onto the entry. It is the listing page's URL, not the tag's.
		const def = makeDef('tags', ['prace'], { fragment: true })
		def.entries![0]!.pathname = '/burza-prace'

		const { collectionDefinitions, entryPages } = buildCollectionManifestPages({ tags: def }, new Map())

		expect(collectionDefinitions['tags']?.entries?.[0]?.pathname).toBeUndefined()
		expect(entryPages).toEqual([])
		// The scanned definition is left alone — only the response copy is projected.
		expect(def.entries![0]!.pathname).toBe('/burza-prace')
	})

	test('a fragment collection ignores a frontmatter-declared site path', () => {
		const def = makeDef('testimonials', ['jana'], { fragment: true })
		def.entries![0]!.data = { title: 'Jana', urlPath: '/reference/jana' }

		const { collectionDefinitions, entryPages } = buildCollectionManifestPages({ testimonials: def }, new Map([['testimonials', true as const]]))

		expect(collectionDefinitions['testimonials']?.entries?.[0]?.pathname).toBeUndefined()
		expect(entryPages).toEqual([])
	})

	test('previewOf becomes the entry preview target without claiming the target page', () => {
		const fragment = makeDef('kratceZNezisku', ['pozice-1'], { fragment: true, previewOf: '/aktualne' })
		const articles = makeDef('articles', ['prvni-clanek'])
		const routes = new Map<string, string | true>([['kratceZNezisku', '/aktualne/'], ['articles', '/aktualne/']])

		const { collectionDefinitions, entryPages } = buildCollectionManifestPages(
			{ kratceZNezisku: fragment, articles },
			routes,
		)

		const entry = collectionDefinitions['kratceZNezisku']?.entries?.[0]
		expect(entry?.previewPathname).toBe('/aktualne')
		expect(entry?.pathname).toBeUndefined()

		// `/aktualne` is a real page of the site: it must reach the manifest from the
		// filesystem page scan, never as a page contributed by this entry.
		expect(entryPages.map(p => p.pathname)).toEqual(['/aktualne/prvni-clanek'])

		// Same merge the manifest middleware does: discovered pages first, entry pages on top.
		const pageMap = new Map<string, { pathname: string; title?: string }>([['/aktualne', { pathname: '/aktualne' }]])
		for (const page of entryPages) pageMap.set(page.pathname, page)
		expect(pageMap.get('/aktualne')).toEqual({ pathname: '/aktualne' })
	})

	test('previewOf without fragment is not surfaced on entries', () => {
		const def = makeDef('articles', ['prvni-clanek'], { previewOf: '/aktualne' })

		const { collectionDefinitions } = buildCollectionManifestPages({ articles: def }, new Map())

		expect(collectionDefinitions['articles']?.entries?.[0]?.previewPathname).toBeUndefined()
	})

	test('regression: a collection without fragment still gets the route-prefix fallback', () => {
		// Post-issue-01 shape: the config key (`kratceZNezisku`) survives the merge with its
		// scanned directory (`kratce-z-nezisku`), and that key is what
		// discoverCollectionRoutes() matched in `getCollection('kratceZNezisku')`.
		const def = makeDef('kratceZNezisku', ['pozice-1', 'pozice-2'], { path: 'src/content/kratce-z-nezisku' })
		const routes = new Map<string, string | true>([['kratceZNezisku', '/aktualne/']])

		const { collectionDefinitions, entryPages } = buildCollectionManifestPages({ kratceZNezisku: def }, routes)

		expect(collectionDefinitions['kratceZNezisku']?.entries?.map(e => e.pathname)).toEqual([
			'/aktualne/pozice-1',
			'/aktualne/pozice-2',
		])
		expect(entryPages).toEqual([
			{ pathname: '/aktualne/pozice-1', title: 'pozice-1' },
			{ pathname: '/aktualne/pozice-2', title: 'pozice-2' },
		])
	})

	test('regression: the fallback order (spec → addPage → declared path → prefix) is unchanged', () => {
		const spec = makeDef('events', ['expo'], { pathname: [{ literal: 'akce' }, { field: 'slug' }] })
		spec.entries![0]!.data = { slug: 'expo', urlPath: '/ignored' }
		spec.entries![0]!.pathname = '/also-ignored'

		const rendered = makeDef('news', ['hello'])
		rendered.entries![0]!.pathname = '/blog/hello'

		const declared = makeDef('partners', ['acme'])
		declared.entries![0]!.data = { urlPath: '/o-nas/acme' }

		const prefixed = makeDef('team', ['jana'])

		const routes = new Map<string, string | true>([
			['events', '/events/'],
			['news', '/news/'],
			['partners', true as const],
			['team', '/tym/'],
		])

		const { collectionDefinitions } = buildCollectionManifestPages({ events: spec, news: rendered, partners: declared, team: prefixed }, routes)

		expect(collectionDefinitions['events']?.entries?.[0]?.pathname).toBe('/akce/expo')
		expect(collectionDefinitions['news']?.entries?.[0]?.pathname).toBe('/blog/hello')
		expect(collectionDefinitions['partners']?.entries?.[0]?.pathname).toBe('/o-nas/acme')
		expect(collectionDefinitions['team']?.entries?.[0]?.pathname).toBe('/tym/jana')
	})

	test('regression: an unrouted collection gets no pathname at all', () => {
		const def = makeDef('settings', ['general'])
		def.entries![0]!.data = { url: 'https://example.com' }

		const { collectionDefinitions, entryPages } = buildCollectionManifestPages({ settings: def }, new Map())

		expect(collectionDefinitions['settings']?.entries?.[0]?.pathname).toBeUndefined()
		expect(entryPages).toEqual([])
		// Nothing to patch → the definition passes through by identity.
		expect(collectionDefinitions['settings']).toBe(def)
	})
})
