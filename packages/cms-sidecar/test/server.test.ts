import { createCmsCore, createLocalStorageAdapter, createNodeFs, MEDIA_INVALID_FOLDER, MEDIA_INVALID_ID, MEDIA_NOT_FOUND } from '@nuasite/cms-core'
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
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
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
				i18n: { defaultLocale: 'en', locales: ['en', 'cs'] },
				nua: {
					cms: {
						cmsConfig: {
							locale: 'cs',
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
		// The project's language, for a client to order collection labels by: the explicit
		// `cmsConfig.locale`, ahead of Astro's `i18n.defaultLocale`.
		expect(config.locale).toBe('cs')
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

	describe('route discovery reads page frontmatter structurally', () => {
		async function authorsPathnames(pages: Record<string, string>): Promise<Array<string | undefined>> {
			const { server, root } = await freshServer()
			for (const [file, source] of Object.entries(pages)) {
				await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
				await fs.writeFile(path.join(root, file), source)
			}
			const list = await jsonOf<EntriesListResult>(await call(server, 'GET', '/collections/authors/entries?draft=all'))
			expect(list.entries.length).toBeGreaterThan(0)
			return list.entries.map(e => e.pathname)
		}

		test('every collection a `satisfies GetStaticPaths` arrow drives is page-per-item', async () => {
			// The regex scanner only found `getStaticPaths(`, so this form fell back to the first
			// getCollection (`team`) and left `authors` without a route.
			const pathnames = await authorsPathnames({
				'src/pages/crew/[slug].astro': [
					'---',
					"import { getCollection } from 'astro:content'",
					"import type { GetStaticPaths } from 'astro'",
					'export const getStaticPaths = (async () => {',
					"\tconst [team, authors] = await Promise.all([getCollection('team'), getCollection('authors')])",
					'\treturn [...team, ...authors].map((entry) => ({ params: { slug: entry.id }, props: { entry } }))',
					'}) satisfies GetStaticPaths',
					'---',
					'<h1>Crew</h1>',
				].join('\n'),
			})
			expect(pathnames.sort()).toEqual(['/crew/jane-doe', '/crew/john-smith'])
		})

		test('a commented-out getCollection gives the collection no route', async () => {
			// The regex scanner matched the text in the comment and mapped authors to `/contact`.
			const pathnames = await authorsPathnames({
				'src/pages/contact.astro': [
					'---',
					"import { getCollection } from 'astro:content'",
					"// const authors = await getCollection('authors')",
					"const team = await getCollection('team')",
					'---',
					'<h1>Contact</h1>',
				].join('\n'),
			})
			expect(pathnames.every(p => p === undefined)).toBe(true)
		})

		test('a getCollection not imported from astro:content gives the collection no route', async () => {
			// Deliberately stricter than the regex scanner, which accepted any `getCollection(`.
			const pathnames = await authorsPathnames({
				'src/pages/press.astro': [
					'---',
					"import { getCollection } from '../lib/content'",
					"const authors = await getCollection('authors')",
					'---',
					'<h1>Press</h1>',
				].join('\n'),
			})
			expect(pathnames.every(p => p === undefined)).toBe(true)
		})

		test('blank lines before the opening fence still route the collection', async () => {
			const pathnames = await authorsPathnames({
				'src/pages/handbook.astro': [
					'',
					'',
					'---',
					"import { getCollection } from 'astro:content'",
					"const authors = await getCollection('authors')",
					'---',
					'<h1>Handbook</h1>',
				].join('\n'),
			})
			expect(pathnames.every(p => p === '/handbook')).toBe(true)
		})
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
			// The fixture's `blog` schema declares all six fields required (none `.optional()`),
			// and cms-core enforces that on write — a partial frontmatter would come back 400.
			frontmatter: { title: 'New Post', date: '2024-06-01', draft: false, cover: './new-post.jpg', tags: ['intro'], author: 'jane-doe' },
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

	test('DELETE /media/:id refuses an id that leaves the uploads directory → 400, nothing removed', async () => {
		const { server, root } = await freshServer()
		// Outside `public/uploads`, inside the temp project: no id below climbs past `root`.
		const victim = path.join(root, 'victim.txt')
		const elsewhere = path.join(root, 'public/elsewhere/victim.txt')
		const kept = path.join(root, 'public/uploads/photos/kept.png')
		await writeProjectImages(root, { 'victim.txt': PNG, 'public/elsewhere/victim.txt': PNG, 'public/uploads/photos/kept.png': PNG })
		await fs.symlink(path.join(root, 'public/elsewhere'), path.join(root, 'public/uploads/shared'))

		const refused = [
			'..%2F..%2Fvictim.txt',
			'%2e%2e%2f%2e%2e%2fvictim.txt',
			'photos%2F..%2F..%2F..%2Fvictim.txt',
			'..%2F..%2Fvictim.txt%00',
			'photos%2F..%2Fphotos%2Fkept.png',
			'photos%2F%2Fkept.png',
			'shared%2Fvictim.txt',
			encodeURIComponent(victim),
			encodeURIComponent(kept),
		]
		for (const encoded of refused) {
			const res = await call(server, 'DELETE', `/media/${encoded}`)
			expect({ encoded, status: res.status }).toEqual({ encoded, status: 400 })
			expect(await jsonOf<ApiError>(res)).toEqual({ error: 'Invalid media id', code: 'validation' })
		}

		// A backslash separates nothing here and an id is decoded once: these are plain names nobody has.
		for (const encoded of ['..%5C..%5Cvictim.txt', '..%252F..%252Fvictim.txt']) {
			const res = await call(server, 'DELETE', `/media/${encoded}`)
			expect({ encoded, status: res.status }).toEqual({ encoded, status: 404 })
		}
		for (const file of [victim, elsewhere, kept]) expect(existsSync(file)).toBe(true)

		// The id as the listing spells it still deletes.
		const ok = await call(server, 'DELETE', `/media/${encodeURIComponent('photos/kept.png')}`)
		expect(ok.status).toBe(200)
		expect(existsSync(kept)).toBe(false)
	})

	test('DELETE /media/:id decodes the id exactly once', async () => {
		const { server, root } = await freshServer()
		// Two files a second decode would confuse: the id of the first decodes to the second.
		await writeProjectImages(root, { 'public/uploads/50%25off.png': PNG, 'public/uploads/50%off.png': PNG })
		const listed = await jsonOf<MediaListResult>(await call(server, 'GET', '/media'))
		expect(listed.items.map(i => i.id).sort()).toEqual(['50%25off.png', '50%off.png'])

		const res = await call(server, 'DELETE', `/media/${encodeURIComponent('50%25off.png')}`)
		expect(res.status).toBe(200)
		expect(await fs.readdir(path.join(root, 'public/uploads'))).toEqual(['50%off.png'])
	})

	test('DELETE /media/:id for a file that is not there → 404, without the filesystem path', async () => {
		const { server, root } = await freshServer()
		const res = await call(server, 'DELETE', '/media/nope.png')
		expect(res.status).toBe(404)
		const body = await jsonOf<ApiError>(res)
		expect(body).toEqual({ error: 'Media file not found', code: 'not_found' })
		expect(JSON.stringify(body)).not.toContain(root)
	})

	test('a path that is not valid percent-encoding → 400 rather than a crash', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'DELETE', '/media/%E0%A4%A')
		expect(res.status).toBe(400)
		expect((await jsonOf<ApiError>(res)).code).toBe('validation')
	})

	test('media folder outside the uploads directory: nothing listed, nothing written', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/secret.png': PNG, 'public/elsewhere/secret.png': PNG, 'public/uploads/keep.png': PNG })
		await fs.symlink(path.join(root, 'public/elsewhere'), path.join(root, 'public/uploads/shared'))
		const before = (await fs.readdir(root, { recursive: true })).sort()

		for (const folder of ['..', '../..', '../made-up', 'photos/../../made-up', 'shared', 'shared/sub']) {
			const query = `folder=${encodeURIComponent(folder)}`
			const listed = await call(server, 'GET', `/media?${query}`)
			expect(listed.status).toBe(200)
			expect(await jsonOf<MediaListResult>(listed)).toEqual({ items: [], folders: [], hasMore: false })

			const form = new FormData()
			form.append('file', new File([PNG], 'pic.png', { type: 'image/png' }))
			const upload = await server.fetch(new Request(`${BASE}/media?${query}`, { method: 'POST', body: form }))
			expect({ folder, status: upload.status }).toEqual({ folder, status: 400 })
			expect(await jsonOf<ApiError>(upload)).toEqual({ error: 'Invalid folder name', code: 'validation' })
		}
		expect((await fs.readdir(root, { recursive: true })).sort()).toEqual(before)
	})

	test('POST /media create-folder: a refused folder → 400, one that cannot be made → 500, neither with a filesystem path', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/elsewhere/secret.png': PNG, 'public/uploads/keep.png': PNG })
		await fs.symlink(path.join(root, 'public/elsewhere'), path.join(root, 'public/uploads/shared'))
		const before = (await fs.readdir(root, { recursive: true })).sort()

		for (const folder of ['.', 'photos/./2026', 'shared/sub', 'photos\0']) {
			const res = await call(server, 'POST', '/media', { folder })
			expect({ folder, status: res.status }).toEqual({ folder, status: 400 })
			expect(await jsonOf<ApiError>(res)).toEqual({ error: 'Invalid folder name', code: 'validation' })
		}

		for (const [folder, code] of [['keep.png', 'EEXIST'], ['keep.png/sub', 'ENOTDIR'], ['x'.repeat(300), 'ENAMETOOLONG']]) {
			const res = await call(server, 'POST', '/media', { folder })
			expect({ folder, status: res.status }).toEqual({ folder, status: 500 })
			expect(await jsonOf<ApiError>(res)).toEqual({ error: `Failed to create folder (${code})`, code: 'io_error' })

			// Listing such a name answers with nothing rather than failing.
			const listed = await call(server, 'GET', `/media?folder=${encodeURIComponent(folder!)}`)
			expect(listed.status).toBe(200)
			expect(await jsonOf<MediaListResult>(listed)).toEqual({ items: [], folders: [], hasMore: false })
		}
		expect((await fs.readdir(root, { recursive: true })).sort()).toEqual(before)

		expect((await call(server, 'POST', '/media', { folder: 'photos/2026' })).status).toBe(200)
		expect(existsSync(path.join(root, 'public/uploads/photos/2026'))).toBe(true)
	})

	test('POST /media create-folder refuses a dot segment, spelled out or percent-encoded, or a backslash, whatever the adapter', async () => {
		// An adapter that would create anything: the route is what keeps these out of it.
		const created: string[] = []
		const { server } = await freshServerWithAdapter(() => ({
			list: async () => ({ items: [], folders: [], hasMore: false }),
			upload: async () => ({ success: false }),
			delete: async () => ({ success: false }),
			createFolder: async (folder: string) => {
				created.push(folder)
				return { success: true }
			},
		}))

		for (const folder of ['..', 'photos/..', '../elsewhere', '%2e%2e', '%2E%2e/x', '.%2e', 'photos/%2e', 'a\\b']) {
			const res = await call(server, 'POST', '/media', { folder })
			expect({ folder, status: res.status }).toEqual({ folder, status: 400 })
			expect(await jsonOf<ApiError>(res)).toEqual({ error: 'Invalid folder name', code: 'validation' })
		}
		expect(created).toEqual([])

		for (const folder of ['a..b', '...', 'v1.2/..x', '%2e%2e%2e']) {
			expect({ folder, status: (await call(server, 'POST', '/media', { folder })).status }).toEqual({ folder, status: 200 })
		}
		expect(created).toEqual(['a..b', '...', 'v1.2/..x', '%2e%2e%2e'])
	})

	test('POST /media upload into a folder a URL would read differently → 400, nothing written', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/uploads/keep.png': PNG })
		const before = (await fs.readdir(root, { recursive: true })).sort()

		for (const folder of ['%2e%2e', 'photos/%2E%2e', '.%2e', 'a\\b']) {
			const form = new FormData()
			form.append('file', new File([PNG], 'pic.png', { type: 'image/png' }))
			const upload = await server.fetch(new Request(`${BASE}/media?folder=${encodeURIComponent(folder)}`, { method: 'POST', body: form }))
			expect({ folder, status: upload.status }).toEqual({ folder, status: 400 })
			expect(await jsonOf<ApiError>(upload)).toEqual({ error: 'Invalid folder name', code: 'validation' })
		}
		expect((await fs.readdir(root, { recursive: true })).sort()).toEqual(before)
	})

	test('media failures are classified by the adapter saying so, never by what an error happens to read like', async () => {
		// Texts an SDK or an upstream service may produce. None of them is the caller's mistake.
		const texts = ['Invalid URL', 'Invalid signature: check your key', 'Delete failed (500): upstream said: route not found', 'invalid media id']
		let text = ''
		const { server } = await freshServerWithAdapter(() => ({
			list: async () => ({ items: [], folders: [], hasMore: false }),
			upload: async () => ({ success: false, error: text }),
			delete: async () => ({ success: false, error: text }),
			createFolder: async () => ({ success: false, error: text }),
		}))
		const form = () => {
			const body = new FormData()
			body.append('file', new File([PNG], 'pic.png', { type: 'image/png' }))
			return body
		}

		const statuses = async () => [
			(await call(server, 'DELETE', '/media/some-id')).status,
			(await call(server, 'POST', '/media', { folder: 'photos' })).status,
			(await server.fetch(new Request(`${BASE}/media`, { method: 'POST', body: form() }))).status,
		]
		for (text of texts) expect({ text, statuses: await statuses() }).toEqual({ text, statuses: [500, 500, 500] })

		for (text of [MEDIA_INVALID_ID, MEDIA_INVALID_FOLDER]) expect({ text, statuses: await statuses() }).toEqual({ text, statuses: [400, 400, 400] })
		text = MEDIA_NOT_FOUND
		expect(await statuses()).toEqual([404, 404, 404])
	})

	test('POST /media with a body that cannot be read, or is not an object → 400, not a storage failure', async () => {
		const { server } = await freshServer()
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			for (const body of ['null', '5', '"photos"', '[]', '{}', '{"folder":7}']) {
				const res = await server.fetch(new Request(`${BASE}/media`, { method: 'POST', body, headers: { 'content-type': 'application/json' } }))
				expect({ body, status: res.status }).toEqual({ body, status: 400 })
				expect(await jsonOf<ApiError>(res)).toEqual({ error: 'A valid "folder" is required', code: 'validation' })
			}

			// Bodies both this runner's `Request` and Bun's own refuse to parse.
			const unreadable = [
				{ type: 'multipart/form-data', body: 'no boundary named' },
				{ type: 'multipart/form-data; boundary=x', body: '--x\r\na header without a colon\r\n\r\nvalue\r\n--x--' },
			]
			for (const { type, body } of unreadable) {
				const res = await server.fetch(new Request(`${BASE}/media`, { method: 'POST', body, headers: { 'content-type': type } }))
				expect({ body, status: res.status }).toEqual({ body, status: 400 })
				expect(await jsonOf<ApiError>(res)).toEqual({ error: 'Malformed multipart/form-data body', code: 'validation' })
			}
			expect(logged).not.toHaveBeenCalled()
		} finally {
			logged.mockRestore()
		}
	})

	test('whatever a media adapter throws → 500 io_error, without its message', async () => {
		const thrown = () => Promise.reject(new Error("EACCES: permission denied, scandir '/srv/site/public/uploads/private'"))
		const { server } = await freshServerWithAdapter(() => ({ list: thrown, upload: thrown, delete: thrown, createFolder: thrown }))
		const form = new FormData()
		form.append('file', new File([PNG], 'pic.png', { type: 'image/png' }))
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			const responses = [
				await call(server, 'GET', '/media'),
				await call(server, 'GET', '/media?folder=private'),
				await call(server, 'GET', '/media?includeProjectImages=true'),
				await call(server, 'DELETE', '/media/some-id'),
				await call(server, 'POST', '/media', { folder: 'photos' }),
				await server.fetch(new Request(`${BASE}/media`, { method: 'POST', body: form })),
			]
			for (const res of responses) {
				expect(res.status).toBe(500)
				expect(await jsonOf<ApiError>(res)).toEqual({ error: 'Media storage failed', code: 'io_error' })
			}
			// The detail is not lost: it goes to the sidecar's own log.
			expect(logged).toHaveBeenCalledTimes(responses.length)
		} finally {
			logged.mockRestore()
		}
	})

	test.skipIf(process.getuid?.() === 0)('GET /media for a folder that cannot be read → 500 io_error, without the filesystem path', async () => {
		const { server, root } = await freshServer()
		const locked = path.join(root, 'public/uploads/locked')
		await fs.mkdir(locked, { recursive: true })
		await fs.chmod(locked, 0o000)
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			const res = await call(server, 'GET', '/media?folder=locked')
			expect(res.status).toBe(500)
			expect(await jsonOf<ApiError>(res)).toEqual({ error: 'Media storage failed', code: 'io_error' })
			expect(logged.mock.calls.map(([, cause]) => String(cause))).toEqual(['Error: Failed to list media (EACCES)'])
		} finally {
			logged.mockRestore()
			await fs.chmod(locked, 0o700)
		}
	})

	test('PATCH /media/:id is 501 when the adapter stores no annotations', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'PATCH', `/media/${encodeURIComponent('photos/pic.png')}`, { annotation: 'A team photo' })
		expect(res.status).toBe(501)
		expect((await jsonOf<ApiError>(res)).code).toBe('unsupported')
	})

	test('PATCH /media/:id hands the decoded id and the annotation to the adapter, an empty one included', async () => {
		const updates: Array<{ id: string; annotation: string }> = []
		const { server } = await freshServerWithAdapter(() => ({
			list: () => Promise.resolve({ items: [], folders: [], hasMore: false }),
			upload: () => Promise.resolve({ success: false }),
			delete: () => Promise.resolve({ success: true }),
			updateAnnotation: (id, annotation) => {
				updates.push({ id, annotation })
				if (id === 'missing.png') return Promise.resolve({ success: false, error: MEDIA_NOT_FOUND })
				if (id === 'broken.png') return Promise.resolve({ success: false, error: 'No such storage' })
				return Promise.resolve({ success: true })
			},
		}))

		const ok = await call(server, 'PATCH', `/media/${encodeURIComponent('photos/pic.png')}`, { annotation: '' })
		expect(ok.status).toBe(200)
		expect(await jsonOf<{ success: boolean }>(ok)).toEqual({ success: true })
		expect(updates).toEqual([{ id: 'photos/pic.png', annotation: '' }])

		const invalid = await call(server, 'PATCH', '/media/pic.png', { annotation: 42 })
		expect(invalid.status).toBe(400)
		expect(updates).toHaveLength(1)

		const failed = await call(server, 'PATCH', '/media/broken.png', { annotation: 'x' })
		expect(failed.status).toBe(500)
		expect((await jsonOf<ApiError>(failed)).error).toBe('No such storage')

		const missing = await call(server, 'PATCH', '/media/missing.png', { annotation: 'x' })
		expect(missing.status).toBe(404)

		expect((await call(server, 'PATCH', '/media/pic.png', null)).status).toBe(400)
	})

	test('a media id with an unencoded slash is not found, rather than acting on its first segment', async () => {
		const updates: string[] = []
		const deletes: string[] = []
		const { server } = await freshServerWithAdapter(() => ({
			list: () => Promise.resolve({ items: [], folders: [], hasMore: false }),
			upload: () => Promise.resolve({ success: false }),
			delete: id => {
				deletes.push(id)
				return Promise.resolve({ success: true })
			},
			updateAnnotation: id => {
				updates.push(id)
				return Promise.resolve({ success: true })
			},
		}))

		expect((await call(server, 'PATCH', '/media/photos/pic.png', { annotation: 'x' })).status).toBe(404)
		expect((await call(server, 'DELETE', '/media/photos/pic.png')).status).toBe(404)
		expect(updates).toEqual([])
		expect(deletes).toEqual([])
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

	test('media list filters by ?type and says so', async () => {
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/assets/hero.png': PNG, 'public/docs/spec.pdf': PNG })
		await uploadPng(server, 'pic.png')

		const photos = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&type=photo'))

		expect(photos.appliedType).toBe('photo')
		expect(photos.items.every(i => i.contentType.startsWith('image/'))).toBe(true)
		expect(photos.items.some(i => i.url.endsWith('spec.pdf'))).toBe(false)
	})

	test('media list rejects an unknown ?type rather than listing everything', async () => {
		const { server } = await freshServer()
		const res = await call(server, 'GET', '/media?type=images')
		expect(res.status).toBe(400)
		expect((await jsonOf<ApiError>(res)).code).toBe('validation')
	})

	test('media list refuses a cursor followed under a different ?type', async () => {
		// The position a filtered cursor marks is a position in *that* tab's stream — in the merged
		// listing it is an offset into the filtered scan. Answering from it under another tab would
		// silently return the wrong slice, so it is a 400, like a lost ?includeProjectImages.
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/assets/a.png': PNG, 'public/assets/b.png': PNG })

		const first = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&type=photo&limit=1'))
		expect(first.hasMore).toBe(true)
		const cursor = encodeURIComponent(first.cursor!)

		const sameTab = await call(server, 'GET', `/media?includeProjectImages=true&type=photo&limit=1&cursor=${cursor}`)
		expect(sameTab.status).toBe(200)

		for (const query of [`type=document&limit=1&cursor=${cursor}`, `limit=1&cursor=${cursor}`]) {
			const res = await call(server, 'GET', `/media?includeProjectImages=true&${query}`)
			expect(res.status).toBe(400)
			expect((await jsonOf<ApiError>(res)).code).toBe('validation')
		}
	})

	test('a filtered adapter listing pages under its own cursor, and refuses one from another tab', async () => {
		const { server } = await freshServer()
		await uploadPng(server, 'one.png')
		await uploadPng(server, 'two.png')

		const first = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?type=photo&limit=1'))
		expect(first.appliedType).toBe('photo')
		expect(first.items).toHaveLength(1)
		expect(first.hasMore).toBe(true)
		const cursor = encodeURIComponent(first.cursor!)

		const next = await jsonOf<MediaListResult>(await call(server, 'GET', `/media?type=photo&limit=1&cursor=${cursor}`))
		expect(next.items).toHaveLength(1)
		expect(next.items[0]!.url).not.toBe(first.items[0]!.url)

		const wrongTab = await call(server, 'GET', `/media?type=graphic&limit=1&cursor=${cursor}`)
		expect(wrongTab.status).toBe(400)
	})

	test('a filtered listing outside the merge refuses a merged cursor instead of restarting', async () => {
		// Both phases of a merged listing: the adapter phase (one upload per page) and the project
		// phase (an offset into the filtered scan). Followed without the flag, or inside a folder,
		// neither is a position in the listing asked for.
		const { server, root } = await freshServer()
		await writeProjectImages(root, { 'public/assets/a.png': PNG, 'public/assets/b.png': PNG })
		await uploadPng(server, 'one.png')
		await uploadPng(server, 'two.png')

		const adapterPhase = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&type=photo&limit=1'))
		const projectPhase = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?includeProjectImages=true&type=photo&limit=3'))
		expect(adapterPhase.hasMore).toBe(true)
		expect(projectPhase.hasMore).toBe(true)

		for (const merged of [adapterPhase.cursor!, projectPhase.cursor!]) {
			const cursor = encodeURIComponent(merged)
			for (const query of [`type=photo&limit=1&cursor=${cursor}`, `includeProjectImages=true&folder=logos&type=photo&limit=1&cursor=${cursor}`]) {
				const res = await call(server, 'GET', `/media?${query}`)
				expect(res.status).toBe(400)
				expect((await jsonOf<ApiError>(res)).code).toBe('validation')
			}
		}
	})

	test('a filtered listing answers a tampered cursor with a 400, not a storage failure', async () => {
		const { server } = await freshServer()
		const forged = Buffer.from(JSON.stringify({ v: 1, adapter: 'not-a-filtered-cursor', type: 'photo' })).toString('base64url')

		const res = await call(server, 'GET', `/media?type=photo&cursor=${forged}`)

		expect(res.status).toBe(400)
		expect((await jsonOf<ApiError>(res)).code).toBe('validation')
	})

	test('a filtered listing refuses a forged cursor that would widen the scan past the limit clamp', async () => {
		const { server } = await freshServer()
		await uploadPng(server, 'one.png')
		const inner = Buffer.from(JSON.stringify({ fv: 1, type: 'photo', skip: 0, size: 1_000_000 })).toString('base64url')
		const forged = Buffer.from(JSON.stringify({ v: 1, adapter: inner, type: 'photo' })).toString('base64url')

		const res = await call(server, 'GET', `/media?type=photo&cursor=${forged}`)

		expect(res.status).toBe(400)
		expect((await jsonOf<ApiError>(res)).code).toBe('validation')
	})

	test('an unfiltered listing still hands the adapter cursor straight through', async () => {
		const { server } = await freshServer()
		await uploadPng(server, 'one.png')
		await uploadPng(server, 'two.png')

		const first = await jsonOf<MediaListResult>(await call(server, 'GET', '/media?limit=1'))

		expect(first.appliedType).toBeUndefined()
		// The local adapter's cursor is a plain offset, not one of ours — unchanged by this.
		expect(first.cursor).toBe('1')
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

/**
 * A collection rendered as a fragment of other pages (tips, testimonials, tags) owns no
 * page, so the sidecar must not compose `<route-prefix>/<slug>` for it — the dash would
 * show, and open, URLs nobody serves. Same rule as `buildCollectionManifestPages` in
 * `@nuasite/cms`'s dev middleware; these tests are its sidecar-side twin.
 */
describe('cms-sidecar — a fragment collection is served without a fabricated URL', () => {
	// The fixture carries a deliberate `fragment` + `pathname` conflict (`tags`), which the
	// config parser reports on every scan. Silenced so the block's output stays readable.
	let warnSpy: { mockRestore(): void } | undefined
	beforeEach(() => {
		warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
	})
	afterEach(() => {
		warnSpy?.mockRestore()
		warnSpy = undefined
	})

	async function entriesOf(collection: string, query = ''): Promise<CollectionEntryInfo[]> {
		const { server } = await freshServerFrom('fragment-project')
		const list = await jsonOf<EntriesListResult>(await call(server, 'GET', `/collections/${collection}/entries?draft=all${query}`))
		return list.entries
	}

	test('a per-item route prefix never reaches a fragment collection', async () => {
		// `tips` is enumerated by `/aktualne/[slug].astro`'s getStaticPaths, so the route
		// resolver maps it page-per-item — but the pages that route makes belong to `articles`.
		const entries = await entriesOf('tips')
		expect(entries.map(e => e.slug).sort()).toEqual(['pozice-1', 'pozice-2'])
		expect(entries.every(e => e.pathname === undefined)).toBe(true)
		expect(JSON.stringify(entries)).not.toContain('/aktualne/pozice-1')
	})

	test('previewOf travels as previewPathname, never as the entry pathname', async () => {
		const entry = (await entriesOf('tips')).find(e => e.slug === 'pozice-1')
		expect(entry?.previewPathname).toBe('/aktualne')
		expect(entry?.pathname).toBeUndefined()
	})

	test('a fragment on a static listing page does not inherit that page as its URL', async () => {
		// `testimonials` is read by `/reference.astro`; the shared-page fallback would hand
		// every entry `/reference`, which is the listing's URL and not the testimonial's.
		const entries = await entriesOf('testimonials')
		expect(entries.map(e => e.slug)).toEqual(['jana'])
		expect(entries[0]?.pathname).toBeUndefined()
		// No `previewOf` declared → nothing invented in its place either.
		expect(entries[0]?.previewPathname).toBeUndefined()
	})

	test('a `cms.pathname` rule on a fragment collection yields no spec-derived URL', async () => {
		// The parser drops the rule as a conflict, so the spec arm cannot fire — asserted
		// end-to-end here because it is the one pathname source the fragment check sits above
		// rather than replaces.
		const entries = await entriesOf('tags')
		expect(entries.map(e => e.slug)).toEqual(['prace'])
		expect(entries[0]?.pathname).toBeUndefined()
		expect(JSON.stringify(entries)).not.toContain('/stitky/prace')
	})

	test('previewPathname survives the ?fields=* projection', async () => {
		const entry = (await entriesOf('tips', '&fields=*')).find(e => e.slug === 'pozice-1')
		expect(entry?.previewPathname).toBe('/aktualne')
		expect(entry?.pathname).toBeUndefined()
	})

	test('GET /collections marks the collection itself, so "no page" is distinguishable from "no route"', async () => {
		const { server } = await freshServerFrom('fragment-project')
		const defs = await jsonOf<CollectionDefinition[]>(await call(server, 'GET', '/collections'))
		expect(defs.find(d => d.name === 'tips')?.fragment).toBe(true)
		expect(defs.find(d => d.name === 'tips')?.previewOf).toBe('/aktualne')
		expect(defs.find(d => d.name === 'articles')?.fragment).toBeUndefined()
	})

	test('regression: a non-fragment collection still gets the route-prefix fallback', async () => {
		// `articles` is driven page-per-item by the same `[slug]` detail as `tips`, and keeps
		// its `<prefix>/<slug>` URL. Its stray `previewOf` (no `fragment`) stays inert.
		const entries = await entriesOf('articles')
		expect(entries.map(e => e.pathname)).toEqual(['/aktualne/prvni-clanek'])
		expect(entries[0]?.previewPathname).toBeUndefined()
	})
})

/**
 * `cms: { label, hidden, order, group }` in the content config is the one channel that
 * reaches a host talking to the standalone sidecar — the Astro config's
 * `nua.cms.collections[name].label` is applied inside the integration and never gets here.
 */
describe('cms-sidecar — collection-browser metadata from the content config', () => {
	async function serverWithNavKeys(): Promise<CmsSidecarServer> {
		const { server, root } = await freshServer()
		const configPath = path.join(root, 'src', 'content', 'config.ts')
		const config = await fs.readFile(configPath, 'utf8')
		await fs.writeFile(
			configPath,
			config
				.replace('const blog = defineCollection({', `const blog = defineCollection({\n\tcms: { label: 'Články', order: 1, group: 'Obsah' },`)
				.replace('const authors = defineCollection({', `const authors = defineCollection({\n\tcms: { label: 'Autoři', hidden: true },`),
		)
		return server
	}

	test('GET /collections serves label, order and group', async () => {
		const defs = await jsonOf<CollectionDefinition[]>(await call(await serverWithNavKeys(), 'GET', '/collections'))
		const blog = defs.find(d => d.name === 'blog')
		expect(blog?.label).toBe('Články')
		expect(blog?.order).toBe(1)
		expect(blog?.group).toBe('Obsah')
		// Undeclared: the name-derived label, and no keys on the wire.
		const people = defs.find(d => d.name === 'people')
		expect(people?.label).toBe('People')
		expect(people && ('order' in people || 'group' in people || 'hidden' in people)).toBe(false)
	})

	test('a hidden collection is flagged, not filtered — it is listed, readable and referenced', async () => {
		const server = await serverWithNavKeys()
		const defs = await jsonOf<CollectionDefinition[]>(await call(server, 'GET', '/collections'))
		const authors = defs.find(d => d.name === 'authors')
		expect(authors?.hidden).toBe(true)
		expect(authors?.label).toBe('Autoři')
		// The reference picker of `blog.author` still resolves through it…
		expect(defs.find(d => d.name === 'blog')?.fields.find(f => f.name === 'author')?.collection).toBe('authors')
		// …and so do its entry routes.
		const list = await call(server, 'GET', '/collections/authors/entries?draft=all')
		expect(list.status).toBe(200)
		expect((await jsonOf<EntriesListResult>(list)).entries.map(e => e.slug).sort()).toEqual(['jane-doe', 'john-smith'])
		expect((await call(server, 'GET', '/collections/authors/entries/jane-doe')).status).toBe(200)
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

describe('shared collection scan', () => {
	async function serverWithScanSpy() {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-shared-'))
		await fs.cp(FIXTURE_ROOT, root, { recursive: true })
		cleanups.push(root)
		const nodeFs = createNodeFs(root)
		const core = createCmsCore(nodeFs, { componentDirs: ['src/components'] })
		const scanOnce = core.scanCollections
		const scan = spyOn(core, 'scanCollections')
		const server = createServer({ core, fs: nodeFs, root, coreVersion: '0.42.1' })
		return { server, scan, scanOnce }
	}

	test('concurrent entry lists of different collections share one scan', async () => {
		const { server, scan } = await serverWithScanSpy()

		const responses = await Promise.all(['blog', 'docs', 'team', 'people', 'blog'].map(c => call(server, 'GET', `/collections/${c}/entries`)))

		expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200, 200])
		expect(scan).toHaveBeenCalledTimes(1)
	})

	test('a list requested after a write does not join a scan that started before it', async () => {
		const { server, scan, scanOnce } = await serverWithScanSpy()
		const scanned = Promise.withResolvers<void>()
		const held = Promise.withResolvers<void>()
		scan.mockImplementationOnce(async () => {
			const map = await scanOnce()
			scanned.resolve()
			await held.promise
			return map
		})

		const before = call(server, 'GET', '/collections/blog/entries?draft=all')
		await scanned.promise
		const created = await call(server, 'POST', '/collections/blog/entries', {
			slug: 'new-post',
			frontmatter: { title: 'New Post', date: '2024-06-01', draft: false, cover: './new-post.jpg', tags: ['intro'], author: 'jane-doe' },
			body: '# New Post\n\nBody.',
		})
		expect(created.status).toBe(200)
		const after = call(server, 'GET', '/collections/blog/entries?draft=all')
		held.resolve()

		expect((await jsonOf<EntriesListResult>(await after)).entries.map(e => e.slug)).toContain('new-post')
		expect((await jsonOf<EntriesListResult>(await before)).entries.map(e => e.slug)).not.toContain('new-post')
	})
})

/**
 * `GET /project` says which collections the scan behind its `collections` cannot vouch for.
 * It rides on that answer because it is the one that is an object: `/collections` is a bare
 * array, and a field an older client ignores cannot be added to it.
 */
describe('cms-sidecar — collection scan report', () => {
	type Core = ReturnType<typeof createCmsCore>

	async function projectWith(wrapCore: (core: Core) => Core = core => core): Promise<{ server: CmsSidecarServer; root: string }> {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-sidecar-report-'))
		await fs.cp(FIXTURE_ROOT, root, { recursive: true })
		cleanups.push(root)
		const nodeFs = createNodeFs(root)
		const core = wrapCore(createCmsCore(nodeFs, { componentDirs: ['src/components'] }))
		return { server: createServer({ core, fs: nodeFs, root, coreVersion: '0.42.1' }), root }
	}

	/** Declare a collection the scan cannot follow and break one it could. */
	async function leaveTwoUnresolved(root: string): Promise<void> {
		const configPath = path.join(root, 'src', 'content', 'config.ts')
		const config = await fs.readFile(configPath, 'utf8')
		await fs.writeFile(
			configPath,
			config.replace('{ blog, authors, people }', `{ blog, authors, people, glossary: defineCollection({ loader: file('src/data/glossary.json') }) }`),
		)
		await fs.writeFile(path.join(root, 'src', 'content', 'docs', 'broken.md'), '---\ntitle: [unclosed\n---\n')
	}

	test('a project the scan reads whole reports an empty list, which is not the same as no report', async () => {
		const { server } = await projectWith()
		const model = await jsonOf<ProjectModel>(await call(server, 'GET', '/project'))
		expect(model.collectionScan).toEqual({ contentConfig: 'ok', unresolved: [] })
	})

	test('GET /project names what the scan left out; GET /collections keeps its shape', async () => {
		const { server, root } = await projectWith()
		await leaveTwoUnresolved(root)
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		const model = await jsonOf<ProjectModel>(await call(server, 'GET', '/project'))
		const defs = await jsonOf<CollectionDefinition[]>(await call(server, 'GET', '/collections'))
		warn.mockRestore()

		expect(model.collectionScan).toEqual({
			contentConfig: 'ok',
			unresolved: [
				{ name: 'docs', reason: 'scan-failed', base: 'src/content/docs' },
				{ name: 'glossary', reason: 'unsupported-loader', file: 'src/data/glossary.json' },
			],
		})
		// Neither is among the collections, in either answer.
		expect(model.collections.map(c => c.name).sort()).toEqual(['authors', 'blog', 'people', 'settings', 'team'])
		expect(Array.isArray(defs)).toBe(true)
		expect(defs.map(c => c.name).sort()).toEqual(['authors', 'blog', 'people', 'settings', 'team'])
	})

	test('GET /project takes its collections and their report from one and the same scan', async () => {
		let scans = 0
		const { server } = await projectWith(core => ({
			...core,
			// Every scan after the first answers for a different project: one without `blog`.
			scanCollections: async options => {
				const collections = await core.scanCollections(options)
				if (scans++ > 0) delete collections['blog']
				return collections
			},
		}))

		const model = await jsonOf<ProjectModel>(await call(server, 'GET', '/project'))

		expect(scans).toBe(1)
		expect(model.collections.map(c => c.name)).toContain('blog')
		expect(model.collectionScan).toEqual({ contentConfig: 'ok', unresolved: [] })
	})

	test('only GET /project asks the core for a report; the collection and entry routes do not pay for one', async () => {
		const asked: Array<boolean | undefined> = []
		const { server } = await projectWith(core => ({
			...core,
			scanCollections: async options => {
				asked.push(options?.report)
				return core.scanCollections(options)
			},
		}))

		expect((await call(server, 'GET', '/collections')).status).toBe(200)
		expect((await call(server, 'GET', '/collections/blog/entries?draft=all')).status).toBe(200)
		expect((await call(server, 'GET', '/collections/blog/entries/hello-world')).status).toBe(200)
		// Scans that were not asked for a report have none, whatever the default.
		expect(asked.length).toBeGreaterThan(0)
		expect(asked.every(report => report === false)).toBe(true)

		asked.length = 0
		const model = await jsonOf<ProjectModel>(await call(server, 'GET', '/project'))
		expect(asked).toEqual([true])
		expect(model.collectionScan).toEqual({ contentConfig: 'ok', unresolved: [] })
	})

	test('a core that does not report leaves the field out', async () => {
		const { server, root } = await projectWith(core => ({ ...core, collectionScanReport: undefined }))
		await leaveTwoUnresolved(root)
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		const model = await jsonOf<ProjectModel>(await call(server, 'GET', '/project'))
		warn.mockRestore()

		expect('collectionScan' in model).toBe(false)
		expect(model.collections.map(c => c.name).sort()).toEqual(['authors', 'blog', 'people', 'settings', 'team'])
	})

	test('a core that edits what its scan returned still reports for that scan', async () => {
		const { server } = await projectWith(core => ({
			...core,
			scanCollections: async options => {
				const collections = await core.scanCollections(options)
				collections['blog']!.label = 'Články'
				return collections
			},
		}))

		const model = await jsonOf<ProjectModel>(await call(server, 'GET', '/project'))

		expect(model.collections.find(c => c.name === 'blog')?.label).toBe('Články')
		expect(model.collectionScan).toEqual({ contentConfig: 'ok', unresolved: [] })
	})
})
