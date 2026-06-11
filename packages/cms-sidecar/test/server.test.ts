import { createCmsCore, createLocalStorageAdapter, createNodeFs } from '@nuasite/cms-core'
import type { CollectionDefinition, CollectionEntry, CollectionEntryInfo, ComponentDefinition, GetRedirectsResponse } from '@nuasite/cms-types'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashContent } from '../src/concurrency'
import { type CmsSidecarServer, createServer, SIDECAR_FEATURES } from '../src/server'
import type { ApiError, ConflictResponse, EntriesListResult, PageEntry, ProjectModel } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'sample-project')

const cleanups: string[] = []
afterEach(async () => {
	for (const dir of cleanups.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

async function freshServer(): Promise<{ server: CmsSidecarServer; root: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-'))
	await fs.cp(FIXTURE_ROOT, root, { recursive: true })
	cleanups.push(root)
	const nodeFs = createNodeFs(root)
	const core = createCmsCore(nodeFs, {
		componentDirs: ['src/components'],
		media: createLocalStorageAdapter({ dir: path.join(root, 'public/uploads') }),
	})
	const server = createServer({ core, fs: nodeFs, root, coreVersion: '0.42.1' })
	return { server, root }
}

const BASE = 'http://sidecar.local/cms/v1'

async function call(server: CmsSidecarServer, method: string, pathSuffix: string, body?: unknown): Promise<Response> {
	const init: RequestInit = { method }
	if (body !== undefined) {
		init.body = JSON.stringify(body)
		init.headers = { 'content-type': 'application/json' }
	}
	const url = pathSuffix === '/health' ? `http://sidecar.local${pathSuffix}` : `${BASE}${pathSuffix}`
	return server.fetch(new Request(url, init))
}

async function jsonOf<T>(res: Response): Promise<T> {
	// `JSON.parse` returns `any`, which flows to `T` without a cast. Test helper:
	// we trust the documented wire shape for the asserted body.
	const value: T = JSON.parse(await res.text())
	return value
}

describe('cms-sidecar HTTP server (/cms/v1)', () => {
	test('GET /health → { ok, coreVersion, root }', async () => {
		const { server, root } = await freshServer()
		const res = await call(server, 'GET', '/health')
		expect(res.status).toBe(200)
		const body = await jsonOf<{ ok: boolean; coreVersion: string; root: string }>(res)
		expect(body.ok).toBe(true)
		expect(body.coreVersion).toBe('0.42.1')
		expect(body.root).toBe(root)
	})

	test('GET /project → collections + pages + capabilities', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/project')
		expect(res.status).toBe(200)
		const model = await jsonOf<ProjectModel>(res)

		expect(model.collections.map(c => c.name).sort()).toEqual(['authors', 'blog', 'settings', 'team'])
		expect(model.capabilities.coreVersion).toBe('0.42.1')
		expect(model.capabilities.features).toEqual([...SIDECAR_FEATURES])

		// Pages are an fs-derived (pathname-only) walk over src/pages.
		expect(model.pages.some(p => p.pathname === '/about')).toBe(true)
		expect(model.pages.every(p => p.title === undefined)).toBe(true)
	})

	test('GET /collections → CollectionDefinition[]', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/collections')
		expect(res.status).toBe(200)
		const defs = await jsonOf<CollectionDefinition[]>(res)
		const blog = defs.find(d => d.name === 'blog')
		expect(blog).toBeDefined()
		expect(blog?.fileExtension).toBe('md')
	})

	test('GET /components → ComponentDefinition[] (block picker source)', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/components')
		expect(res.status).toBe(200)
		const components = await jsonOf<ComponentDefinition[]>(res)
		const hero = components.find(c => c.name === 'Hero')
		expect(hero).toBeDefined()
		const title = hero?.props.find(p => p.name === 'title')
		expect(title?.required).toBe(true)
		expect(hero?.props.find(p => p.name === 'subtitle')?.required).toBe(false)
	})

	test('GET …/entries (default) is sparse: light header, NO body', async () => {
		const { server } = await freshServer()
		// draft=all to include the draft entry too.
		const res = await call(server, 'GET', '/collections/blog/entries?draft=all')
		expect(res.status).toBe(200)
		const list = await jsonOf<EntriesListResult>(res)
		expect(list.entries.map(e => e.slug).sort()).toEqual(['draft-post', 'hello-world'])
		for (const entry of list.entries) {
			expect(entry.slug).toBeDefined()
			expect(entry.sourcePath).toBeDefined()
			// No body anywhere in the list response.
			expect('body' in entry).toBe(false)
			expect(JSON.stringify(entry)).not.toContain('first post')
			// Light header carries no arbitrary frontmatter (no `data` / `tags`).
			expect(entry.data).toBeUndefined()
		}
	})

	test('GET …/entries tags entries with the rendered-page pathname from the route', async () => {
		const { server } = await freshServer()
		// `src/pages/blog/[...slug].astro` calls getCollection('blog') → base `/blog`.
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/blog/entries?draft=all'))
		expect(list.entries.find(e => e.slug === 'hello-world')?.pathname).toBe('/blog/hello-world')
	})

	test('GET …/entries shares one pathname for a collection on a static listing page', async () => {
		const { server } = await freshServer()
		// `src/pages/team.astro` calls getCollection('team') → every item maps to `/team`.
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/team/entries?draft=all'))
		expect(list.entries.length).toBeGreaterThan(1)
		expect(list.entries.every(e => e.pathname === '/team')).toBe(true)
	})

	test('GET …/entries omits pathname when the collection has no route', async () => {
		const { server } = await freshServer()
		// `authors` is rendered by no route file → no per-entry page → no pathname.
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/authors/entries?draft=all'))
		expect(list.entries.length).toBeGreaterThan(0)
		expect(list.entries.every(e => e.pathname === undefined)).toBe(true)
	})

	test('GET …/entries?draft filter', async () => {
		const { server } = await freshServer()
		const published = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/blog/entries?draft=false'))
		expect(published.entries.map(e => e.slug)).toEqual(['hello-world'])
		const drafts = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/blog/entries?draft=true'))
		expect(drafts.entries.map(e => e.slug)).toEqual(['draft-post'])
	})

	test('GET …/entries?fields=title,tags projects those frontmatter keys', async () => {
		const { server } = await freshServer()
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/blog/entries?draft=all&fields=title,tags'))
		const hello = list.entries.find(e => e.slug === 'hello-world')
		expect(hello?.title).toBe('Hello World')
		expect(hello?.data?.tags).toEqual(['intro', 'news'])
		// author was not requested → not present.
		expect(hello?.data?.author).toBeUndefined()
	})

	test('GET …/entries?fields=* includes all frontmatter but still no body', async () => {
		const { server } = await freshServer()
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/blog/entries?draft=all&fields=*'))
		const hello = list.entries.find(e => e.slug === 'hello-world')
		expect(hello?.data?.title).toBe('Hello World')
		expect(hello?.data?.author).toBe('jane-doe')
		expect(hello?.data?.tags).toEqual(['intro', 'news'])
		expect(hello !== undefined && 'body' in hello).toBe(false)
	})

	test('GET …/entries pagination via cursor (real offset, no silent cap)', async () => {
		const { server } = await freshServer()
		const first = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/blog/entries?draft=all&limit=1'))
		expect(first.entries).toHaveLength(1)
		expect(first.hasMore).toBe(true)
		expect(first.cursor).toBeDefined()
		const second = await jsonOf<EntriesListResult>(await call(server, 'GET', `/collections/blog/entries?draft=all&limit=1&cursor=${first.cursor}`))
		expect(second.entries).toHaveLength(1)
		expect(second.hasMore).toBe(false)
		expect(second.entries[0]!.slug).not.toBe(first.entries[0]!.slug)
	})

	test('GET …/entries/:slug detail returns the body', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/collections/blog/entries/hello-world')
		expect(res.status).toBe(200)
		const entry = await jsonOf<CollectionEntry>(res)
		expect(entry.collectionSlug).toBe('hello-world')
		expect(entry.body).toContain('This is the first post.')
		expect(entry.frontmatter.title?.value).toBe('Hello World')
	})

	test('GET …/entries/:slug unknown → 404 not_found', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/collections/blog/entries/nope')
		expect(res.status).toBe(404)
		expect((await jsonOf<ApiError>(res)).code).toBe('not_found')
	})

	test('POST …/entries creates an entry and returns sourceHash', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'POST', '/collections/blog/entries', {
			slug: 'new-post',
			frontmatter: { title: 'New Post', date: '2024-06-01', draft: false },
			body: '# New Post\n\nBody.',
		})
		expect(res.status).toBe(200)
		const body = await jsonOf<{ success: boolean; sourcePath?: string; sourceHash?: string }>(res)
		expect(body.success).toBe(true)
		expect(body.sourcePath).toBe('src/content/blog/new-post.md')
		expect(body.sourceHash).toMatch(/^sha256:/)
	})

	test('PATCH …/entries/:slug updates and returns a fresh sourceHash', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'PATCH', '/collections/blog/entries/hello-world', {
			frontmatter: { title: 'Hello Edited' },
		})
		expect(res.status).toBe(200)
		const body = await jsonOf<{ success: boolean; sourceHash?: string }>(res)
		expect(body.success).toBe(true)
		expect(body.sourceHash).toMatch(/^sha256:/)
		// Re-fetch detail to confirm the merge stuck.
		const detail = await jsonOf<CollectionEntry>(await call(server, 'GET', '/collections/blog/entries/hello-world'))
		expect(detail.frontmatter.title?.value).toBe('Hello Edited')
	})

	test('DELETE …/entries/:slug removes the entry', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'DELETE', '/collections/blog/entries/draft-post')
		expect(res.status).toBe(200)
		expect((await jsonOf<{ success: boolean }>(res)).success).toBe(true)
		expect((await call(server, 'GET', '/collections/blog/entries/draft-post')).status).toBe(404)
	})

	test('POST …/entries/:slug/rename renames the entry', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'POST', '/collections/blog/entries/hello-world/rename', { to: 'hello-renamed' })
		expect(res.status).toBe(200)
		const body = await jsonOf<{ success: boolean; sourcePath?: string }>(res)
		expect(body.sourcePath).toBe('src/content/blog/hello-renamed.md')
		expect((await call(server, 'GET', '/collections/blog/entries/hello-renamed')).status).toBe(200)
	})

	test('array add + remove on a frontmatter array field', async () => {
		const { server } = await freshServer()
		const add = await call(server, 'POST', '/collections/blog/entries/hello-world/array', { field: 'tags', value: 'added' })
		expect(add.status).toBe(200)
		let detail = await jsonOf<CollectionEntry>(await call(server, 'GET', '/collections/blog/entries/hello-world'))
		expect(detail.frontmatter.tags?.value).toContain('added')

		const remove = await call(server, 'DELETE', '/collections/blog/entries/hello-world/array', { field: 'tags', index: 0 })
		expect(remove.status).toBe(200)
		detail = await jsonOf<CollectionEntry>(await call(server, 'GET', '/collections/blog/entries/hello-world'))
		// 'intro' was index 0 — gone now.
		expect(detail.frontmatter.tags?.value).not.toContain('intro')
	})

	test('GET /pages and GET /pages/layouts', async () => {
		const { server } = await freshServer()
		const pages = await jsonOf<{ pages: PageEntry[] }>(await call(server, 'GET', '/pages'))
		expect(pages.pages.some(p => p.pathname === '/about')).toBe(true)
		const layouts = await jsonOf<{ layouts: { name: string }[] }>(await call(server, 'GET', '/pages/layouts'))
		expect(layouts.layouts.some(l => l.name === 'Base')).toBe(true)
	})

	test('pages create + delete', async () => {
		const { server } = await freshServer()
		const create = await call(server, 'POST', '/pages', { title: 'Contact', slug: 'contact' })
		expect(create.status).toBe(200)
		expect((await jsonOf<{ success: boolean }>(create)).success).toBe(true)
		const del = await call(server, 'DELETE', '/pages', { pagePath: '/contact' })
		expect(del.status).toBe(200)
		expect((await jsonOf<{ success: boolean }>(del)).success).toBe(true)
	})

	test('redirects list + add + update + delete', async () => {
		const { server } = await freshServer()
		const initial = await jsonOf<GetRedirectsResponse>(await call(server, 'GET', '/redirects'))
		expect(initial.rules.length).toBeGreaterThanOrEqual(2)

		expect((await call(server, 'POST', '/redirects', { source: '/from', destination: '/to' })).status).toBe(200)
		const afterAdd = await jsonOf<GetRedirectsResponse>(await call(server, 'GET', '/redirects'))
		const added = afterAdd.rules.find(r => r.source === '/from')
		expect(added).toBeDefined()

		expect((await call(server, 'PATCH', '/redirects', { lineIndex: added!.lineIndex, source: '/from', destination: '/to2', statusCode: 301 })).status)
			.toBe(200)
		const afterUpdate = await jsonOf<GetRedirectsResponse>(await call(server, 'GET', '/redirects'))
		expect(afterUpdate.rules.find(r => r.source === '/from')?.destination).toBe('/to2')

		const target = afterUpdate.rules.find(r => r.source === '/from')!
		expect((await call(server, 'DELETE', '/redirects', { lineIndex: target.lineIndex })).status).toBe(200)
		const afterDelete = await jsonOf<GetRedirectsResponse>(await call(server, 'GET', '/redirects'))
		expect(afterDelete.rules.find(r => r.source === '/from')).toBeUndefined()
	})

	test('media list + upload + delete (local adapter)', async () => {
		const { server } = await freshServer()
		const empty = await jsonOf<{ items: unknown[] }>(await call(server, 'GET', '/media'))
		expect(Array.isArray(empty.items)).toBe(true)

		const form = new FormData()
		form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'pic.png', { type: 'image/png' }))
		const upload = await server.fetch(new Request(`${BASE}/media`, { method: 'POST', body: form }))
		expect(upload.status).toBe(200)
		const uploaded = await jsonOf<{ success: boolean; id?: string }>(upload)
		expect(uploaded.success).toBe(true)
		expect(uploaded.id).toBeDefined()

		const del = await call(server, 'DELETE', `/media/${encodeURIComponent(uploaded.id!)}`)
		expect(del.status).toBe(200)
		expect((await jsonOf<{ success: boolean }>(del)).success).toBe(true)
	})

	test('media route 501 when no adapter configured', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-nomedia-'))
		await fs.cp(FIXTURE_ROOT, root, { recursive: true })
		cleanups.push(root)
		const nodeFs = createNodeFs(root)
		const core = createCmsCore(nodeFs, { componentDirs: ['src/components'] })
		const server = createServer({ core, fs: nodeFs, root, coreVersion: '0.42.1' })
		const res = await call(server, 'GET', '/media')
		expect(res.status).toBe(501)
		expect((await jsonOf<ApiError>(res)).code).toBe('unsupported')
	})

	test('unknown route → 404 not_found', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/nope/nowhere')
		expect(res.status).toBe(404)
		expect((await jsonOf<ApiError>(res)).code).toBe('not_found')
	})

	test('GET …/entries/:slug/asset → streams the entry-relative asset bytes', async () => {
		const { server, root } = await freshServer()
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		await fs.mkdir(path.join(root, 'src', 'assets'), { recursive: true })
		await fs.writeFile(path.join(root, 'src', 'assets', 'cover.png'), bytes)
		const rel = encodeURIComponent('../../assets/cover.png')
		const res = await call(server, 'GET', `/collections/blog/entries/hello-world/asset?path=${rel}`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('image/png')
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes)
	})

	test('asset route → 400 without a path, 404 for a missing file or unknown entry', async () => {
		const { server } = await freshServer()
		const missing = encodeURIComponent('../../assets/nope.png')
		const present = encodeURIComponent('../../assets/cover.png')
		expect((await call(server, 'GET', '/collections/blog/entries/hello-world/asset')).status).toBe(400)
		expect((await call(server, 'GET', `/collections/blog/entries/hello-world/asset?path=${missing}`)).status).toBe(404)
		expect((await call(server, 'GET', `/collections/blog/entries/ghost/asset?path=${present}`)).status).toBe(404)
	})
})

describe('cms-sidecar optimistic concurrency (baseHash / sourceHash)', () => {
	async function currentHash(server: CmsSidecarServer): Promise<string> {
		// The detail route does not expose a hash; recompute from the raw source via a PATCH probe.
		// Instead, derive it the way the sidecar does: hash the serialized on-disk source.
		// We get it from a no-op PATCH (no baseHash) which returns the post-write sourceHash.
		const res = await call(server, 'PATCH', '/collections/blog/entries/hello-world', {})
		return (await jsonOf<{ sourceHash: string }>(res)).sourceHash
	}

	test('PATCH with a stale baseHash → 409 ConflictResponse carrying the server version', async () => {
		const { server } = await freshServer()
		const staleHash = hashContent('totally different content')
		const res = await call(server, 'PATCH', '/collections/blog/entries/hello-world', {
			frontmatter: { title: 'Should Not Apply' },
			baseHash: staleHash,
		})
		expect(res.status).toBe(409)
		const conflict = await jsonOf<ConflictResponse>(res)
		expect(conflict.code).toBe('conflict')
		expect(conflict.serverHash).toMatch(/^sha256:/)
		expect(conflict.serverFrontmatter.title).toBe('Hello World')
		expect(conflict.serverBody).toContain('first post')

		// The stale write must NOT have applied.
		const detail = await jsonOf<CollectionEntry>(await call(server, 'GET', '/collections/blog/entries/hello-world'))
		expect(detail.frontmatter.title?.value).toBe('Hello World')
	})

	test('PATCH with the fresh baseHash → 200 with a new sourceHash', async () => {
		const { server } = await freshServer()
		const fresh = await currentHash(server)
		const res = await call(server, 'PATCH', '/collections/blog/entries/hello-world', {
			frontmatter: { title: 'Freshly Edited' },
			baseHash: fresh,
		})
		expect(res.status).toBe(200)
		const body = await jsonOf<{ success: boolean; sourceHash: string }>(res)
		expect(body.success).toBe(true)
		expect(body.sourceHash).toMatch(/^sha256:/)
		expect(body.sourceHash).not.toBe(fresh)
	})
})

describe('cms-sidecar cold-start timing (recorded for F2 tuning)', () => {
	test('construct + first GET /project over the fixture', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-cold-'))
		await fs.cp(FIXTURE_ROOT, root, { recursive: true })
		cleanups.push(root)

		const start = performance.now()
		const nodeFs = createNodeFs(root)
		const core = createCmsCore(nodeFs, { componentDirs: ['src/components'] })
		const server = createServer({ core, fs: nodeFs, root, coreVersion: '0.42.1' })
		const res = await call(server, 'GET', '/project')
		const elapsedMs = performance.now() - start

		expect(res.status).toBe(200)
		console.log(`[cms-sidecar] cold start (construct + first /project scan): ${elapsedMs.toFixed(1)}ms`)
		expect(elapsedMs).toBeLessThan(5000)
	})
})
