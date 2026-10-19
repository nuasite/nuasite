import { createCmsCore, createLocalStorageAdapter, createNodeFs } from '@nuasite/cms-core'
import type { MediaItem, MediaListResult } from '@nuasite/cms-types'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { handleCmsApiRoute, type RouteContext } from '../../src/handlers/api-routes'
import { ManifestWriter } from '../../src/manifest-writer'

/** PNG magic bytes — the scan goes by extension, so the payload only has to be a file. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const cleanups: string[] = []
afterEach(async () => {
	for (const dir of cleanups.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

/** A project root holding the given root-relative files (parent dirs included). */
async function projectWith(files: Record<string, Buffer>): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-api-routes-'))
	cleanups.push(root)
	for (const [relative, bytes] of Object.entries(files)) {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, bytes)
	}
	return root
}

/**
 * Drive one route through a real `node:http` server, exactly as the dev
 * middleware does — the handler writes to a genuine `ServerResponse`. It is handed
 * `route` verbatim, the way the middleware cuts it out of the raw request URL, and
 * reads `query` (`?a=b`) from the request itself, and `body`, when given — a `FormData` as multipart,
 * anything else as JSON.
 */
async function callRoute<T>(
	method: string,
	route: string,
	context: Omit<RouteContext, 'req' | 'res' | 'route'>,
	query = '',
	body?: unknown,
): Promise<{ status: number; body: T }> {
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
		const init: RequestInit = body === undefined
			? { method }
			: body instanceof FormData
			? { method, body }
			: { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
		const response = await fetch(`http://127.0.0.1:${address.port}/_nua/cms/${route}${query}`, init)
		// `Response.json()` is untyped; the route's wire shape is what we assert on.
		const responseBody: T = await response.json()
		return { status: response.status, body: responseBody }
	} finally {
		server.close()
	}
}

async function getRoute<T>(route: string, context: Omit<RouteContext, 'req' | 'res' | 'route'>): Promise<T> {
	return (await callRoute<T>('GET', route, context)).body
}

/** The dev middleware's context, over a temp project root. */
function contextFor(root: string, uploadsDir: string): Omit<RouteContext, 'req' | 'res' | 'route'> {
	const cmsFs = createNodeFs(root)
	const mediaAdapter = createLocalStorageAdapter({ dir: uploadsDir })
	return {
		manifestWriter: new ManifestWriter('cms-manifest.json'),
		core: createCmsCore(cmsFs, { contentDir: 'src/content', media: mediaAdapter }),
		fs: cmsFs,
		projectRoot: root,
		contentDir: 'src/content',
		mediaAdapter,
		maxUploadSize: 10 * 1024 * 1024,
	}
}

describe('GET media/project-images', () => {
	test('the uploads directory is listed by the adapter only, never by the project scan', async () => {
		const root = await projectWith({ 'public/uploads/up.png': PNG, 'public/assets/hero.png': PNG })
		// What `createLocalStorageAdapter` actually reports: an absolute `staticFiles.dir`.
		// Comparing it against the scan's root-relative directories never matched, so every
		// uploaded file came back as a project image too — invisible only because the picker
		// dedupes the two lists by URL client-side.
		const body = await getRoute<{ items: MediaItem[] }>('media/project-images', contextFor(root, path.join(root, 'public/uploads')))
		expect(body.items.map(i => i.url)).toEqual(['/assets/hero.png'])
	})

	test('without a media adapter the scan lists everything, uploads included', async () => {
		const root = await projectWith({ 'public/uploads/up.png': PNG, 'public/assets/hero.png': PNG })
		const { mediaAdapter: _adapter, ...context } = contextFor(root, path.join(root, 'public/uploads'))
		const body = await getRoute<{ items: MediaItem[] }>('media/project-images', context)
		expect(body.items.map(i => i.url)).toEqual(['/assets/hero.png', '/uploads/up.png'])
	})
})

describe('DELETE media/<id>', () => {
	type DeleteBody = { success?: boolean; error?: string }

	test('an id from the listing deletes the file, in a folder too', async () => {
		const root = await projectWith({ 'public/uploads/up.png': PNG, 'public/uploads/photos/up.png': PNG })
		const context = contextFor(root, path.join(root, 'public/uploads'))

		// The editor sends the id as it is; the SDK percent-encodes it. Both arrive here.
		expect(await callRoute<DeleteBody>('DELETE', 'media/up.png', context)).toEqual({ status: 200, body: { success: true } })
		expect(await callRoute<DeleteBody>('DELETE', 'media/photos%2Fup.png', context)).toEqual({ status: 200, body: { success: true } })
		expect(existsSync(path.join(root, 'public/uploads/up.png'))).toBe(false)
		expect(existsSync(path.join(root, 'public/uploads/photos/up.png'))).toBe(false)
	})

	test('an id that leaves the uploads directory is a 400 and removes nothing', async () => {
		// Outside `public/uploads`, inside the temp project: no id below climbs past `root`.
		const root = await projectWith({ 'victim.txt': PNG, 'public/elsewhere/victim.txt': PNG, 'public/uploads/photos/up.png': PNG })
		await fs.symlink(path.join(root, 'public/elsewhere'), path.join(root, 'public/uploads/shared'))
		const context = contextFor(root, path.join(root, 'public/uploads'))

		const ids = [
			'../../victim.txt',
			'..%2F..%2Fvictim.txt',
			'%2e%2e%2f%2e%2e%2fvictim.txt',
			'photos/../../../victim.txt',
			'..%2F..%2Fvictim.txt%00',
			'shared/victim.txt',
			encodeURIComponent(path.join(root, 'victim.txt')),
			'photos//up.png',
			'%E0%A4%A',
		]
		for (const id of ids) {
			const response = await callRoute<DeleteBody>('DELETE', `media/${id}`, context)
			expect({ id, status: response.status }).toEqual({ id, status: 400 })
			expect(response.body.error).toBe('Invalid media id')
		}
		// A backslash separates nothing here: a plain name nobody has.
		const backslash = await callRoute<DeleteBody>('DELETE', 'media/..%5C..%5Cvictim.txt', context)
		expect(backslash).toEqual({ status: 404, body: { success: false, error: 'Media file not found' } })

		for (const file of ['victim.txt', 'public/elsewhere/victim.txt', 'public/uploads/photos/up.png']) {
			expect(existsSync(path.join(root, file))).toBe(true)
		}
	})

	test('the id is decoded exactly once', async () => {
		// Two files a second decode would confuse: the id of the first decodes to the second.
		const root = await projectWith({ 'public/uploads/50%25off.png': PNG, 'public/uploads/50%off.png': PNG })
		const context = contextFor(root, path.join(root, 'public/uploads'))

		const response = await callRoute<DeleteBody>('DELETE', `media/${encodeURIComponent('50%25off.png')}`, context)
		expect(response).toEqual({ status: 200, body: { success: true } })
		expect(await fs.readdir(path.join(root, 'public/uploads'))).toEqual(['50%off.png'])
	})

	test('a file that is not there is a 404 that does not spell out the filesystem path', async () => {
		const root = await projectWith({ 'public/uploads/up.png': PNG })
		const response = await callRoute<DeleteBody>('DELETE', 'media/nope.png', contextFor(root, path.join(root, 'public/uploads')))
		expect(response).toEqual({ status: 404, body: { success: false, error: 'Media file not found' } })
	})

	test('a storage failure is a 500, as on the sidecar', async () => {
		// `unlink` refuses a directory: the adapter reports it as a failure of its own, not a refusal.
		const root = await projectWith({ 'public/uploads/photos/up.png': PNG })
		const response = await callRoute<DeleteBody>('DELETE', 'media/photos', contextFor(root, path.join(root, 'public/uploads')))
		expect(response.status).toBe(500)
		expect(response.body.error).toMatch(/^Failed to delete media file/)
		expect(existsSync(path.join(root, 'public/uploads/photos/up.png'))).toBe(true)
	})
})

describe('GET media/list', () => {
	test('a folder outside the uploads directory lists nothing', async () => {
		const root = await projectWith({ 'public/secret.png': PNG, 'public/elsewhere/secret.png': PNG, 'public/uploads/photos/up.png': PNG })
		await fs.symlink(path.join(root, 'public/elsewhere'), path.join(root, 'public/uploads/shared'))
		const context = contextFor(root, path.join(root, 'public/uploads'))

		for (const folder of ['..', '../elsewhere', 'photos/../..', 'shared']) {
			const response = await callRoute<MediaListResult>('GET', 'media/list', context, `?folder=${encodeURIComponent(folder)}`)
			expect({ folder, response }).toEqual({ folder, response: { status: 200, body: { items: [], folders: [], hasMore: false } } })
		}
		const inside = await callRoute<MediaListResult>('GET', 'media/list', context, '?folder=photos')
		expect(inside.body.items.map(i => i.id)).toEqual(['photos/up.png'])
	})

	test('a ?type= listing pages without losing an item, under a cursor bound to its tab', async () => {
		const root = await projectWith({})
		const uploads = path.join(root, 'public/uploads')
		// Newest first, so the order the adapter lists them in is pinned by mtime.
		const files = ['a.png', 'spec.pdf', 'b.png', 'c.png']
		for (const [index, name] of files.entries()) {
			const target = path.join(uploads, name)
			await fs.mkdir(uploads, { recursive: true })
			await fs.writeFile(target, PNG)
			const time = new Date(Date.UTC(2026, 0, 1, 0, 0, files.length - index))
			await fs.utimes(target, time, time)
		}
		const context = contextFor(root, uploads)

		const first = await callRoute<MediaListResult>('GET', 'media/list', context, '?type=photo&limit=2')
		expect(first.status).toBe(200)
		expect(first.body.appliedType).toBe('photo')
		expect(first.body.items.map(i => i.id)).toEqual(['a.png', 'b.png'])
		const cursor = encodeURIComponent(first.body.cursor!)

		const second = await callRoute<MediaListResult>('GET', 'media/list', context, `?type=photo&limit=2&cursor=${cursor}`)
		expect(second.body.items.map(i => i.id)).toEqual(['c.png'])
		expect(second.body.hasMore).toBe(false)

		// A cursor that would ask the adapter for a million items, past the `limit` clamp.
		const widened = Buffer.from(JSON.stringify({ fv: 1, type: 'photo', skip: 0, size: 1_000_000 })).toString('base64url')
		const refusals = [`?type=document&limit=2&cursor=${cursor}`, `?limit=2&cursor=${cursor}`, '?type=photo&cursor=2', `?type=photo&cursor=${widened}`]
		for (const query of refusals) {
			const refused = await callRoute<{ error?: string }>('GET', 'media/list', context, query)
			expect({ query, status: refused.status }).toEqual({ query, status: 400 })
			expect(refused.body.error).toBeString()
		}
	})
})

describe('POST media/folder', () => {
	type FolderBody = { success?: boolean; error?: string }

	test('a folder with a dot segment, spelled out or percent-encoded, or a backslash is a 400 and creates nothing', async () => {
		const root = await projectWith({ 'public/uploads/keep.png': PNG })
		const context = contextFor(root, path.join(root, 'public/uploads'))

		for (const folder of ['..', 'photos/..', '../elsewhere', '.', '%2e%2e', '%2E%2e/x', '.%2e', 'photos/%2e', 'a\\b', '..\\x']) {
			const response = await callRoute<FolderBody>('POST', 'media/folder', context, '', { folder })
			expect({ folder, response }).toEqual({ folder, response: { status: 400, body: { error: 'Invalid folder name' } } })
		}
		expect(await fs.readdir(root)).toEqual(['public'])
		expect(await fs.readdir(path.join(root, 'public/uploads'))).toEqual(['keep.png'])
	})

	test('a folder that only has dots inside a name is created', async () => {
		const root = await projectWith({ 'public/uploads/keep.png': PNG })
		const context = contextFor(root, path.join(root, 'public/uploads'))

		for (const folder of ['a..b', '...', 'v1.2/..x', '%2e%2e%2e', 'with space', 'ünïcode']) {
			const response = await callRoute<FolderBody>('POST', 'media/folder', context, '', { folder })
			expect({ folder, response }).toEqual({ folder, response: { status: 200, body: { success: true } } })
		}
		expect((await fs.readdir(path.join(root, 'public/uploads'))).sort()).toEqual([
			'%2e%2e%2e',
			'...',
			'a..b',
			'keep.png',
			'v1.2',
			'with space',
			'ünïcode',
		])
	})
})

describe('POST media/upload', () => {
	type UploadBody = { success?: boolean; url?: string; error?: string }

	function form(name: string, type: string): FormData {
		const data = new FormData()
		data.append('file', new File([new Uint8Array(16)], name, { type }))
		return data
	}

	test('an MP4 or WebM video is accepted into the uploads directory', async () => {
		const root = await projectWith({})
		const context = contextFor(root, path.join(root, 'public/uploads'))

		for (const [name, type] of [['clip.mp4', 'video/mp4'], ['clip.webm', 'video/webm']]) {
			const response = await callRoute<UploadBody>('POST', 'media/upload', context, '', form(name!, type!))
			expect(response.status).toBe(200)
			expect(response.body.url).toMatch(/^\/uploads\/.+\.(mp4|webm)$/)
		}
	})

	test('a QuickTime movie is still refused', async () => {
		const root = await projectWith({})
		const response = await callRoute<UploadBody>(
			'POST',
			'media/upload',
			contextFor(root, path.join(root, 'public/uploads')),
			'',
			form('clip.mov', 'video/quicktime'),
		)
		expect(response.status).toBe(400)
		expect(response.body.error).toBe('File type not allowed: video/quicktime')
	})
})
