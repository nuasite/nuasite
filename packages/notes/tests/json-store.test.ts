import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NotesJsonStore } from '../src/storage/json-store'

let tempDir: string
let store: NotesJsonStore

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-test-'))
	store = new NotesJsonStore({ projectRoot: tempDir, notesDir: 'data/notes' })
})

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

describe('NotesJsonStore', () => {
	describe('readPage', () => {
		test('returns empty page for non-existent file', async () => {
			const page = await store.readPage('/about')
			expect(page.page).toBe('/about')
			expect(page.items).toEqual([])
			expect(page.lastUpdated).toBeTruthy()
		})

		test('normalizes page path', async () => {
			const page = await store.readPage('about/')
			expect(page.page).toBe('/about')
		})

		test('migrates legacy items missing the history field', async () => {
			// Write a file by hand without the history field, simulating an
			// older version of the store. readPage should default it to [].
			const dir = path.join(tempDir, 'data', 'notes', 'pages')
			await fs.mkdir(dir, { recursive: true })
			const legacy = {
				page: '/legacy',
				lastUpdated: '2025-01-01T00:00:00Z',
				items: [
					{
						id: 'n-old-1',
						type: 'comment',
						targetCmsId: 'cms-0',
						range: null,
						body: 'old',
						author: 'a',
						createdAt: '2025-01-01T00:00:00Z',
						status: 'open',
						replies: [],
						// no history
					},
				],
			}
			await fs.writeFile(path.join(dir, 'legacy.json'), '// @nuasite/notes v1\n' + JSON.stringify(legacy), 'utf-8')
			const page = await store.readPage('/legacy')
			expect(page.items).toHaveLength(1)
			expect(page.items[0]!.history).toEqual([])
		})
	})

	describe('addItem', () => {
		test('creates item with generated id, timestamp, and history entry', async () => {
			const item = await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Hello',
				author: 'tester',
				range: null,
			})
			expect(item.id).toMatch(/^n-/)
			expect(item.type).toBe('comment')
			expect(item.body).toBe('Hello')
			expect(item.status).toBe('open')
			expect(item.replies).toEqual([])
			expect(item.history).toHaveLength(1)
			expect(item.history[0]!.action).toBe('created')
			expect(item.history[0]!.role).toBe('client')
		})

		test('records agency role when caller is agency', async () => {
			const item = await store.addItem(
				'/test',
				{ type: 'comment', targetCmsId: 'cms-0', body: 'x', author: 'a', range: null },
				'agency',
			)
			expect(item.history[0]!.role).toBe('agency')
		})

		test('persists item to disk', async () => {
			await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Persisted',
				author: 'tester',
				range: null,
			})
			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(1)
			expect(page.items[0]!.body).toBe('Persisted')
		})

		test('appends multiple items to same page', async () => {
			await store.addItem('/test', { type: 'comment', targetCmsId: 'cms-0', body: 'First', author: 'a', range: null })
			await store.addItem('/test', { type: 'comment', targetCmsId: 'cms-1', body: 'Second', author: 'b', range: null })
			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(2)
		})

		test('creates suggestion with range', async () => {
			const item = await store.addItem('/test', {
				type: 'suggestion',
				targetCmsId: 'cms-0',
				body: '',
				author: 'reviewer',
				range: { anchorText: 'hello', originalText: 'hello', suggestedText: 'world' },
			})
			expect(item.type).toBe('suggestion')
			expect(item.range).toEqual({ anchorText: 'hello', originalText: 'hello', suggestedText: 'world' })
		})
	})

	describe('updateItem', () => {
		test('patches existing item fields and appends history', async () => {
			const item = await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Original',
				author: 'tester',
				range: null,
			})
			const updated = await store.updateItem('/test', item.id, { body: 'Updated' }, 'agency')
			expect(updated).not.toBeNull()
			expect(updated!.body).toBe('Updated')
			expect(updated!.updatedAt).toBeTruthy()
			expect(updated!.history).toHaveLength(2)
			expect(updated!.history[1]!.action).toBe('updated')
			expect(updated!.history[1]!.role).toBe('agency')
		})

		test('returns null for non-existent item', async () => {
			const result = await store.updateItem('/test', 'non-existent', { body: 'nope' })
			expect(result).toBeNull()
		})

		test('uses custom history action when provided', async () => {
			const item = await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'x',
				author: 'a',
				range: null,
			})
			const updated = await store.updateItem('/test', item.id, { status: 'resolved' }, 'agency', 'resolved')
			expect(updated!.history[1]!.action).toBe('resolved')
		})

		test('preserves range: null as meaningful patch', async () => {
			const item = await store.addItem('/test', {
				type: 'suggestion',
				targetCmsId: 'cms-0',
				body: '',
				author: 'tester',
				range: { anchorText: 'a', originalText: 'a', suggestedText: 'b' },
			})
			const updated = await store.updateItem('/test', item.id, { range: null }, 'agency')
			expect(updated!.range).toBeNull()
		})
	})

	describe('deleteItem (soft delete)', () => {
		test('flips status to deleted and keeps the item on disk', async () => {
			const item = await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Delete me',
				author: 'tester',
				range: null,
			})
			const deleted = await store.deleteItem('/test', item.id, 'agency')
			expect(deleted).not.toBeNull()
			expect(deleted!.status).toBe('deleted')
			expect(deleted!.history.at(-1)!.action).toBe('deleted')
			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(1)
			expect(page.items[0]!.status).toBe('deleted')
		})

		test('returns null for non-existent item', async () => {
			const result = await store.deleteItem('/test', 'non-existent', 'agency')
			expect(result).toBeNull()
		})
	})

	describe('purgeItem (hard delete)', () => {
		test('removes the item entirely from disk', async () => {
			const item = await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'Purge me',
				author: 'tester',
				range: null,
			})
			const ok = await store.purgeItem('/test', item.id)
			expect(ok).toBe(true)
			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(0)
		})

		test('returns false for non-existent item', async () => {
			const ok = await store.purgeItem('/test', 'non-existent')
			expect(ok).toBe(false)
		})

		test('can purge an already-soft-deleted item', async () => {
			const item = await store.addItem('/test', {
				type: 'comment',
				targetCmsId: 'cms-0',
				body: 'x',
				author: 'a',
				range: null,
			})
			await store.deleteItem('/test', item.id, 'agency')
			const ok = await store.purgeItem('/test', item.id)
			expect(ok).toBe(true)
			const page = await store.readPage('/test')
			expect(page.items).toHaveLength(0)
		})
	})

	describe('listAllPages', () => {
		test('returns empty array when no pages exist', async () => {
			const pages = await store.listAllPages()
			expect(pages).toEqual([])
		})

		test('returns all pages with items', async () => {
			await store.addItem('/page-a', { type: 'comment', targetCmsId: 'cms-0', body: 'A', author: 'a', range: null })
			await store.addItem('/page-b', { type: 'comment', targetCmsId: 'cms-1', body: 'B', author: 'b', range: null })
			const pages = await store.listAllPages()
			expect(pages).toHaveLength(2)
		})
	})

	describe('concurrency', () => {
		test('concurrent writes to same page do not clobber', async () => {
			const writes = Array.from({ length: 10 }, (_, i) =>
				store.addItem('/concurrent', {
					type: 'comment',
					targetCmsId: `cms-${i}`,
					body: `Item ${i}`,
					author: 'tester',
					range: null,
				}))
			await Promise.all(writes)
			const page = await store.readPage('/concurrent')
			expect(page.items).toHaveLength(10)
		})

		test('concurrent writes to different pages run independently', async () => {
			const writes = Array.from({ length: 5 }, (_, i) =>
				store.addItem(`/page-${i}`, {
					type: 'comment',
					targetCmsId: 'cms-0',
					body: `Page ${i}`,
					author: 'tester',
					range: null,
				}))
			await Promise.all(writes)
			for (let i = 0; i < 5; i++) {
				const page = await store.readPage(`/page-${i}`)
				expect(page.items).toHaveLength(1)
			}
		})
	})
})
