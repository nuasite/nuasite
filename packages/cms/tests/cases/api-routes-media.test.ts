import { createCmsCore, createLocalStorageAdapter, createNodeFs } from '@nuasite/cms-core'
import type { MediaItem } from '@nuasite/cms-types'
import { afterEach, describe, expect, test } from 'bun:test'
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
 * Drive one GET route through a real `node:http` server, exactly as the dev
 * middleware does — the handler writes to a genuine `ServerResponse`.
 */
async function getRoute<T>(route: string, context: Omit<RouteContext, 'req' | 'res' | 'route'>): Promise<T> {
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
		const response = await fetch(`http://127.0.0.1:${address.port}/_nua/cms/${route}`)
		// `Response.json()` is untyped; the route's wire shape is what we assert on.
		const body: T = await response.json()
		return body
	} finally {
		server.close()
	}
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
