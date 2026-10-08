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
 * reads `query` (`?a=b`) from the request itself.
 */
async function callRoute<T>(
	method: string,
	route: string,
	context: Omit<RouteContext, 'req' | 'res' | 'route'>,
	query = '',
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
		const response = await fetch(`http://127.0.0.1:${address.port}/_nua/cms/${route}${query}`, { method })
		// `Response.json()` is untyped; the route's wire shape is what we assert on.
		const body: T = await response.json()
		return { status: response.status, body }
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
		expect(backslash).toEqual({ status: 400, body: { success: false, error: 'Media file not found' } })

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

	test('a file that is not there is a 400 that does not spell out the filesystem path', async () => {
		const root = await projectWith({ 'public/uploads/up.png': PNG })
		const response = await callRoute<DeleteBody>('DELETE', 'media/nope.png', contextFor(root, path.join(root, 'public/uploads')))
		expect(response).toEqual({ status: 400, body: { success: false, error: 'Media file not found' } })
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
})
