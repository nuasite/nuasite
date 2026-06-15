import type { MutationResult } from '@nuasite/cms-types'
import { afterEach, describe, expect, test } from 'bun:test'
import { type CmsClient, CmsClientError, createClient, isMediaUnavailable } from '../src/client'

const API_BASE = 'http://host.test/cms'

interface RecordedCall {
	url: string
	method: string
	credentials?: RequestCredentials
	body: unknown
	rawBody: BodyInit | null | undefined
}

/** A scripted response for the next matching fetch. */
type Responder = (call: RecordedCall) => Response

const realFetch = globalThis.fetch

/**
 * Install a fetch stub that records each call and answers from a queue of
 * responders (FIFO). Returns the recorded-calls array + a restore fn.
 */
function stubFetch(responders: Responder[]): { calls: RecordedCall[]; restore: () => void } {
	const calls: RecordedCall[] = []
	let i = 0
	// `typeof fetch` in the bun typings carries a `preconnect` member; attaching it
	// via `Object.assign` lets the mock satisfy the type without a cast.
	const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
		const rawBody = init?.body
		let parsedBody: unknown
		if (typeof rawBody === 'string') {
			try {
				parsedBody = JSON.parse(rawBody)
			} catch {
				parsedBody = rawBody
			}
		} else {
			parsedBody = rawBody
		}
		const call: RecordedCall = {
			url,
			method: init?.method ?? 'GET',
			credentials: init?.credentials,
			body: parsedBody,
			rawBody,
		}
		calls.push(call)
		const responder = responders[i++]
		if (!responder) throw new Error(`Unexpected fetch #${i}: ${call.method} ${url}`)
		return Promise.resolve(responder(call))
	}
	const mock: typeof fetch = Object.assign(handler, { preconnect: (_url: string | URL): void => {} })
	globalThis.fetch = mock
	return {
		calls,
		restore: () => {
			globalThis.fetch = realFetch
		},
	}
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let active: { restore: () => void } | null = null
afterEach(() => {
	active?.restore()
	active = null
})

function withFetch(responders: Responder[]): { client: CmsClient; calls: RecordedCall[] } {
	const stub = stubFetch(responders)
	active = stub
	return { client: createClient(API_BASE), calls: stub.calls }
}

describe('createClient — reads', () => {
	test('getConfig requests /config', async () => {
		const body = { listStyles: [{ label: 'Fajfky', class: 'checkmarks' }] }
		const { client, calls } = withFetch([() => jsonResponse(body)])

		const config = await client.getConfig()

		expect(config).toEqual(body)
		expect(calls[0]?.method).toBe('GET')
		expect(calls[0]?.url).toBe(`${API_BASE}/config`)
		expect(calls[0]?.credentials).toBe('include')
	})
})

describe('createClient — mutations', () => {
	test('updateEntry → ok, surfaces sourceHash as the new baseHash; sends baseHash + credentials', async () => {
		const result: MutationResult = { success: true, sourcePath: 'src/content/blog/hello.md', sourceHash: 'sha256:new' }
		const { client, calls } = withFetch([() => jsonResponse(result)])

		const outcome = await client.updateEntry('blog', 'hello', { frontmatter: { title: 'Hi' }, body: 'B', baseHash: 'sha256:old' })

		expect(outcome.status).toBe('ok')
		if (outcome.status === 'ok') expect(outcome.result.sourceHash).toBe('sha256:new')
		const call = calls[0]
		expect(call?.method).toBe('PATCH')
		expect(call?.url).toBe(`${API_BASE}/collections/blog/entries/hello`)
		expect(call?.credentials).toBe('include')
		expect(call?.body).toEqual({ frontmatter: { title: 'Hi' }, body: 'B', baseHash: 'sha256:old' })
	})

	test('updateEntry → 409 returns a typed conflict (not thrown)', async () => {
		const conflict = { code: 'conflict', serverHash: 'sha256:srv', serverFrontmatter: { title: 'Server' }, serverBody: 'srv body' }
		const { client } = withFetch([() => jsonResponse(conflict, 409)])

		const outcome = await client.updateEntry('blog', 'hello', { frontmatter: {}, baseHash: 'stale' })

		expect(outcome.status).toBe('conflict')
		if (outcome.status === 'conflict') {
			expect(outcome.conflict.serverHash).toBe('sha256:srv')
			expect(outcome.conflict.serverFrontmatter.title).toBe('Server')
			expect(outcome.conflict.serverBody).toBe('srv body')
		}
	})

	test('updateEntry → non-409 error throws CmsClientError', async () => {
		const { client } = withFetch([() => jsonResponse({ error: 'boom', code: 'io_error' }, 500)])
		await expect(client.updateEntry('blog', 'hello', {})).rejects.toBeInstanceOf(CmsClientError)
	})

	test('createEntry posts slug/frontmatter/body', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true, sourceHash: 'sha256:c' })])
		const res = await client.createEntry('blog', { slug: 'new', frontmatter: { title: 'T' }, body: 'Body' })
		expect(res.success).toBe(true)
		expect(calls[0]?.method).toBe('POST')
		expect(calls[0]?.url).toBe(`${API_BASE}/collections/blog/entries`)
		expect(calls[0]?.body).toEqual({ slug: 'new', frontmatter: { title: 'T' }, body: 'Body' })
	})

	test('deleteEntry sends DELETE to the entry path', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true })])
		await client.deleteEntry('blog', 'hello')
		expect(calls[0]?.method).toBe('DELETE')
		expect(calls[0]?.url).toBe(`${API_BASE}/collections/blog/entries/hello`)
	})

	test('renameEntry posts { to } to /rename', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true, sourcePath: 'x' })])
		await client.renameEntry('blog', 'hello', 'hello-2')
		expect(calls[0]?.method).toBe('POST')
		expect(calls[0]?.url).toBe(`${API_BASE}/collections/blog/entries/hello/rename`)
		expect(calls[0]?.body).toEqual({ to: 'hello-2' })
	})

	test('addArrayItem omits index when undefined, includes it when given', async () => {
		const { client, calls } = withFetch([
			() => jsonResponse({ success: true }),
			() => jsonResponse({ success: true }),
		])
		await client.addArrayItem('blog', 'hello', 'tags', 'x')
		await client.addArrayItem('blog', 'hello', 'tags', 'y', 2)
		expect(calls[0]?.method).toBe('POST')
		expect(calls[0]?.url).toBe(`${API_BASE}/collections/blog/entries/hello/array`)
		expect(calls[0]?.body).toEqual({ field: 'tags', value: 'x' })
		expect(calls[1]?.body).toEqual({ field: 'tags', value: 'y', index: 2 })
	})

	test('removeArrayItem sends DELETE with field + index', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true })])
		await client.removeArrayItem('blog', 'hello', 'tags', 1)
		expect(calls[0]?.method).toBe('DELETE')
		expect(calls[0]?.url).toBe(`${API_BASE}/collections/blog/entries/hello/array`)
		expect(calls[0]?.body).toEqual({ field: 'tags', index: 1 })
	})

	test('encodes collection/slug path segments', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true })])
		await client.deleteEntry('my blog', 'a/b')
		expect(calls[0]?.url).toBe(`${API_BASE}/collections/my%20blog/entries/a%2Fb`)
	})
})

describe('createClient — media + graceful degradation', () => {
	test('listMedia builds the folder/limit query', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ items: [], folders: [], hasMore: false })])
		await client.listMedia({ folder: 'photos', limit: 10 })
		expect(calls[0]?.method).toBe('GET')
		expect(calls[0]?.url).toBe(`${API_BASE}/media?folder=photos&limit=10`)
	})

	test('uploadMedia posts multipart with the entry/field context on the query', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true, url: '/uploads/pic.png' })])
		const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
		const res = await client.uploadMedia(file, { collection: 'blog', entry: 'hello', field: 'cover' })
		expect(res.url).toBe('/uploads/pic.png')
		expect(calls[0]?.method).toBe('POST')
		expect(calls[0]?.url).toBe(`${API_BASE}/media?collection=blog&entry=hello&field=cover`)
		expect(calls[0]?.rawBody).toBeInstanceOf(FormData)
	})

	test('deleteMedia sends DELETE to /media/:id', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true })])
		await client.deleteMedia('abc')
		expect(calls[0]?.url).toBe(`${API_BASE}/media/abc`)
		expect(calls[0]?.method).toBe('DELETE')
	})

	test('createFolder POSTs a JSON body to /media (the create-folder branch)', async () => {
		const { client, calls } = withFetch([() => jsonResponse({ success: true })])
		const res = await client.createFolder('photos/2026')
		expect(res.success).toBe(true)
		expect(calls[0]?.method).toBe('POST')
		expect(calls[0]?.url).toBe(`${API_BASE}/media`)
		expect(calls[0]?.body).toEqual({ folder: 'photos/2026' })
	})

	test('isMediaUnavailable detects 501 / unsupported', async () => {
		const { client } = withFetch([() => jsonResponse({ error: 'no media', code: 'unsupported' }, 501)])
		let caught: unknown
		try {
			await client.listMedia()
		} catch (e) {
			caught = e
		}
		expect(isMediaUnavailable(caught)).toBe(true)
		expect(isMediaUnavailable(new CmsClientError(404, 'not_found', 'x'))).toBe(false)
		expect(isMediaUnavailable(new Error('plain'))).toBe(false)
	})
})

describe('createClient — error mapping (still works for mutations)', () => {
	test('403 → forbidden', async () => {
		const { client } = withFetch([() => jsonResponse({ error: 'nope' }, 403)])
		let caught: unknown
		try {
			await client.deleteEntry('blog', 'x')
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(CmsClientError)
		if (caught instanceof CmsClientError) {
			expect(caught.isForbidden).toBe(true)
		}
	})

	test('401 → unauthorized', async () => {
		const { client } = withFetch([() => new Response('', { status: 401 })])
		let caught: unknown
		try {
			await client.createEntry('blog', { slug: 's', frontmatter: {} })
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(CmsClientError)
		if (caught instanceof CmsClientError) expect(caught.isUnauthorized).toBe(true)
	})
})
