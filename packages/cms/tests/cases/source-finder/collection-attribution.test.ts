import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { enhanceManifestInBackground } from '../../../src/editor-service'
import { ManifestWriter } from '../../../src/manifest-writer'
import { clearSourceFinderCache } from '../../../src/source-finder'
import type { CmsMarkerOptions, CollectionDefinition, ManifestEntry } from '../../../src/types'
import { defaultMockConfig } from '../../utils/mocks'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../../utils/temp-directory'

const config: Required<CmsMarkerOptions> = {
	...defaultMockConfig,
	excludeTags: ['script', 'style', 'noscript', 'svg', 'path'],
	manifestFile: 'cms-manifest.json',
	seo: {},
}

function dataCollection(name: string, fields: CollectionDefinition['fields'], slugs: string[]): CollectionDefinition {
	return {
		name,
		label: name,
		path: `src/content/${name}`,
		entryCount: slugs.length,
		type: 'data',
		fields,
		fileExtension: 'json',
		entries: slugs.map(slug => ({ slug, sourcePath: `src/content/${name}/${slug}.json` })),
	}
}

const partners = (slugs: string[]) =>
	dataCollection('partners', [{ name: 'name', type: 'text', required: true }, { name: 'logo', type: 'image', required: true }], slugs)
const articles = (slugs: string[]) => dataCollection('articles', [{ name: 'title', type: 'text', required: true }], slugs)
const news = (slugs: string[]) =>
	dataCollection('news', [{ name: 'title', type: 'text', required: true }, { name: 'image', type: 'image', required: true }], slugs)

const PARTNER_LISTING = [
	'---',
	'import { getCollection } from "astro:content"',
	'import Footer from "../components/Footer.astro"',
	'const partners = (await getCollection("partners")).map(p => p.data)',
	'---',
	'<div>',
	'  {partners.map(p => (',
	'    <span>{p.name}</span>',
	'  ))}',
	'</div>',
	'<Footer />',
].join('\n')

async function enhance(
	pagePath: string,
	entries: Record<string, ManifestEntry>,
	collections: Record<string, CollectionDefinition>,
): Promise<Record<string, ManifestEntry>> {
	const manifestWriter = new ManifestWriter('cms-manifest.json')
	manifestWriter.setCollectionDefinitions(collections)
	await enhanceManifestInBackground(pagePath, entries, {}, undefined, undefined, collections, config, manifestWriter)
	const page = manifestWriter.getPageManifest(pagePath)
	if (!page) throw new Error(`No manifest for ${pagePath}`)
	return page.entries
}

describe('collection values are attributed only to collections the page reads', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('collection-attribution-')
		await ctx.mkdir('src/components')
		await ctx.mkdir('src/pages')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	test('listing text resolves to its entry, not to equal static text in a component on the page', async () => {
		await ctx.writeFile('src/pages/index.astro', PARTNER_LISTING)
		await ctx.writeFile('src/components/Footer.astro', '<footer>\n<span>ACME Corp</span>\n</footer>\n')
		await ctx.writeFile('src/content/partners/acme.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme.png' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'span', text: 'ACME Corp', sourcePath: 'src/pages/index.astro', sourceLine: 8 },
		}, { partners: partners(['acme']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/content/partners/acme.json', collectionName: 'partners', collectionSlug: 'acme' })
	})

	test('text equal to a value of a collection the page never reads stays unattributed', async () => {
		await ctx.writeFile('src/pages/index.astro', '---\nconst { heading } = Astro.props\n---\n<h1>{heading}</h1>\n')
		await ctx.writeFile('src/content/articles/getting-started.json', JSON.stringify({ title: 'Getting started' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'h1', text: 'Getting started', sourcePath: 'src/pages/index.astro', sourceLine: 4 },
		}, { articles: articles(['getting-started']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/pages/index.astro', textResolved: false })
		expect(entries['cms-0']!.collectionName).toBeUndefined()
	})

	test('a static label equal to an entry title is not tagged with that entry', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			'---\nimport { getCollection } from "astro:content"\nconst all = await getCollection("articles")\n---\n<nav>\n<a href="/about">About</a>\n</nav>\n',
		)
		await ctx.writeFile('src/content/articles/about.json', JSON.stringify({ title: 'About' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'a', text: 'About', sourcePath: 'src/pages/index.astro', sourceLine: 6 },
		}, { articles: articles(['about']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/pages/index.astro', sourceLine: 6 })
		expect(entries['cms-0']!.collectionName).toBeUndefined()
		expect(entries['cms-0']!.collectionSlug).toBeUndefined()
	})

	test('a value two entries hold is attributed to neither, nor to equal static text elsewhere', async () => {
		await ctx.writeFile('src/pages/index.astro', PARTNER_LISTING)
		await ctx.writeFile('src/components/Footer.astro', '<footer>\n<span>ACME Corp</span>\n</footer>\n')
		await ctx.writeFile('src/content/partners/acme.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme.png' }, null, 2))
		await ctx.writeFile('src/content/partners/acme-eu.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme-eu.png' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'span', text: 'ACME Corp', sourcePath: 'src/pages/index.astro', sourceLine: 8 },
		}, { partners: partners(['acme', 'acme-eu']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/pages/index.astro', textResolved: false })
	})

	test('listing text without source coordinates resolves to its entry, not to equal static text elsewhere', async () => {
		await ctx.writeFile('src/pages/index.astro', PARTNER_LISTING)
		await ctx.writeFile('src/components/Footer.astro', '<footer>\n<span>ACME Corp</span>\n</footer>\n')
		await ctx.writeFile('src/content/partners/acme.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme.png' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'span', text: 'ACME Corp' },
		}, { partners: partners(['acme']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/content/partners/acme.json', collectionName: 'partners', collectionSlug: 'acme' })
	})

	test('listing text without source coordinates that two entries hold stays unplaced', async () => {
		await ctx.writeFile('src/pages/index.astro', PARTNER_LISTING)
		await ctx.writeFile('src/components/Footer.astro', '<footer>\n<span>ACME Corp</span>\n</footer>\n')
		await ctx.writeFile('src/content/partners/acme.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme.png' }, null, 2))
		await ctx.writeFile('src/content/partners/acme-eu.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme-eu.png' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'span', text: 'ACME Corp' },
		}, { partners: partners(['acme', 'acme-eu']) })

		expect(entries['cms-0']!.sourcePath).toBeUndefined()
	})

	test('an image rendered from a sorted and filtered list resolves to its entry', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const items = (await getCollection("news")).sort((a, b) => a.data.title.localeCompare(b.data.title))',
				'const shown = items.filter(item => item.data.image).slice(0, 3)',
				'---',
				'<div>',
				'  {shown.map(item => (',
				'    <img src={item.data.image} alt="" />',
				'  ))}',
				'</div>',
			].join('\n'),
		)
		await ctx.writeFile('src/content/news/launch.json', JSON.stringify({ title: 'Launch', image: '/images/launch.jpg' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': {
				id: 'cms-0',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 8,
				imageMetadata: { src: '/images/launch.jpg', alt: '' },
			},
		}, { news: news(['launch']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/content/news/launch.json', sourceLine: 3 })
	})

	test('an image URL held by a collection the page never reads stays with the template', async () => {
		await ctx.writeFile('src/pages/index.astro', '---\nconst { cover } = Astro.props\n---\n<img src={cover} alt="" />\n')
		await ctx.writeFile('src/content/news/launch.json', JSON.stringify({ title: 'Launch', image: '/images/launch.jpg' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': {
				id: 'cms-0',
				tag: 'img',
				text: '',
				sourcePath: 'src/pages/index.astro',
				sourceLine: 4,
				imageMetadata: { src: '/images/launch.jpg', alt: '' },
			},
		}, { news: news(['launch']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/pages/index.astro', sourceLine: 4 })
	})

	test('a collection read in a module imported through a tsconfig alias is one the page reads', async () => {
		await ctx.writeFile(
			'tsconfig.json',
			'{\n\t// Astro projects extend a preset\n\t"extends": "astro/tsconfigs/strict",\n\t"compilerOptions": {\n\t\t"paths": { "@/*": ["./src/*"], },\n\t},\n}\n',
		)
		await ctx.writeFile(
			'src/lib/partners.ts',
			'import { getCollection } from "astro:content"\nexport const listPartners = () => getCollection("partners")\n',
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			'---\nimport { listPartners } from "@/lib/partners"\nconst partners = (await listPartners()).map(p => p.data)\n---\n<div>\n  {partners.map(p => <span>{p.name}</span>)}\n</div>\n',
		)
		await ctx.writeFile('src/content/partners/acme.json', JSON.stringify({ name: 'ACME Corp', logo: '/logos/acme.png' }, null, 2))

		const entries = await enhance('/', {
			'cms-0': { id: 'cms-0', tag: 'span', text: 'ACME Corp', sourcePath: 'src/pages/index.astro', sourceLine: 6 },
		}, { partners: partners(['acme']) })

		expect(entries['cms-0']).toMatchObject({ sourcePath: 'src/content/partners/acme.json', collectionName: 'partners' })
	})
})
