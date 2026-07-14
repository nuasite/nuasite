import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	discoverCollectionRoutes,
	enhanceManifestInBackground,
	invalidateCollectionRoutesCache,
	resolveManifestEntryOnDemand,
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

	test('resolves collection text on demand after the fast manifest pass', async () => {
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
			},
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/my-article.mdx')
		expect(entry?.sourceSnippet).toContain('title:')
		expect(entry?.sourceSnippet).toContain('My News Title')
		expect(entry?.collectionName).toBe('news')
		expect(entry?.collectionSlug).toBe('my-article')
	})

	test('resolves JSON data collection text on listing page', async () => {
		await ctx.writeFile(
			'src/pages/partners.astro',
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
			'cms-1': { id: 'cms-1', tag: 'span', text: 'ACME Corp', sourcePath: 'src/pages/partners.astro', sourceLine: 8 },
		}

		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/partners', entries, {}, undefined, undefined, defs, config, manifestWriter)
		const pendingEntry = manifestWriter.getPageManifest('/partners')?.entries['cms-1']
		expect(pendingEntry?.sourcePath).toBe('src/pages/partners.astro')
		expect(pendingEntry?.requiresSourceResolution).toBe(true)

		await resolveManifestEntryOnDemand('/partners', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/partners')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/partners/acme.json')
		expect(entry?.sourceSnippet).toContain('ACME Corp')
		expect(entry?.collectionName).toBe('partners')
		expect(entry?.requiresSourceResolution).toBeUndefined()
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

	// A host fallback path must not make an equal static URL look like provenance.
	test('keeps an unlocated image locked when its URL matches a static page image', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <img src={article.data.image} alt="" />)}',
				'<img src="/images/hero.jpg" alt="Static" />',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: One\nimage: /images/hero.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				imageMetadata: { src: '/images/hero.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.requiresSourceResolution).toBe(true)
		expect(entry?.collectionName).toBeUndefined()
		expect(entry?.sourceLine).toBeUndefined()
		expect(entry?.sourceSnippet).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const resolved = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(resolved?.requiresSourceResolution).toBe(true)
		expect(resolved?.sourceLine).toBeUndefined()
		expect(resolved?.sourceSnippet).toBeUndefined()
	})

	// Without coordinates, one indexed occurrence and none in collection content leaves the
	// project no other place the URL could have come from — that is a location, not a guess.
	test('locates an unlocated image whose URL occurs exactly once', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			['---', '---', '<img src="/images/logo.png" alt="Logo" />'].join('\n'),
		)

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				imageMetadata: { src: '/images/logo.png', alt: 'Logo' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, undefined, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.sourceLine).toBe(3)
		expect(entry?.sourceSnippet).toContain('/images/logo.png')
		expect(entry?.requiresSourceResolution).toBeUndefined()
	})

	test('keeps an unlocated image locked when its URL occurs in more than one place', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			['---', 'import Hero from "../components/Hero.astro"', '---', '<img src="/images/logo.png" alt="Logo" />', '<Hero />'].join('\n'),
		)
		await ctx.writeFile('src/components/Hero.astro', '<img src="/images/logo.png" alt="Also the logo" />')

		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				imageMetadata: { src: '/images/logo.png', alt: 'Logo' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, undefined, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.requiresSourceResolution).toBe(true)
		expect(entry?.sourceLine).toBeUndefined()
	})

	test('does not infer a collection image from its runtime URL alone', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <img src={article.data.image} />)}',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/my-article.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'my-article', sourcePath: 'src/content/news/my-article.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: './hero.jpg',
				imageMetadata: { src: './hero.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBeUndefined()
		expect(entry?.collectionName).toBeUndefined()
	})

	test('leaves ambiguous collection text unresolved', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <h2>{article.data.title}</h2>)}',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/first.mdx', newsArticle)
		await ctx.writeFile('src/content/news/second.mdx', newsArticle)

		const defs = makeNewsDefs([
			{ slug: 'first', sourcePath: 'src/content/news/first.mdx' },
			{ slug: 'second', sourcePath: 'src/content/news/second.mdx' },
		])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'h2',
				text: 'My News Title',
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBeUndefined()
	})

	test('leaves ambiguous collection images unresolved', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <img src={article.data.image} />)}',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/first.mdx', newsArticle)
		await ctx.writeFile('src/content/news/second.mdx', newsArticle)

		const defs = makeNewsDefs([
			{ slug: 'first', sourcePath: 'src/content/news/first.mdx' },
			{ slug: 'second', sourcePath: 'src/content/news/second.mdx' },
		])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: './hero.jpg',
				imageMetadata: { src: './hero.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBeUndefined()
	})

	test('defers a slow fallback until a locked entry is requested', async () => {
		await ctx.writeFile(
			'src/components/Nav.astro',
			[
				'---',
				'interface Props {',
				'  items: Array<{ label: string; href: string }>',
				'}',
				'const { items } = Astro.props',
				'---',
				'<nav>{items.map((item) => <a href={item.href}>{item.label}</a>)}</nav>',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import Nav from "../components/Nav.astro"',
				'const navItems = [',
				'  { label: "Home", href: "/" },',
				'  { label: "About", href: "/about" },',
				']',
				'---',
				'<Nav items={navItems} />',
			].join('\n'),
		)

		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'a', text: 'About' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, undefined, config, manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.sourceSnippet).toContain('label: "About"')
	})

	// A nav label rendered from a parent's prop array has no source coordinates, exactly like
	// a listing value does — but the page renders no collection, so a collection entry that
	// happens to be titled "About" must not become its edit target.
	test('does not attribute prop-array text to a collection the page never renders', async () => {
		await ctx.writeFile(
			'src/components/Nav.astro',
			[
				'---',
				'const { items } = Astro.props',
				'---',
				'<nav>{items.map((item) => <a href={item.href}>{item.label}</a>)}</nav>',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import Nav from "../components/Nav.astro"',
				'const navItems = [{ label: "About", href: "/about" }]',
				'---',
				'<Nav items={navItems} />',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: About\nimage: ./hero.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'a', text: 'About' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.sourceSnippet).toContain('label: "About"')
	})

	test('prefers a page prop over an equal value from a collection the page renders', async () => {
		await ctx.writeFile(
			'src/components/Nav.astro',
			[
				'---',
				'interface Props {',
				'  items: Array<{ label: string }>',
				'}',
				'const { items } = Astro.props',
				'---',
				'<nav>{items.map((item) => <a>{item.label}</a>)}</nav>',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'import Nav from "../components/Nav.astro"',
				'const articles = await getCollection("news")',
				'const navItems = [{ label: "About" }]',
				'---',
				'<Nav items={navItems} />',
				'<p>{articles.length}</p>',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: About\nimage: ./hero.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'a', text: 'About' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.sourceSnippet).toContain('label: "About"')
		expect(entry?.collectionName).toBeUndefined()
	})

	test('resolves a collection rendered by an imported component on demand', async () => {
		await ctx.writeFile(
			'src/components/Listing.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <h2>{article.data.title}</h2>)}',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			'---\nimport Listing from "../components/Listing.astro"\n---\n<Listing />',
		)
		await ctx.writeFile('src/content/news/one.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'h2', text: 'My News Title' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/one.mdx')
		expect(entry?.collectionName).toBe('news')
	})

	test('follows side-effect modules with namespace collection access', async () => {
		await ctx.writeFile(
			'src/content-scope.tsx',
			[
				'import * as content from "astro:content"',
				'export const articles = await content.getCollection("news")',
				'export const marker = <span>{articles.length}</span>',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			'---\nimport "../content-scope"\n---\n<h2>{Astro.locals.title}</h2>',
		)
		await ctx.writeFile('src/content/news/one.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'h2', text: 'My News Title' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/one.mdx')
		expect(entry?.collectionName).toBe('news')
	})

	test('ignores collection calls in comments when resolving a value match', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			'---\n// await getCollection("news")\nconst value = "unrelated"\n---\n<p>{value}</p>',
		)
		await ctx.writeFile('src/content/news/one.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'h2', text: 'My News Title' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBeUndefined()
		expect(entry?.collectionName).toBeUndefined()
	})

	test('ignores local functions named like Astro collection accessors', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'function getCollection(name: string) { return name }',
				'const unrelated = getCollection("news")',
				'---',
				'<h2>{Astro.locals.title}</h2>',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', newsArticle)

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'h2', text: 'My News Title' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBeUndefined()
		expect(entry?.collectionName).toBeUndefined()
	})

	test('does not add reference metadata from value equality alone', async () => {
		await ctx.writeFile(
			'src/components/Nav.astro',
			'---\nconst { label } = Astro.props\n---\n<a>{label}</a>',
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'import Nav from "../components/Nav.astro"',
				'const articles = await getCollection("news")',
				'---',
				'<Nav label="About" />',
				'<p>{articles.length}</p>',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: News\nauthor: jane\nimage: ./hero.jpg\n---\n\nBody.')
		await ctx.writeFile('src/content/authors/jane.mdx', '---\ntitle: About\n---\n\nBio.')

		const defs: Record<string, CollectionDefinition> = {
			news: {
				...makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }]).news!,
				fields: [
					{ name: 'title', type: 'text', required: true },
					{ name: 'author', type: 'reference', required: true, collection: 'authors' },
				],
			},
			authors: {
				name: 'authors',
				label: 'Authors',
				path: 'src/content/authors',
				entryCount: 1,
				fields: [{ name: 'title', type: 'text', required: true }],
				fileExtension: 'mdx',
				entries: [{ slug: 'jane', sourcePath: 'src/content/authors/jane.mdx' }],
			},
		}
		const entries: Record<string, ManifestEntry> = {
			'cms-1': { id: 'cms-1', tag: 'a', text: 'About' },
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.collectionName).toBeUndefined()
		expect(entry?.referenceCollection).toBeUndefined()
		expect(entry?.referencedBy).toBeUndefined()
	})

	test('does not attribute a runtime image from a collection URL match', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'<img src={Astro.locals.image} alt="Logo" />',
				'<p>{articles.length}</p>',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/components/Unrelated.astro',
			'<img src="/images/shared.jpg" alt="Unrelated" />',
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: News\nimage: /images/shared.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 5,
				imageMetadata: { src: '/images/shared.jpg', alt: 'Logo' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		const bulk = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(bulk?.sourcePath).toBe('src/pages/index.astro')
		expect(bulk?.requiresSourceResolution).toBe(true)
		expect(bulk?.collectionName).toBeUndefined()

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.requiresSourceResolution).toBe(true)
		expect(entry?.collectionName).toBeUndefined()
	})

	test('does not attribute an image to a collection the page never renders', async () => {
		await ctx.writeFile('src/pages/index.astro', '---\n---\n<img src="/images/shared.jpg" alt="logo" />')
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: First\nimage: /images/shared.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 3,
				imageMetadata: { src: '/images/shared.jpg', alt: 'logo' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.collectionName).toBeUndefined()
	})

	// A public-dir image referenced from frontmatter renders as a plain URL, so there is no
	// Astro `/_image?href=` to infer the collection from — the only provenance is the template
	// expression, which means resolution has to happen on demand.
	test('resolves a listing image whose src only lives in collection frontmatter', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <img src={article.data.image} alt="" />)}',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: One\nimage: /images/hero.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 5,
				imageMetadata: { src: '/images/hero.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)

		// Bulk leaves it pointing at the .map() line, flagged as not yet writable
		const bulk = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(bulk?.sourcePath).toBe('src/pages/index.astro')
		expect(bulk?.requiresSourceResolution).toBe(true)
		expect(bulk?.collectionName).toBe('news')
		expect(bulk?.collectionFieldName).toBe('image')

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/one.mdx')
		expect(entry?.sourceSnippet).toContain('image: /images/hero.jpg')
		expect(entry?.requiresSourceResolution).toBeUndefined()
	})

	test('resolves an image read from a direct getEntry binding', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getEntry } from "astro:content"',
				'const article = await getEntry("news", "one")',
				'---',
				'<img src={article.data.image} alt="" />',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: One\nimage: /images/hero.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 5,
				imageMetadata: { src: '/images/hero.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		const bulk = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(bulk?.collectionName).toBe('news')
		expect(bulk?.collectionFieldName).toBe('image')

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)
		expect(manifestWriter.getPageManifest('/')?.entries['cms-1']?.sourcePath).toBe('src/content/news/one.mdx')
	})

	// Same shape, but the src is destructured (`{image}`) — the previous `.data.` spelling
	// check would have skipped the collection lookup entirely.
	test('resolves a listing image whose src expression is destructured', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'const items = articles.map(article => article.data)',
				'---',
				'{items.map(({ image }) => <img src={image} alt="" />)}',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/one.mdx', '---\ntitle: One\nimage: /images/hero.jpg\n---\n\nBody.')

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 6,
				imageMetadata: { src: '/images/hero.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		const bulk = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(bulk?.collectionName).toBe('news')
		expect(bulk?.collectionFieldName).toBe('image')

		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/content/news/one.mdx')
		expect(entry?.requiresSourceResolution).toBeUndefined()
	})

	test('does not resolve an image through an equal non-image collection field', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const articles = await getCollection("news")',
				'---',
				'{articles.map(article => <img src={article.data.image} alt="" />)}',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/content/news/one.mdx',
			'---\ntitle: /images/rendered.jpg\nimage: /images/authored.jpg\n---\n\nBody.',
		)

		const defs = makeNewsDefs([{ slug: 'one', sourcePath: 'src/content/news/one.mdx' }])
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 5,
				imageMetadata: { src: '/images/rendered.jpg', alt: '' },
			},
		}
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions(defs)

		await enhanceManifestInBackground('/', entries, {}, undefined, undefined, defs, config, manifestWriter)
		await resolveManifestEntryOnDemand('/', 'cms-1', manifestWriter)

		const entry = manifestWriter.getPageManifest('/')?.entries['cms-1']
		expect(entry?.sourcePath).toBe('src/pages/index.astro')
		expect(entry?.requiresSourceResolution).toBe(true)
		expect(entry?.collectionName).toBe('news')
		expect(entry?.collectionFieldName).toBe('image')
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
