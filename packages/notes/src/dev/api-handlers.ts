/**
 * Dev API route handlers for `/_nua/notes/*`.
 *
 * All handlers operate on a single `NotesJsonStore` and follow the same
 * shape as `@nuasite/cms`'s api-routes: parse query/body, mutate, send JSON.
 *
 * Routes (all mounted under `/_nua/notes/`):
 *
 *   GET    /list?page=/<page>      → list items for one page
 *   GET    /inbox                   → list items across all pages (Phase 5 use)
 *   POST   /create                  → create a comment or suggestion
 *   POST   /update                  → patch an existing item
 *   POST   /resolve                 → mark item as resolved
 *   POST   /reopen                  → reopen a resolved item
 *   POST   /delete                  → delete an item
 *   POST   /apply                   → write a suggestion's replacement back to source
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { applySuggestion } from '../apply/apply-suggestion'
import type { NotesJsonStore } from '../storage/json-store'
import type { NoteItem, NoteItemPatch, NoteRange, NoteStatus, NoteType } from '../storage/types'
import { parseJsonBody, sendError, sendJson } from './request-utils'

export interface NotesApiContext {
	store: NotesJsonStore
	projectRoot: string
}

interface CreateBody {
	page: string
	type: NoteType
	targetCmsId: string
	targetSourcePath?: string
	targetSourceLine?: number
	targetSnippet?: string
	range?: NoteRange | null
	body: string
	author: string
}

interface UpdateBody {
	page: string
	id: string
	patch: NoteItemPatch
}

interface IdBody {
	page: string
	id: string
}

function getQuery(url: string): URLSearchParams {
	const q = url.indexOf('?')
	return new URLSearchParams(q >= 0 ? url.slice(q + 1) : '')
}

export async function handleNotesApiRoute(
	route: string,
	req: IncomingMessage,
	res: ServerResponse,
	ctx: NotesApiContext,
): Promise<void> {
	const { store } = ctx
	const method = req.method ?? 'GET'

	// GET /list?page=/some-page
	if (method === 'GET' && route === 'list') {
		const params = getQuery(req.url ?? '')
		const page = params.get('page')
		if (!page) {
			sendError(res, 'Missing required query param: page', 400, req)
			return
		}
		const file = await store.readPage(page)
		sendJson(res, file, 200, req)
		return
	}

	// GET /inbox — all items across all pages
	if (method === 'GET' && route === 'inbox') {
		const pages = await store.listAllPages()
		sendJson(res, { pages }, 200, req)
		return
	}

	// POST /create
	if (method === 'POST' && route === 'create') {
		const body = await parseJsonBody<CreateBody>(req)
		if (!body.page || !body.type || !body.targetCmsId || !body.author) {
			sendError(res, 'Missing required fields: page, type, targetCmsId, author', 400, req)
			return
		}
		if (body.type !== 'comment' && body.type !== 'suggestion') {
			sendError(res, `Invalid type: ${body.type}`, 400, req)
			return
		}
		if (body.type === 'suggestion' && !body.range) {
			sendError(res, 'Suggestion items require a range payload', 400, req)
			return
		}
		// Comments must have a body; suggestions may have an empty body since
		// the diff itself communicates the change.
		if (body.type === 'comment' && !body.body?.trim()) {
			sendError(res, 'Comment items require a non-empty body', 400, req)
			return
		}
		const item = await store.addItem(body.page, {
			type: body.type,
			targetCmsId: body.targetCmsId,
			targetSourcePath: body.targetSourcePath,
			targetSourceLine: body.targetSourceLine,
			targetSnippet: body.targetSnippet,
			range: body.range ?? null,
			body: body.body ?? '',
			author: body.author,
		})
		sendJson(res, { item }, 201, req)
		return
	}

	// POST /update
	if (method === 'POST' && route === 'update') {
		const body = await parseJsonBody<UpdateBody>(req)
		if (!body.page || !body.id || !body.patch) {
			sendError(res, 'Missing required fields: page, id, patch', 400, req)
			return
		}
		const updated = await store.updateItem(body.page, body.id, body.patch)
		if (!updated) {
			sendError(res, `Item not found: ${body.id}`, 404, req)
			return
		}
		sendJson(res, { item: updated }, 200, req)
		return
	}

	// POST /resolve and POST /reopen — convenience wrappers around update
	if (method === 'POST' && (route === 'resolve' || route === 'reopen')) {
		const body = await parseJsonBody<IdBody>(req)
		if (!body.page || !body.id) {
			sendError(res, 'Missing required fields: page, id', 400, req)
			return
		}
		const status: NoteStatus = route === 'resolve' ? 'resolved' : 'open'
		const updated = await store.updateItem(body.page, body.id, { status })
		if (!updated) {
			sendError(res, `Item not found: ${body.id}`, 404, req)
			return
		}
		sendJson(res, { item: updated }, 200, req)
		return
	}

	// POST /delete
	if (method === 'POST' && route === 'delete') {
		const body = await parseJsonBody<IdBody>(req)
		if (!body.page || !body.id) {
			sendError(res, 'Missing required fields: page, id', 400, req)
			return
		}
		const ok = await store.deleteItem(body.page, body.id)
		if (!ok) {
			sendError(res, `Item not found: ${body.id}`, 404, req)
			return
		}
		sendJson(res, { ok: true }, 200, req)
		return
	}

	// POST /apply — write the suggestion's replacement back to the source file
	if (method === 'POST' && route === 'apply') {
		const body = await parseJsonBody<IdBody>(req)
		if (!body.page || !body.id) {
			sendError(res, 'Missing required fields: page, id', 400, req)
			return
		}
		const file = await store.readPage(body.page)
		const item = file.items.find(it => it.id === body.id)
		if (!item) {
			sendError(res, `Item not found: ${body.id}`, 404, req)
			return
		}
		if (item.type !== 'suggestion' || !item.range) {
			sendError(res, 'Only suggestion items can be applied', 400, req)
			return
		}

		const result = await applySuggestion(item, { projectRoot: ctx.projectRoot })

		if (!result.ok) {
			// Drift detected — mark the item as stale so the sidebar can warn
			// the agency without losing the suggestion.
			if (result.reason === 'not-found' || result.reason === 'ambiguous') {
				const updated = await store.updateItem(body.page, body.id, { status: 'stale' })
				sendJson(res, { item: updated, error: result.message, reason: result.reason }, 409, req)
				return
			}
			sendError(res, result.message, 400, req)
			return
		}

		// Successful write — flip the item to `applied`. The middleware will
		// fire a Vite full-reload after this returns; CMS's own watcher also
		// notices the source-file change and triggers HMR.
		const updated = await store.updateItem(body.page, body.id, { status: 'applied' })
		sendJson(res, { item: updated, file: result.file, before: result.before, after: result.after }, 200, req)
		return
	}

	sendError(res, `Unknown notes route: ${method} ${route}`, 404, req)
}

// Re-export for tests / external use
export type { NoteItem }
