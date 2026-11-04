import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { processBuildOutput } from '../../src/build-processor'
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

const news: CollectionDefinition = {
	name: 'news',
	label: 'news',
	path: 'src/content/news',
	entryCount: 1,
	type: 'data',
	fields: [{ name: 'title', type: 'text', required: true }, { name: 'image', type: 'image', required: true }],
	fileExtension: 'json',
	entries: [{ slug: 'launch', sourcePath: 'src/content/news/launch.json' }],
}

const LISTING = [
	'---',
	'import { getCollection } from "astro:content"',
	'export async function getStaticPaths({ paginate }) { return paginate(await getCollection("news"), { pageSize: 1 }) }',
	'const { page } = Astro.props',
	'---',
	'<div>',
	'  {page.data.map(item => <img src={item.data.image} alt="" />)}',
	'</div>',
].join('\n')

describe('collection images in a build', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('build-collection-images-')
		await ctx.writeFile('src/content/news/launch.json', JSON.stringify({ title: 'Launch', image: '/images/launch.jpg' }, null, 2))
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	async function build(pagePath: string, html: string): Promise<ManifestEntry[]> {
		const out = path.join(ctx.tempDir, 'dist')
		await ctx.writeFile(path.join('dist', pagePath, 'index.html'), html)
		const manifestWriter = new ManifestWriter('cms-manifest.json')
		manifestWriter.setCollectionDefinitions({ news })
		await processBuildOutput(pathToFileURL(`${out}/`), config, manifestWriter, { value: 0 })
		const page = manifestWriter.getPageManifest(pagePath)
		if (!page) throw new Error(`No manifest for ${pagePath}`)
		return Object.values(page.entries)
	}

	test('an image on a page of a dynamic route resolves to its entry', async () => {
		await ctx.writeFile('src/pages/blog/[...page].astro', LISTING)

		const entries = await build('/blog/2', '<html><body><div><img src="/images/launch.jpg" alt=""></div></body></html>')

		expect(entries.find(entry => entry.imageMetadata?.src === '/images/launch.jpg')).toMatchObject({
			sourcePath: 'src/content/news/launch.json',
			sourceLine: 3,
		})
	})

	test('an image a markdown page renders through its layout resolves to its entry', async () => {
		await ctx.writeFile('src/pages/about.md', '---\nlayout: ../layouts/Base.astro\ntitle: About\n---\n\nAbout us.\n')
		await ctx.writeFile(
			'src/layouts/Base.astro',
			'---\nimport { getCollection } from "astro:content"\nconst news = await getCollection("news")\n---\n<div>\n{news.map(item => <img src={item.data.image} alt="" />)}\n</div>\n<slot />\n',
		)

		const entries = await build('/about', '<html><body><div><img src="/images/launch.jpg" alt=""></div><p>About us.</p></body></html>')

		expect(entries.find(entry => entry.imageMetadata?.src === '/images/launch.jpg')).toMatchObject({
			sourcePath: 'src/content/news/launch.json',
			sourceLine: 3,
		})
	})

	test('an image on a page that reads no collection stays with its template', async () => {
		await ctx.writeFile('src/pages/about.astro', '---\n---\n<div>\n<img src="/images/launch.jpg" alt="" />\n</div>\n')

		const entries = await build('/about', '<html><body><div><img src="/images/launch.jpg" alt=""></div></body></html>')

		expect(entries.find(entry => entry.imageMetadata?.src === '/images/launch.jpg')).toMatchObject({
			sourcePath: 'src/pages/about.astro',
			sourceLine: 4,
		})
	})
})
