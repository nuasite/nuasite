import { createCmsCore, createLocalStorageAdapter, createNodeFs } from '@nuasite/cms-core'
import type {
	CmsConfig,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	GetRedirectsResponse,
	MediaItem,
	MediaListResult,
	MediaStorageAdapter,
	MediaUploadResult,
} from '@nuasite/cms-types'
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

async function freshServerFrom(fixture: string): Promise<{ server: CmsSidecarServer; root: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-'))
	await fs.cp(path.join(__dirname, 'fixtures', fixture), root, { recursive: true })
	cleanups.push(root)
	const nodeFs = createNodeFs(root)
	const core = createCmsCore(nodeFs, {
		componentDirs: ['src/components'],
		media: createLocalStorageAdapter({ dir: path.join(root, 'public/uploads') }),
	})
	const server = createServer({ core, fs: nodeFs, root, coreVersion: '0.42.1' })
	return { server, root }
}

async function freshServer(): Promise<{ server: CmsSidecarServer; root: string }> {
	return freshServerFrom('sample-project')
}

/**
 * A fixture copy wired to a caller-supplied media adapter (or none at all). The adapter
 * is built from the temp root, so a test can point `staticFiles.dir` at a real directory.
 */
async function freshServerWithAdapter(
	makeAdapter: (root: string) => MediaStorageAdapter | undefined,
): Promise<{ server: CmsSidecarServer; root: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-'))
	await fs.cp(FIXTURE_ROOT, root, { recursive: true })
	cleanups.push(root)
	const nodeFs = createNodeFs(root)
	const core = createCmsCore(nodeFs, { componentDirs: ['src/components'], media: makeAdapter(root) })
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

/** PNG magic bytes — the media scan goes by extension, so the payload only has to be a file. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Write root-relative files into a fixture copy (parent dirs included). */
async function writeProjectImages(root: string, files: Record<string, Buffer>): Promise<void> {
	for (const [relative, bytes] of Object.entries(files)) {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, bytes)
	}
}

/** Upload through the media adapter and return the served URL. */
async function uploadPng(server: CmsSidecarServer, filename: string): Promise<string> {
	const form = new FormData()
	form.append('file', new File([PNG], filename, { type: 'image/png' }))
	const result = await jsonOf<MediaUploadResult>(await server.fetch(new Request(`${BASE}/media`, { method: 'POST', body: form })))
	expect(result.success).toBe(true)
	return result.url!
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

		expect(model.collections.map(c => c.name).sort()).toEqual(['authors', 'blog', 'docs', 'people', 'settings', 'team'])
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

	test('GET /config → CmsConfig from astro.config.ts', async () => {
		const { server, root } = await freshServer()
		await fs.writeFile(
			path.join(root, 'astro.config.ts'),
			`
			import { defineConfig } from '@nuasite/nua/config'

			export default defineConfig({
				nua: {
					cms: {
						cmsConfig: {
							listStyles: [
								{ label: 'Fajfky', class: 'checkmarks' },
								{ label: 'Růžové tečky', class: 'dots-pink' },
							],
						},
					},
				},
			})
		`,
		)

		const res = await call(server, 'GET', '/config')
		expect(res.status).toBe(200)
		const config = await jsonOf<CmsConfig>(res)
		expect(config.listStyles).toEqual([
			{ label: 'Fajfky', class: 'checkmarks' },
			{ label: 'Růžové tečky', class: 'dots-pink' },
		])
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

	test('GET …/entries resolves a directory-form dynamic route (`[slug]/index.astro`)', async () => {
		const { server } = await freshServer()
		// `src/pages/docs/[slug]/index.astro` calls getCollection('docs'): the dynamic segment
		// lives in a parent directory, not the filename → base `/docs`, one page per entry.
		// Regression guard: previously the literal route template `/docs/[slug]` leaked through.
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/docs/entries?draft=all'))
		expect(list.entries.find(e => e.slug === 'intro')?.pathname).toBe('/docs/intro')
		expect(list.entries.every(e => e.pathname !== undefined && !e.pathname.includes('['))).toBe(true)
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

	test('GET …/entries: a shared `[slug]` detail wins over the listing for every collection it drives', async () => {
		const { server } = await freshServerFrom('multi-detail-project')
		// `src/pages/[slug].astro` drives products + references from one getStaticPaths, and
		// `reference.astro` / `produkty.astro` also list them. The per-item detail route must
		// win for BOTH — not just the first getCollection (products) — and a root base `/` must
		// not double the slash.
		const products = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/products/entries?draft=all'))
		expect(products.entries.find(e => e.slug === 'desk')?.pathname).toBe('/desk')
		const references = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/references/entries?draft=all'))
		expect(references.entries.find(e => e.slug === 'acme')?.pathname).toBe('/acme')
		expect([...products.entries, ...references.entries].every(e => e.pathname !== undefined && !e.pathname.includes('//'))).toBe(true)
	})

	test('GET …/entries excludes a render-body getCollection lookup from the per-item route', async () => {
		const { server } = await freshServerFrom('multi-detail-project')
		// `blog/[...slug].astro` drives `posts` in getStaticPaths and reads `authors` in the
		// render body. posts is page-per-item at `/blog/*`; authors is only a lookup → no pathname.
		const posts = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/posts/entries?draft=all'))
		expect(posts.entries.find(e => e.slug === 'first-post')?.pathname).toBe('/blog/first-post')
		const authors = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/authors/entries?draft=all'))
		expect(authors.entries.every(e => e.pathname === undefined)).toBe(true)
	})

	test('GET …/entries derives pathname from a `cms.pathname` rule, overriding the route guess', async () => {
		const { server } = await freshServer()
		// `people` declares `cms: { pathname: [{ field: 'urlFamily' }, { field: 'slug' }] }`.
		// Its entry is the file `expert__adela.md` (on-disk slug `expert__adela`) with
		// frontmatter `urlFamily: lide, slug: adela`, and it's served through
		// `src/pages/autori/[slug].astro` → route base `/autori`. Without the rule the
		// sidecar would guess `/autori/expert__adela` (the exact editor-iframe bug); the
		// declarative rule must win and yield `/lide/adela`.
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/people/entries?draft=all'))
		const entry = list.entries.find(e => e.slug === 'expert__adela')
		expect(entry?.pathname).toBe('/lide/adela')
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

	test('media list merges the project scan on ?includeProjectImages, minus the uploads dir', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/assets/hero.png': PNG, 'src/assets/logo.png': PNG })
		const uploadedUrl = await uploadPng(server, 'pic.png')

		// Default listing stays adapter-only.
		const adapterOnly = await jsonOf<MediaListResult>(await call(server, 'GET', '/media'))
		expect(adapterOnly.items.map(i => i.url)).toEqual([uploadedUrl])
		expect(adapterOnly.hasMore).toBe(false)

		const merged = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true'))
		// The upload lives under public/uploads — the scan must not list it a second time.
		expect(merged.items.map(i => i.url).sort()).toEqual([uploadedUrl, '/assets/hero.png', '/src/assets/logo.png'].sort())
		expect(merged.hasMore).toBe(false)
		expect(merged.cursor).toBeUndefined()
	})

	test('media list paginates across the adapter and the project scan without repeats', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/assets/hero.png': PNG, 'src/assets/logo.png': PNG })
		const uploadedUrl = await uploadPng(server, 'pic.png')

		const seen: string[] = []
		let query = '/media?includeProjectImages=true&limit=1'
		for (let page = 0; page < 4; page++) {
			const result = await jsonOf<MediaListResult>(await call(server, 'GET', query))
			expect(result.items.length).toBe(1)
			seen.push(...result.items.map(i => i.url))
			if (!result.hasMore) break
			expect(result.cursor).toBeDefined()
			query = `/media?includeProjectImages=true&limit=1&cursor=${encodeURIComponent(result.cursor!)}`
		}
		// Adapter page first, then the scan in its stable filename order.
		expect(seen).toEqual([uploadedUrl, '/assets/hero.png', '/src/assets/logo.png'])
	})

	test('media list keeps the project scan out of a folder listing', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/assets/hero.png': PNG })
		expect((await call(server, 'POST', '/media', { folder: 'photos' })).status).toBe(200)

		const inFolder = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&folder=photos'))
		expect(inFolder.items).toEqual([])
		expect(inFolder.hasMore).toBe(false)
	})

	test('media list rejects a cursor that is not a merge cursor', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/media?includeProjectImages=true&cursor=0')
		expect(res.status).toBe(400)
		expect((await jsonOf<ApiError>(res)).code).toBe('validation')
	})

	test('media list rejects a cursor that decodes to no position at all', async () => {
		const { server } = await freshServer()
		// Well-formed base64url JSON, but nothing we ever mint. Answering 200 here would
		// silently restart the listing at page 1 instead of reporting the bad cursor.
		for (const payload of ['{}', '[]', '{"foo":1}', '{"v":1}', '{"v":2,"project":0}', '{"project":0}', 'not-json', '"str"', '42']) {
			const cursor = Buffer.from(payload, 'utf8').toString('base64url')
			const res = await call(server, 'GET', `/media?includeProjectImages=true&cursor=${encodeURIComponent(cursor)}`)
			expect({ payload, status: res.status }).toEqual({ payload, status: 400 })
			expect((await jsonOf<ApiError>(res)).code).toBe('validation')
		}
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

	test('GET /asset → streams a root-relative /public value with no owning entry', async () => {
		const { server, root } = await freshServer()
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		await fs.mkdir(path.join(root, 'public', 'assets'), { recursive: true })
		await fs.writeFile(path.join(root, 'public', 'assets', 'titul.png'), bytes)
		const res = await call(server, 'GET', `/asset?path=${encodeURIComponent('/assets/titul.png')}`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('image/png')
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes)
	})

	test('GET /asset → 400 without a path, 404 for a missing file', async () => {
		const { server } = await freshServer()
		expect((await call(server, 'GET', '/asset')).status).toBe(400)
		expect((await call(server, 'GET', `/asset?path=${encodeURIComponent('/assets/nope.png')}`)).status).toBe(404)
	})
})

describe('cms-sidecar merged media listing (?includeProjectImages)', () => {
	/**
	 * A third-party adapter reduced to what the merge actually consumes: a caller-supplied
	 * page and an optional `staticFiles` claim. Nothing touches the filesystem, so the only
	 * items that can come from `public/`/`src/` are the project scan's.
	 */
	function stubAdapter(
		opts: { page?: Partial<MediaListResult>; staticFilesDir?: string; onList?: (options: unknown) => void } = {},
	): MediaStorageAdapter {
		const adapter: MediaStorageAdapter = {
			async list(options) {
				opts.onList?.(options)
				return { items: [], folders: [], hasMore: false, ...opts.page }
			},
			async upload() {
				return { success: false, error: 'read-only stub' }
			},
			async delete() {
				return { success: false, error: 'read-only stub' }
			},
		}
		if (opts.staticFilesDir !== undefined) adapter.staticFiles = { urlPrefix: '/uploads', dir: opts.staticFilesDir }
		return adapter
	}

	const UPLOADED: MediaItem = { id: 'up.png', url: '/uploads/up.png', filename: 'up.png', contentType: 'image/png' }

	test('the uploads dir the adapter owns stays out of the scan', async () => {
		// The uploads live under the project root, so the scan would see them too — the
		// adapter has to stay their single source. `<root>/public/uploads` is the spelling
		// createLocalStorageAdapter reports; the full spelling matrix is exercised where the
		// normalisation lives, in cms-core's project-images tests.
		const { server, root } = await freshServerWithAdapter(projectRoot =>
			stubAdapter({ page: { items: [UPLOADED] }, staticFilesDir: path.join(projectRoot, 'public/uploads') })
		)
		await writeProjectImages(root, { 'public/uploads/up.png': PNG, 'public/assets/hero.png': PNG })

		const merged = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true'))
		const urls = merged.items.map(i => i.url)
		expect(urls.filter(u => u === '/uploads/up.png')).toEqual(['/uploads/up.png'])
		expect(urls).toContain('/assets/hero.png')
	})

	test('an adapter without staticFiles excludes nothing and still merges', async () => {
		const { server, root } = await freshServerWithAdapter(() =>
			stubAdapter({ page: { items: [{ id: 'r', url: 'https://cdn.example.com/r.png', filename: 'r.png', contentType: 'image/png' }] } })
		)
		await writeProjectImages(root, { 'public/assets/hero.png': PNG })
		const merged = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true'))
		expect(merged.items.map(i => i.url)).toEqual(['https://cdn.example.com/r.png', '/assets/hero.png'])
	})

	test('folders stay populated on every page, not just the first', async () => {
		const folders = [{ name: 'photos', path: 'photos' }]
		const { server, root } = await freshServerWithAdapter(() => stubAdapter({ page: { folders }, staticFilesDir: '/public/uploads' }))
		await writeProjectImages(root, { 'public/a.png': PNG, 'public/b.png': PNG, 'public/c.png': PNG })

		const first = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&limit=2'))
		expect(first.folders).toEqual(folders)
		expect(first.hasMore).toBe(true)
		const second = await jsonOf<MediaListResult>(
			await call(server, 'GET', `/media?includeProjectImages=true&limit=2&cursor=${encodeURIComponent(first.cursor!)}`),
		)
		expect(second.hasMore).toBe(false)
		// Regression: the project phase never calls the adapter, so the folder list has to
		// ride along in the cursor — a client doing setFolders(page.folders) must not lose it.
		expect(second.folders).toEqual(folders)
	})

	test('the flag accepts a bare name, true and 1; false and 0 turn it off; anything else is a 400', async () => {
		const { server, root } = await freshServerWithAdapter(() => stubAdapter({ staticFilesDir: '/public/uploads' }))
		await writeProjectImages(root, { 'public/assets/hero.png': PNG })

		for (const query of ['includeProjectImages', 'includeProjectImages=true', 'includeProjectImages=1']) {
			const res = await call(server, 'GET', `/media?${query}`)
			expect({ query, status: res.status }).toEqual({ query, status: 200 })
			expect((await jsonOf<MediaListResult>(res)).items.map(i => i.url)).toEqual(['/assets/hero.png'])
		}
		for (const query of ['', 'includeProjectImages=false', 'includeProjectImages=0']) {
			const res = await call(server, 'GET', `/media${query === '' ? '' : `?${query}`}`)
			expect({ query, status: res.status }).toEqual({ query, status: 200 })
			expect((await jsonOf<MediaListResult>(res)).items).toEqual([])
		}
		// Silently ignoring these used to drop the project images without a word.
		for (const query of ['includeProjectImages=TRUE', 'includeProjectImages=yes', 'includeProjectImages=2']) {
			const res = await call(server, 'GET', `/media?${query}`)
			expect({ query, status: res.status }).toEqual({ query, status: 400 })
			expect((await jsonOf<ApiError>(res)).code).toBe('validation')
		}
	})

	test('following a merge cursor without the flag (or inside a folder) is a 400, not an empty page', async () => {
		const { server, root } = await freshServerWithAdapter(() => stubAdapter({ staticFilesDir: '/public/uploads' }))
		await writeProjectImages(root, { 'public/a.png': PNG, 'public/b.png': PNG, 'public/c.png': PNG })
		const first = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&limit=2'))
		const cursor = encodeURIComponent(first.cursor!)

		// The merge cursor is ours; handing it to the adapter yields a silent empty page.
		for (const query of [`/media?limit=2&cursor=${cursor}`, `/media?includeProjectImages=true&folder=photos&limit=2&cursor=${cursor}`]) {
			const res = await call(server, 'GET', query)
			expect({ query, status: res.status }).toEqual({ query, status: 400 })
			expect((await jsonOf<ApiError>(res)).code).toBe('validation')
		}
		// An adapter's own cursor still passes straight through.
		expect((await call(server, 'GET', '/media?limit=2&cursor=whatever-the-adapter-said')).status).toBe(200)
	})

	test('an adapter that reports more pages but no cursor stops the merge instead of dropping its items', async () => {
		let listCalls = 0
		const adapter = stubAdapter({
			page: { items: [UPLOADED], hasMore: true },
			staticFilesDir: '/public/uploads',
			onList: () => {
				listCalls++
			},
		})
		const { server, root } = await freshServerWithAdapter(() => adapter)
		await writeProjectImages(root, { 'public/assets/hero.png': PNG })

		const page = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&limit=10'))
		expect(listCalls).toBe(1)
		// Its items survive, and the scan is not reached — falling through would silently
		// swallow whatever the adapter still had. hasMore stays truthful even though the
		// adapter gave us nothing to advance with.
		expect(page.items.map(i => i.url)).toEqual(['/uploads/up.png'])
		expect(page.hasMore).toBe(true)
		expect(page.cursor).toBeUndefined()
	})

	test('paginating a scan full of colliding filenames repeats nothing and drops nothing', async () => {
		const { server, root } = await freshServerWithAdapter(() => stubAdapter({ staticFilesDir: '/public/uploads' }))
		const files: Record<string, Buffer> = {}
		for (const dir of ['a', 'b', 'c', 'd', 'e', 'f']) {
			files[`public/${dir}/hero.png`] = PNG
			files[`public/${dir}/logo.png`] = PNG
		}
		await writeProjectImages(root, files)

		const seen: string[] = []
		let query = '/media?includeProjectImages=true&limit=3'
		for (let page = 0; page < 10; page++) {
			const result = await jsonOf<MediaListResult>(await call(server, 'GET', query))
			seen.push(...result.items.map(i => i.url))
			if (!result.hasMore) break
			expect(result.cursor).toBeDefined()
			query = `/media?includeProjectImages=true&limit=3&cursor=${encodeURIComponent(result.cursor!)}`
		}
		expect(seen).toEqual([
			'/a/hero.png',
			'/b/hero.png',
			'/c/hero.png',
			'/d/hero.png',
			'/e/hero.png',
			'/f/hero.png',
			'/a/logo.png',
			'/b/logo.png',
			'/c/logo.png',
			'/d/logo.png',
			'/e/logo.png',
			'/f/logo.png',
		])
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
