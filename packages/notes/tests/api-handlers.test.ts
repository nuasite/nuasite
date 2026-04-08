import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { handleNotesApiRoute, type NotesApiContext } from '../src/dev/api-handlers'
import { NotesJsonStore } from '../src/storage/json-store'

let tempDir: string
let store: NotesJsonStore
let ctx: NotesApiContext

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-api-'))
	store = new NotesJsonStore({ projectRoot: tempDir, notesDir: 'data/notes' })
	ctx = { store, projectRoot: tempDir }
})

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

function mockReq(method: string, url: string, body?: unknown, role?: 'agency' | 'client'): IncomingMessage {
	const bodyStr = body ? JSON.stringify(body) : ''
	const stream = Readable.from([Buffer.from(bodyStr, 'utf-8')]) as IncomingMessage
	stream.method = method
	stream.url = url
	stream.headers = { origin: 'http://localhost:4321' }
	if (role) stream.headers['x-nua-role'] = role
	return stream
}

function mockRes(): ServerResponse & { _status: number; _body: string; _parsed: () => any } {
	let status = 200
	let body = ''
	const res = {
		headersSent: false,
		writeHead(s: number, _headers?: Record<string, string>) {
			status = s
			return res
		},
		end(data?: string) {
			body = data ?? ''
			res.headersSent = true
		},
		get _status() {
			return status
		},
		get _body() {
			return body
		},
		_parsed() {
			return JSON.parse(body)
		},
	}
	return res as any
}

/** Convenience: create an item via API and return its id. Defaults to client role. */
async function createItem(opts: { page?: string; type?: 'comment' | 'suggestion'; range?: any; body?: string } = {}): Promise<string> {
	const payload: any = {
		page: opts.page ?? '/test',
		type: opts.type ?? 'comment',
		targetCmsId: 'cms-0',
		body: opts.body ?? 'A note',
		author: 'reviewer',
	}
	if (opts.type === 'suggestion') {
		payload.range = opts.range ?? { anchorText: 'foo', originalText: 'foo', suggestedText: 'bar' }
	}
	const req = mockReq('POST', '/_nua/notes/create', payload)
	const res = mockRes()
	await handleNotesApiRoute('create', req, res, ctx)
	return res._parsed().item.id
}

describe('handleNotesApiRoute', () => {
	describe('GET /list', () => {
		test('returns empty page for new page', async () => {
			const req = mockReq('GET', '/_nua/notes/list?page=/about')
			const res = mockRes()
			await handleNotesApiRoute('list', req, res, ctx)
			expect(res._status).toBe(200)
			expect(res._parsed().items).toEqual([])
		})

		test('returns 400 when page param is missing', async () => {
			const req = mockReq('GET', '/_nua/notes/list')
			const res = mockRes()
			await handleNotesApiRoute('list', req, res, ctx)
			expect(res._status).toBe(400)
		})
	})

	describe('POST /create', () => {
		test('creates a comment item (client role allowed)', async () => {
			const req = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Nice work',
				author: 'reviewer',
			})
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._status).toBe(201)
			const data = res._parsed()
			expect(data.item.type).toBe('comment')
			expect(data.item.body).toBe('Nice work')
			// Every created item should have a history entry
			expect(data.item.history).toHaveLength(1)
			expect(data.item.history[0].action).toBe('created')
			expect(data.item.history[0].role).toBe('client')
		})

		test('records agency role on history when header is set', async () => {
			const req = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'From agency',
				author: 'a',
			}, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._parsed().item.history[0].role).toBe('agency')
		})

		test('rejects comment with empty body', async () => {
			const req = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'comment',
				targetCmsId: 'cms-0',
				body: '',
				author: 'reviewer',
			})
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._status).toBe(400)
		})

		test('creates a suggestion item', async () => {
			const req = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'suggestion',
				targetCmsId: 'cms-0',
				body: '',
				author: 'reviewer',
				range: { anchorText: 'foo', originalText: 'foo', suggestedText: 'bar' },
			})
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._status).toBe(201)
			expect(res._parsed().item.range.suggestedText).toBe('bar')
		})

		test('rejects suggestion without range', async () => {
			const req = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'suggestion',
				targetCmsId: 'cms-0',
				body: '',
				author: 'reviewer',
			})
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._status).toBe(400)
		})

		test('rejects missing required fields', async () => {
			const req = mockReq('POST', '/_nua/notes/create', { page: '/test' })
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._status).toBe(400)
		})

		test('rejects invalid type', async () => {
			const req = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'invalid',
				targetCmsId: 'cms-0',
				body: 'x',
				author: 'a',
			})
			const res = mockRes()
			await handleNotesApiRoute('create', req, res, ctx)
			expect(res._status).toBe(400)
		})
	})

	describe('agency role gating', () => {
		test('client cannot update', async () => {
			const id = await createItem()
			const req = mockReq('POST', '/_nua/notes/update', { page: '/test', id, patch: { body: 'x' } })
			const res = mockRes()
			await handleNotesApiRoute('update', req, res, ctx)
			expect(res._status).toBe(403)
		})

		test('client cannot resolve', async () => {
			const id = await createItem()
			const req = mockReq('POST', '/_nua/notes/resolve', { page: '/test', id })
			const res = mockRes()
			await handleNotesApiRoute('resolve', req, res, ctx)
			expect(res._status).toBe(403)
		})

		test('client cannot delete', async () => {
			const id = await createItem()
			const req = mockReq('POST', '/_nua/notes/delete', { page: '/test', id })
			const res = mockRes()
			await handleNotesApiRoute('delete', req, res, ctx)
			expect(res._status).toBe(403)
		})

		test('client cannot purge', async () => {
			const id = await createItem()
			const req = mockReq('POST', '/_nua/notes/purge', { page: '/test', id })
			const res = mockRes()
			await handleNotesApiRoute('purge', req, res, ctx)
			expect(res._status).toBe(403)
		})

		test('client cannot apply', async () => {
			const id = await createItem({ type: 'suggestion' })
			const req = mockReq('POST', '/_nua/notes/apply', { page: '/test', id })
			const res = mockRes()
			await handleNotesApiRoute('apply', req, res, ctx)
			expect(res._status).toBe(403)
		})
	})

	describe('POST /update (agency)', () => {
		test('patches an existing item and appends history', async () => {
			const id = await createItem()
			const req = mockReq('POST', '/_nua/notes/update', {
				page: '/test',
				id,
				patch: { body: 'Updated' },
			}, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('update', req, res, ctx)
			expect(res._status).toBe(200)
			const item = res._parsed().item
			expect(item.body).toBe('Updated')
			expect(item.history).toHaveLength(2)
			expect(item.history[1].action).toBe('updated')
			expect(item.history[1].role).toBe('agency')
		})

		test('returns 404 for non-existent item', async () => {
			const req = mockReq('POST', '/_nua/notes/update', {
				page: '/test',
				id: 'non-existent',
				patch: { body: 'x' },
			}, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('update', req, res, ctx)
			expect(res._status).toBe(404)
		})
	})

	describe('POST /resolve and /reopen (agency)', () => {
		test('resolves and reopens an item with proper history actions', async () => {
			const id = await createItem()

			const resolveReq = mockReq('POST', '/_nua/notes/resolve', { page: '/test', id }, 'agency')
			const resolveRes = mockRes()
			await handleNotesApiRoute('resolve', resolveReq, resolveRes, ctx)
			expect(resolveRes._status).toBe(200)
			const resolved = resolveRes._parsed().item
			expect(resolved.status).toBe('resolved')
			expect(resolved.history.at(-1).action).toBe('resolved')

			const reopenReq = mockReq('POST', '/_nua/notes/reopen', { page: '/test', id }, 'agency')
			const reopenRes = mockRes()
			await handleNotesApiRoute('reopen', reopenReq, reopenRes, ctx)
			expect(reopenRes._status).toBe(200)
			const reopened = reopenRes._parsed().item
			expect(reopened.status).toBe('open')
			expect(reopened.history.at(-1).action).toBe('reopened')
		})
	})

	describe('POST /delete (agency, soft)', () => {
		test('flips status to deleted but keeps the item on disk', async () => {
			const id = await createItem()

			const req = mockReq('POST', '/_nua/notes/delete', { page: '/test', id }, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('delete', req, res, ctx)
			expect(res._status).toBe(200)
			const item = res._parsed().item
			expect(item.status).toBe('deleted')
			expect(item.history.at(-1).action).toBe('deleted')

			// Item is still on disk, not removed
			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(1)
			expect(page.items[0]!.status).toBe('deleted')
		})

		test('returns 404 for non-existent item', async () => {
			const req = mockReq('POST', '/_nua/notes/delete', { page: '/test', id: 'nope' }, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('delete', req, res, ctx)
			expect(res._status).toBe(404)
		})
	})

	describe('POST /purge (agency, hard)', () => {
		test('hard-removes the item from disk', async () => {
			const id = await createItem()

			const req = mockReq('POST', '/_nua/notes/purge', { page: '/test', id }, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('purge', req, res, ctx)
			expect(res._status).toBe(200)
			expect(res._parsed().ok).toBe(true)

			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(0)
		})

		test('returns 404 for non-existent item', async () => {
			const req = mockReq('POST', '/_nua/notes/purge', { page: '/test', id: 'nope' }, 'agency')
			const res = mockRes()
			await handleNotesApiRoute('purge', req, res, ctx)
			expect(res._status).toBe(404)
		})
	})

	describe('unknown route', () => {
		test('returns 404', async () => {
			const req = mockReq('GET', '/_nua/notes/unknown')
			const res = mockRes()
			await handleNotesApiRoute('unknown', req, res, ctx)
			expect(res._status).toBe(404)
		})
	})
})
