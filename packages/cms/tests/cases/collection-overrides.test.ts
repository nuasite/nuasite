import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import type { CollectionDefinition } from '@nuasite/cms-types'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { applyCollectionOverrides, type CollectionOverrides } from '../../src/collection-overrides'
import { resetProjectRoot, setProjectRoot } from '../../src/config'
import { handleCmsApiRoute, type RouteContext } from '../../src/handlers/api-routes'
import { ManifestWriter } from '../../src/manifest-writer'
import { scanCollections } from '../../src/scan-cache'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../utils/temp-directory'

// A collection's label has three sources, in this order: the Astro config
// (`nua.cms.collections[name].label`), `cms.label` in the content config, and the name.
// The first is only known to the integration, so it has to be laid over every scan the
// integration hands on — these lock the order, and that a rescan does not lose it.
const CONTENT_CONFIG = `import { defineCmsCollection, n } from '@nuasite/cms'
const blog = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { label: 'Články' },
})
const authors = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { label: 'Autoři' },
})
const press = defineCmsCollection({
	schema: n.object({ title: n.text() }),
})
export const collections = { blog, authors, 'press-releases': press }
`

const OVERRIDES: CollectionOverrides = {
	blog: { label: 'Aktuality', fields: { title: { position: 'header', group: 'Hlavička' } } },
	// Not a collection of this project: ignored rather than invented.
	ghosts: { label: 'Duchové' },
}

describe('collection overrides from the Astro config', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		ctx = await createTempDir('collection-overrides-')
		await ctx.mkdir('src/content/blog')
		await ctx.mkdir('src/content/authors')
		await ctx.mkdir('src/content/press-releases')
		await ctx.writeFile('src/content/blog/hello.md', '---\ntitle: Hello\n---\n')
		await ctx.writeFile('src/content/authors/jana.md', '---\ntitle: Jana\n---\n')
		await ctx.writeFile('src/content/press-releases/first.md', '---\ntitle: First\n---\n')
		await ctx.writeFile('src/content.config.ts', CONTENT_CONFIG)
		setProjectRoot(ctx.tempDir)
	})

	afterEach(async () => {
		resetProjectRoot()
		await cleanupTempDir(ctx)
	})

	const labels = (definitions: Record<string, CollectionDefinition>) =>
		Object.fromEntries(Object.values(definitions).map(def => [def.name, def.label]))

	test('label precedence: Astro config, then cms.label, then the name', async () => {
		expect(labels(await scanCollections('src/content', OVERRIDES))).toEqual({
			blog: 'Aktuality',
			authors: 'Autoři',
			'press-releases': 'Press Releases',
		})
	})

	test('without overrides the scan is served as it is', async () => {
		expect(labels(await scanCollections('src/content'))).toEqual({
			blog: 'Články',
			authors: 'Autoři',
			'press-releases': 'Press Releases',
		})
	})

	test('field overrides are applied and marked as declared', async () => {
		const title = (await scanCollections('src/content', OVERRIDES))['blog']?.fields.find(field => field.name === 'title')
		expect(title?.position).toBe('header')
		expect(title?.positionDeclared).toBe(true)
		expect(title?.group).toBe('Hlavička')
	})

	test('applyCollectionOverrides returns the definitions it was given', () => {
		const definitions: Record<string, CollectionDefinition> = {}
		expect(applyCollectionOverrides(definitions, OVERRIDES)).toBe(definitions)
		expect(applyCollectionOverrides(definitions, undefined)).toBe(definitions)
	})

	/** Drive one POST route through a real `node:http` server, as the dev middleware does. */
	async function postRoute(route: string, body: unknown, context: Omit<RouteContext, 'req' | 'res' | 'route'>): Promise<number> {
		const server = createServer((req, res) => {
			handleCmsApiRoute({ ...context, req, res, route }).catch((error: unknown) => {
				res.statusCode = 500
				res.end(String(error))
			})
		})
		try {
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
			const address: string | AddressInfo | null = server.address()
			if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
			const response = await Bun.fetch(`http://127.0.0.1:${address.port}/_nua/cms/${route}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			})
			await response.text()
			return response.status
		} finally {
			server.close()
		}
	}

	function routeContext(collectionOverrides: CollectionOverrides | undefined): Omit<RouteContext, 'req' | 'res' | 'route'> {
		const cmsFs = createNodeFs(ctx.tempDir)
		return {
			manifestWriter: new ManifestWriter('cms-manifest.json'),
			core: createCmsCore(cmsFs, { contentDir: 'src/content' }),
			fs: cmsFs,
			projectRoot: ctx.tempDir,
			contentDir: 'src/content',
			maxUploadSize: 10 * 1024 * 1024,
			collectionOverrides,
		}
	}

	test('the rescan after an entry create keeps the Astro-config label', async () => {
		const context = routeContext(OVERRIDES)
		context.manifestWriter.setCollectionDefinitions(await scanCollections('src/content', OVERRIDES))

		const status = await postRoute('markdown/create', { collection: 'blog', title: 'Second', slug: 'second' }, context)

		expect(status).toBe(200)
		const definitions = context.manifestWriter.getCollectionDefinitions()
		// The rescan really happened…
		expect(definitions['blog']?.entries?.map(entry => entry.slug).sort()).toEqual(['hello', 'second'])
		// …and did not fall back to `cms.label`.
		expect(labels(definitions)).toEqual({ blog: 'Aktuality', authors: 'Autoři', 'press-releases': 'Press Releases' })
	})

	test('the rescan after an entry delete keeps the Astro-config label', async () => {
		await ctx.writeFile('src/content/blog/second.md', '---\ntitle: Second\n---\n')
		const context = routeContext(OVERRIDES)
		context.manifestWriter.setCollectionDefinitions(await scanCollections('src/content', OVERRIDES))

		const status = await postRoute('markdown/delete', { filePath: 'src/content/blog/hello.md' }, context)

		expect(status).toBe(200)
		const definitions = context.manifestWriter.getCollectionDefinitions()
		expect(definitions['blog']?.entries?.map(entry => entry.slug)).toEqual(['second'])
		expect(definitions['blog']?.label).toBe('Aktuality')
	})
})
