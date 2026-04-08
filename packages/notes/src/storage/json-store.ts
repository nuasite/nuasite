/**
 * JSON file store for `@nuasite/notes`.
 *
 * One file per page lives at `<notesDir>/pages/<slug>.json`. Reads tolerate a
 * missing file (returns an empty page). Writes are atomic (write to a `.tmp`
 * file, then rename) and serialized per slug via an in-memory mutex so
 * concurrent POSTs don't clobber each other.
 *
 * The store is intentionally simple — no caching, no in-memory index, no
 * background flush. Each request reads the file from disk, mutates, writes
 * back. This is fine for the local-dev usage profile and matches how
 * `@nuasite/cms` writes back to source files.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { generateNoteId } from './id-gen'
import { normalizePagePath, pageToSlug } from './slug'
import type { NoteItem, NoteItemPatch, NotesPageFile } from './types'

const FILE_VERSION_HEADER = '// @nuasite/notes v1\n'

function nowIso(): string {
	return new Date().toISOString()
}

/**
 * Per-slug write mutex. Concurrent POSTs to the same page are serialized;
 * different pages can write in parallel. Cleared after each lock release.
 */
const locks = new Map<string, Promise<unknown>>()

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = locks.get(key) ?? Promise.resolve()
	let release!: () => void
	const next = new Promise<void>((resolve) => {
		release = resolve
	})
	locks.set(key, prev.then(() => next))
	try {
		await prev
		return await fn()
	} finally {
		release()
		// If we're the tail of the chain, clean up so the map doesn't grow unbounded
		if (locks.get(key) === prev.then(() => next)) {
			locks.delete(key)
		}
	}
}

export interface JsonStoreOptions {
	/** Absolute path to the project root. Required so the store can resolve `notesDir`. */
	projectRoot: string
	/** Project-relative directory where note JSON files live. */
	notesDir: string
}

export class NotesJsonStore {
	private readonly pagesDir: string

	constructor(private readonly options: JsonStoreOptions) {
		this.pagesDir = path.resolve(options.projectRoot, options.notesDir, 'pages')
	}

	/** Resolve the absolute path of the JSON file for a given page. */
	private fileFor(page: string): string {
		return path.join(this.pagesDir, `${pageToSlug(page)}.json`)
	}

	/** Read a page's notes file from disk, or return an empty page if missing. */
	async readPage(page: string): Promise<NotesPageFile> {
		const normalized = normalizePagePath(page)
		const filePath = this.fileFor(normalized)
		try {
			const raw = await fs.readFile(filePath, 'utf-8')
			// Tolerate the optional version header
			const stripped = raw.startsWith('//') ? raw.slice(raw.indexOf('\n') + 1) : raw
			const parsed = JSON.parse(stripped) as NotesPageFile
			// Normalize legacy / partial files
			return {
				page: parsed.page ?? normalized,
				lastUpdated: parsed.lastUpdated ?? nowIso(),
				items: Array.isArray(parsed.items) ? parsed.items : [],
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return { page: normalized, lastUpdated: nowIso(), items: [] }
			}
			throw err
		}
	}

	/** Write a page's notes file to disk atomically. Creates parents as needed. */
	private async writePageFile(page: string, file: NotesPageFile): Promise<void> {
		const filePath = this.fileFor(page)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		const body = FILE_VERSION_HEADER + JSON.stringify(file, null, '\t') + '\n'
		const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
		await fs.writeFile(tmp, body, 'utf-8')
		await fs.rename(tmp, filePath)
	}

	/** Add a new item. Generates the id, createdAt, and defaults status to "open". */
	async addItem(
		page: string,
		input: Omit<NoteItem, 'id' | 'createdAt' | 'status' | 'replies'> & {
			id?: string
			createdAt?: string
			status?: NoteItem['status']
			replies?: NoteItem['replies']
		},
	): Promise<NoteItem> {
		const normalized = normalizePagePath(page)
		return withLock(normalized, async () => {
			const file = await this.readPage(normalized)
			const item: NoteItem = {
				id: input.id ?? generateNoteId(),
				type: input.type,
				targetCmsId: input.targetCmsId,
				targetSourcePath: input.targetSourcePath,
				targetSourceLine: input.targetSourceLine,
				targetSnippet: input.targetSnippet,
				range: input.range ?? null,
				body: input.body,
				author: input.author,
				createdAt: input.createdAt ?? nowIso(),
				status: input.status ?? 'open',
				replies: input.replies ?? [],
			}
			file.items.push(item)
			file.page = normalized
			file.lastUpdated = nowIso()
			await this.writePageFile(normalized, file)
			return item
		})
	}

	/** Patch an existing item. Returns the updated item, or null if not found. */
	async updateItem(page: string, id: string, patch: NoteItemPatch): Promise<NoteItem | null> {
		const normalized = normalizePagePath(page)
		return withLock(normalized, async () => {
			const file = await this.readPage(normalized)
			const idx = file.items.findIndex(it => it.id === id)
			if (idx === -1) return null
			const existing = file.items[idx]!
			const updated: NoteItem = {
				...existing,
				...patch,
				// `range: null` is a meaningful patch (clearing a range), preserve it
				range: 'range' in patch ? (patch.range ?? null) : existing.range,
				updatedAt: nowIso(),
			}
			file.items[idx] = updated
			file.lastUpdated = nowIso()
			await this.writePageFile(normalized, file)
			return updated
		})
	}

	/** Delete an item by id. Returns true if it existed. */
	async deleteItem(page: string, id: string): Promise<boolean> {
		const normalized = normalizePagePath(page)
		return withLock(normalized, async () => {
			const file = await this.readPage(normalized)
			const idx = file.items.findIndex(it => it.id === id)
			if (idx === -1) return false
			file.items.splice(idx, 1)
			file.lastUpdated = nowIso()
			await this.writePageFile(normalized, file)
			return true
		})
	}

	/** List all pages that have at least one note item. Used by the agency inbox (Phase 5). */
	async listAllPages(): Promise<NotesPageFile[]> {
		try {
			const files = await fs.readdir(this.pagesDir)
			const pages: NotesPageFile[] = []
			for (const f of files) {
				if (!f.endsWith('.json')) continue
				try {
					const raw = await fs.readFile(path.join(this.pagesDir, f), 'utf-8')
					const stripped = raw.startsWith('//') ? raw.slice(raw.indexOf('\n') + 1) : raw
					pages.push(JSON.parse(stripped) as NotesPageFile)
				} catch {
					// skip malformed files
				}
			}
			return pages
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
			throw err
		}
	}
}
