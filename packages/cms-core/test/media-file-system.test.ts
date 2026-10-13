import { createFileSystemStorageAdapter, createStagedFileSystem, MEDIA_INVALID_FOLDER, MEDIA_INVALID_ID, MEDIA_NOT_FOUND } from '@nuasite/cms-core'
import type { CmsFileSystem } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

/** An empty project held in memory: the adapter must work over the port alone. */
function memoryFileSystem(): CmsFileSystem {
	const empty: CmsFileSystem = {
		readFile: path => Promise.reject(new Error(`ENOENT: ${path}`)),
		readBytes: path => Promise.reject(new Error(`ENOENT: ${path}`)),
		writeFile: () => Promise.reject(new Error('read-only')),
		writeBytes: () => Promise.reject(new Error('read-only')),
		rename: () => Promise.reject(new Error('read-only')),
		remove: () => Promise.resolve(),
		exists: () => Promise.resolve(false),
		list: () => Promise.resolve([]),
		glob: () => Promise.resolve([]),
		stat: path => Promise.reject(new Error(`ENOENT: ${path}`)),
	}
	return createStagedFileSystem(empty)
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('createFileSystemStorageAdapter', () => {
	test('uploads bytes under the directory and lists them with folders', async () => {
		const fs = memoryFileSystem()
		const media = createFileSystemStorageAdapter(fs, { dir: 'public/media', urlPrefix: '/media/' })

		const uploaded = await media.upload(PNG, 'Photo.PNG', 'image/png', { folder: 'team' })
		expect(uploaded).toMatchObject({ success: true, url: expect.stringMatching(/^\/media\/team\/[0-9a-f-]{36}\.png$/) })
		expect(await fs.readBytes(`public/media/${uploaded.id}`)).toEqual(new Uint8Array(PNG))
		expect(await media.createFolder?.('empty')).toEqual({ success: true })

		const rootListing = await media.list()
		expect(rootListing.items).toEqual([])
		expect(rootListing.folders).toEqual([{ name: 'empty', path: 'empty' }, { name: 'team', path: 'team' }])
		const teamListing = await media.list({ folder: 'team' })
		expect(teamListing.items).toEqual([expect.objectContaining({ id: uploaded.id, url: uploaded.url, contentType: 'image/png', folder: 'team' })])
		expect(media.staticFiles).toEqual({ urlPrefix: '/media', dir: 'public/media' })
	})

	test('deletes by id and refuses ids and folders outside the directory', async () => {
		const media = createFileSystemStorageAdapter(memoryFileSystem())
		const uploaded = await media.upload(PNG, 'a.png', 'image/png')
		if (uploaded.id === undefined) throw new Error('no id')

		expect(await media.delete(uploaded.id)).toEqual({ success: true })
		expect(await media.delete(uploaded.id)).toEqual({ success: false, error: MEDIA_NOT_FOUND })
		expect(await media.delete('../secret.txt')).toEqual({ success: false, error: MEDIA_INVALID_ID })
		expect(await media.upload(PNG, 'a.png', 'image/png', { folder: '%2e%2e' })).toEqual({ success: false, error: MEDIA_INVALID_FOLDER })
		expect(await media.list({ folder: '../..' })).toEqual({ items: [], folders: [], hasMore: false })
	})
})
