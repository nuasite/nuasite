import { createContemberStorageAdapter, createS3StorageAdapter } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

describe('createS3StorageAdapter', () => {
	/** What the adapter sent to the bucket, as `<command> <key or prefix>`. */
	const sent: string[] = []
	/** When set, the bucket fails every request with this message. */
	let failure: string | undefined

	// The SDK is an optional peer dependency the adapter imports lazily; stand in for the
	// exports it uses so the test sees exactly which keys reach the bucket.
	const command = (name: string, target: 'Key' | 'Prefix') =>
		class {
			readonly sent: string
			constructor(input: { Key?: string; Prefix?: string }) {
				this.sent = `${name} ${input[target]}`
			}
		}
	void mock.module('@aws-sdk/client-s3', () => ({
		S3Client: class {
			async send(request: { sent: string }): Promise<object> {
				if (failure !== undefined) throw new Error(failure)
				sent.push(request.sent)
				return {}
			}
		},
		DeleteObjectCommand: command('delete', 'Key'),
		PutObjectCommand: command('put', 'Key'),
		ListObjectsV2Command: command('list', 'Prefix'),
	}))

	afterEach(() => {
		sent.length = 0
		failure = undefined
	})

	test('delete removes a key under the configured prefix', async () => {
		const adapter = createS3StorageAdapter({ bucket: 'b', region: 'r', prefix: 'media' })
		expect(await adapter.delete('media/pic.png')).toEqual({ success: true })
		expect(await adapter.delete('media/photos/pic..png')).toEqual({ success: true })
		expect(sent).toEqual(['delete media/pic.png', 'delete media/photos/pic..png'])
	})

	test('delete refuses a key outside the configured prefix', async () => {
		const adapter = createS3StorageAdapter({ bucket: 'b', region: 'r' })
		for (const id of ['backups/db.sql', 'uploads', 'uploads-private/pic.png', '/uploads/pic.png', '../uploads/pic.png', '']) {
			expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
		}
		expect(sent).toEqual([])

		expect(await adapter.delete('uploads/pic.png')).toEqual({ success: true })
		expect(sent).toEqual(['delete uploads/pic.png'])
	})

	test('delete takes any key when the adapter owns the whole bucket', async () => {
		const adapter = createS3StorageAdapter({ bucket: 'b', region: 'r', prefix: '' })
		expect(await adapter.delete('pic.png')).toEqual({ success: true })
		expect(await adapter.delete('')).toEqual({ success: false, error: 'Invalid media id' })
		expect(sent).toEqual(['delete pic.png'])
	})

	test('no key or folder with a `.` or `..` segment reaches the bucket', async () => {
		const adapter = createS3StorageAdapter({ bucket: 'b', region: 'r' })
		for (const id of ['uploads/../backups/db.sql', 'uploads/./pic.png', 'uploads/photos/..', 'uploads/photos/../../pic.png']) {
			expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
		}
		for (const folder of ['..', '../backups', 'photos/../..', '.', 'photos/./2026']) {
			expect(await adapter.upload(Buffer.from('x'), 'pic.png', 'image/png', { folder })).toEqual({ success: false, error: 'Invalid folder name' })
			expect(await adapter.list({ folder })).toEqual({ items: [], folders: [], hasMore: false })
		}
		expect(sent).toEqual([])

		const uploaded = await adapter.upload(Buffer.from('x'), 'pic.png', 'image/png', { folder: 'photos/2026' })
		expect(uploaded.id).toBe(`uploads/photos/2026/${uploaded.filename}`)
		expect(await adapter.list({ folder: 'photos/2026' })).toEqual({ items: [], folders: [], hasMore: false, cursor: undefined })
		expect(await adapter.delete(uploaded.id!)).toEqual({ success: true })
		expect(sent).toEqual([`put ${uploaded.id}`, 'list uploads/photos/2026/', `delete ${uploaded.id}`])
	})

	test('a configured prefix is taken as it is, dot segments and all', async () => {
		for (const prefix of ['..', './dot', 'x/../y']) {
			const adapter = createS3StorageAdapter({ bucket: 'b', region: 'r', prefix })
			const uploaded = await adapter.upload(Buffer.from('x'), 'pic.png', 'image/png', { folder: 'photos' })
			expect(uploaded.id).toBe(`${prefix}/photos/${uploaded.filename}`)
			expect({ prefix, result: await adapter.delete(uploaded.id!) }).toEqual({ prefix, result: { success: true } })
			expect(sent.splice(0)).toEqual([`put ${uploaded.id}`, `delete ${uploaded.id}`])

			// What follows the prefix is still checked.
			for (const id of [`${prefix}/../pic.png`, `${prefix}/photos/./pic.png`, `${prefix}`, `${prefix}x/pic.png`]) {
				expect({ id, result: await adapter.delete(id) }).toEqual({ id, result: { success: false, error: 'Invalid media id' } })
			}
			expect(sent).toEqual([])
		}
	})

	test("an error from the bucket never reads as one of the adapter's own refusals", async () => {
		const adapter = createS3StorageAdapter({ bucket: 'b', region: 'r' })
		for (failure of ['Invalid media id', 'Invalid folder name', 'Media file not found', 'NoSuchBucket']) {
			expect(await adapter.delete('uploads/pic.png')).toEqual({ success: false, error: `Delete failed: ${failure}` })
		}
	})
})

describe('createContemberStorageAdapter', () => {
	const adapter = createContemberStorageAdapter({ apiBaseUrl: 'https://api.example.com/', projectSlug: 'site' })
	const realFetch = globalThis.fetch
	/** `METHOD url` of every request the adapter made. */
	const requests: string[] = []
	/** What the service answers with. */
	let answer = () => new Response(null, { status: 200 })

	beforeEach(() => {
		const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			// Through `URL`, so it is the address actually requested, dot segments resolved.
			const url = new URL(input instanceof Request ? input.url : input)
			requests.push(`${init?.method ?? 'GET'} ${url.href}`)
			return answer()
		}
		// `typeof fetch` in the bun typings carries a `preconnect` member.
		const stub: typeof fetch = Object.assign(handler, { preconnect: (_url: string | URL): void => {} })
		globalThis.fetch = stub
	})

	afterEach(() => {
		globalThis.fetch = realFetch
		requests.length = 0
		answer = () => new Response(null, { status: 200 })
	})

	test('delete addresses the id as one path segment of the media endpoint', async () => {
		expect(await adapter.delete('3f2c')).toEqual({ success: true })
		expect(await adapter.delete('../../other')).toEqual({ success: true })
		expect(requests).toEqual([
			'DELETE https://api.example.com/cms/site/media/3f2c',
			'DELETE https://api.example.com/cms/site/media/..%2F..%2Fother',
		])
	})

	test('delete refuses an id a URL would resolve away from the media endpoint', async () => {
		for (const id of ['..', '.', '']) {
			expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
		}
		expect(requests).toEqual([])
	})

	test("upload keeps what the service says and marks its error as the service's", async () => {
		answer = () => Response.json({ url: 'https://cdn.example.com/a.png', id: '3f2c' })
		expect(await adapter.upload(Buffer.from('x'), 'a.png', 'image/png')).toEqual({ success: true, url: 'https://cdn.example.com/a.png', id: '3f2c' })

		// A 200 that reports a failure in the adapter's own words is still the service speaking.
		for (const error of ['Media file not found', 'Invalid folder name', 'Invalid media id', 'quota exceeded']) {
			answer = () => Response.json({ success: false, error })
			expect(await adapter.upload(Buffer.from('x'), 'a.png', 'image/png')).toEqual({ success: false, error: `Upload failed: ${error}` })
		}
		answer = () => new Response('Media file not found', { status: 404 })
		expect(await adapter.upload(Buffer.from('x'), 'a.png', 'image/png')).toEqual({
			success: false,
			error: 'Upload failed (404): Media file not found',
		})
	})
})
