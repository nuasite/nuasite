/**
 * Thin wrapper around `/_nua/notes/*` endpoints.
 *
 * All methods return parsed JSON. Errors throw with the server-provided
 * message so the overlay can surface them in a banner.
 *
 * Every call sends the active role via the `x-nua-role` header. The server
 * uses this to gate destructive routes (apply / delete / resolve / etc.) to
 * agency callers only. The role is read once at module load from the cookie
 * the URL helpers maintain.
 */

import type { NoteItem, NoteRange, NotesPageFile, NoteStatus, NoteType } from '../types'
import { resolveRole } from './url-mode'

const BASE = '/_nua/notes'
const TIMEOUT_MS = 10_000

/**
 * Resolve the current role on every call (cheap — just reads a cookie). This
 * means a new tab that just gained agency mode picks it up immediately
 * without a page reload.
 */
function authHeaders(): Record<string, string> {
	return { 'x-nua-role': resolveRole('nua-agency') }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders() },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const text = await res.text()
	let parsed: any
	try {
		parsed = text ? JSON.parse(text) : {}
	} catch {
		throw new Error(`notes: invalid JSON response from ${path}`)
	}
	if (!res.ok) {
		throw new Error(parsed?.error ?? `notes: ${path} failed (${res.status})`)
	}
	return parsed as T
}

export async function listNotes(page: string): Promise<NotesPageFile> {
	const res = await fetch(`${BASE}/list?page=${encodeURIComponent(page)}`, {
		headers: { Accept: 'application/json', ...authHeaders() },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	if (!res.ok) throw new Error(`notes: list failed (${res.status})`)
	return (await res.json()) as NotesPageFile
}

export interface CreateInput {
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

export async function createNote(input: CreateInput): Promise<NoteItem> {
	const res = await postJson<{ item: NoteItem }>('/create', input)
	return res.item
}

export async function updateNote(
	page: string,
	id: string,
	patch: Partial<Pick<NoteItem, 'body' | 'status' | 'targetSnippet'>> & { range?: NoteRange | null },
): Promise<NoteItem> {
	const res = await postJson<{ item: NoteItem }>('/update', { page, id, patch })
	return res.item
}

export async function setNoteStatus(page: string, id: string, status: NoteStatus): Promise<NoteItem> {
	if (status === 'resolved') {
		const res = await postJson<{ item: NoteItem }>('/resolve', { page, id })
		return res.item
	}
	if (status === 'open') {
		const res = await postJson<{ item: NoteItem }>('/reopen', { page, id })
		return res.item
	}
	return updateNote(page, id, { status })
}

/** Soft delete — server flips status to 'deleted' and returns the updated item. */
export async function deleteNote(page: string, id: string): Promise<NoteItem> {
	const res = await postJson<{ item: NoteItem }>('/delete', { page, id })
	return res.item
}

/** Hard delete — agency only. Removes the item from disk entirely. */
export async function purgeNote(page: string, id: string): Promise<void> {
	await postJson<{ ok: true }>('/purge', { page, id })
}

export interface ApplyResponse {
	item: NoteItem
	file?: string
	before?: string
	after?: string
	error?: string
	reason?: string
}

/**
 * Apply a suggestion. Returns the updated item plus before/after snippets
 * on success, or throws with the server error message. The 409 response
 * (drift) is returned as a normal value because the server already updated
 * the item to `stale` and the overlay should refresh accordingly.
 */
export async function applyNote(page: string, id: string): Promise<ApplyResponse> {
	const res = await fetch(`${BASE}/apply`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders() },
		body: JSON.stringify({ page, id }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const text = await res.text()
	let parsed: any
	try {
		parsed = text ? JSON.parse(text) : {}
	} catch {
		throw new Error(`notes: invalid JSON response from /apply`)
	}
	if (res.status === 409) {
		// Drift — server already marked as stale
		return parsed as ApplyResponse
	}
	if (!res.ok) {
		throw new Error(parsed?.error ?? `notes: /apply failed (${res.status})`)
	}
	return parsed as ApplyResponse
}
