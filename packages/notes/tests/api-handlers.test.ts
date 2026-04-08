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

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
	const bodyStr = body ? JSON.stringify(body) : ''
	const stream = Readable.from([Buffer.from(bodyStr, 'utf-8')]) as IncomingMessage
	stream.method = method
	stream.url = url
	stream.headers = { origin: 'http://localhost:4321' }
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
		test('creates a comment item', async () => {
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

	describe('POST /update', () => {
		test('patches an existing item', async () => {
			// Create first
			const createReq = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Original',
				author: 'a',
			})
			const createRes = mockRes()
			await handleNotesApiRoute('create', createReq, createRes, ctx)
			const id = createRes._parsed().item.id

			const req = mockReq('POST', '/_nua/notes/update', {
				page: '/test',
				id,
				patch: { body: 'Updated' },
			})
			const res = mockRes()
			await handleNotesApiRoute('update', req, res, ctx)
			expect(res._status).toBe(200)
			expect(res._parsed().item.body).toBe('Updated')
		})

		test('returns 404 for non-existent item', async () => {
			const req = mockReq('POST', '/_nua/notes/update', {
				page: '/test',
				id: 'non-existent',
				patch: { body: 'x' },
			})
			const res = mockRes()
			await handleNotesApiRoute('update', req, res, ctx)
			expect(res._status).toBe(404)
		})
	})

	describe('POST /resolve and /reopen', () => {
		test('resolves and reopens an item', async () => {
			const createReq = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Test',
				author: 'a',
			})
			const createRes = mockRes()
			await handleNotesApiRoute('create', createReq, createRes, ctx)
			const id = createRes._parsed().item.id

			// Resolve
			const resolveReq = mockReq('POST', '/_nua/notes/resolve', { page: '/test', id })
			const resolveRes = mockRes()
			await handleNotesApiRoute('resolve', resolveReq, resolveRes, ctx)
			expect(resolveRes._status).toBe(200)
			expect(resolveRes._parsed().item.status).toBe('resolved')

			// Reopen
			const reopenReq = mockReq('POST', '/_nua/notes/reopen', { page: '/test', id })
			const reopenRes = mockRes()
			await handleNotesApiRoute('reopen', reopenReq, reopenRes, ctx)
			expect(reopenRes._status).toBe(200)
			expect(reopenRes._parsed().item.status).toBe('open')
		})
	})

	describe('POST /delete', () => {
		test('deletes an existing item', async () => {
			const createReq = mockReq('POST', '/_nua/notes/create', {
				page: '/test',
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Delete me',
				author: 'a',
			})
			const createRes = mockRes()
			await handleNotesApiRoute('create', createReq, createRes, ctx)
			const id = createRes._parsed().item.id

			const req = mockReq('POST', '/_nua/notes/delete', { page: '/test', id })
			const res = mockRes()
			await handleNotesApiRoute('delete', req, res, ctx)
			expect(res._status).toBe(200)
			expect(res._parsed().ok).toBe(true)
		})

		test('returns 404 for non-existent item', async () => {
			const req = mockReq('POST', '/_nua/notes/delete', { page: '/test', id: 'nope' })
			const res = mockRes()
			await handleNotesApiRoute('delete', req, res, ctx)
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
