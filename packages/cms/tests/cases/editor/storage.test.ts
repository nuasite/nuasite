import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	clearEditsFromStorage,
	clearMarkdownDraft,
	hasAnyMarkdownDraft,
	loadEditsFromStorage,
	loadMarkdownDraft,
	saveEditsToStorage,
	saveMarkdownDraft,
} from '../../../src/editor/storage'
import type { PendingChange } from '../../../src/editor/types'

beforeEach(() => {
	sessionStorage.clear()
})

afterEach(() => {
	sessionStorage.clear()
})

test('saveEditsToStorage saves dirty changes', () => {
	const pendingChanges = new Map<string, PendingChange>()

	const mockElement = document.createElement('div')
	mockElement.innerHTML = 'Test content'

	pendingChanges.set('test-id', {
		element: mockElement,
		originalHTML: 'Original',
		originalText: 'Original',
		newText: 'Modified',
		currentHTML: 'Test content',
		isDirty: true,
	})

	saveEditsToStorage(pendingChanges)

	const stored = sessionStorage.getItem('cms-pending-edits')
	expect(stored).not.toBeNull()

	const parsed = JSON.parse(stored!)
	expect(parsed['test-id']).toBeDefined()
	expect(parsed['test-id'].newText).toBe('Modified')
	expect(parsed['test-id'].originalText).toBe('Original')
})

test('saveEditsToStorage does not save clean changes', () => {
	const pendingChanges = new Map<string, PendingChange>()

	const mockElement = document.createElement('div')
	mockElement.innerHTML = 'Test content'

	pendingChanges.set('test-id', {
		element: mockElement,
		originalHTML: 'Original',
		originalText: 'Original',
		newText: 'Original',
		currentHTML: 'Original',
		isDirty: false,
	})

	saveEditsToStorage(pendingChanges)

	const stored = sessionStorage.getItem('cms-pending-edits')
	expect(stored).not.toBeNull()

	const parsed = JSON.parse(stored!)
	expect(parsed['test-id']).toBeUndefined()
})

test('loadEditsFromStorage returns saved edits', () => {
	const edits = {
		'test-id': {
			originalText: 'Original',
			newText: 'Modified',
			currentHTML: 'Test content',
		},
	}

	sessionStorage.setItem('cms-pending-edits', JSON.stringify(edits))

	const loaded = loadEditsFromStorage()
	expect(loaded['test-id']).toBeDefined()
	expect(loaded['test-id']?.newText).toBe('Modified')
})

test('loadEditsFromStorage returns empty object when no data', () => {
	const loaded = loadEditsFromStorage()
	expect(loaded).toEqual({})
})

test('loadEditsFromStorage handles invalid JSON gracefully', () => {
	sessionStorage.setItem('cms-pending-edits', 'invalid json')

	const loaded = loadEditsFromStorage()
	expect(loaded).toEqual({})
})

test('clearEditsFromStorage removes stored data', () => {
	sessionStorage.setItem('cms-pending-edits', JSON.stringify({ test: 'data' }))

	clearEditsFromStorage()

	const stored = sessionStorage.getItem('cms-pending-edits')
	expect(stored).toBeNull()
})

test('saveEditsToStorage handles multiple changes', () => {
	const pendingChanges = new Map<string, PendingChange>()

	const mockElement1 = document.createElement('div')
	mockElement1.innerHTML = 'Content 1'

	const mockElement2 = document.createElement('div')
	mockElement2.innerHTML = 'Content 2'

	pendingChanges.set('id-1', {
		element: mockElement1,
		originalHTML: 'Original 1',
		originalText: 'Original 1',
		newText: 'Modified 1',
		currentHTML: 'Content 1',
		isDirty: true,
	})

	pendingChanges.set('id-2', {
		element: mockElement2,
		originalHTML: 'Original 2',
		originalText: 'Original 2',
		newText: 'Modified 2',
		currentHTML: 'Content 2',
		isDirty: true,
	})

	saveEditsToStorage(pendingChanges)

	const loaded = loadEditsFromStorage()
	expect(Object.keys(loaded).length).toBe(2)
	expect(loaded['id-1']?.newText).toBe('Modified 1')
	expect(loaded['id-2']?.newText).toBe('Modified 2')
})

describe('markdown drafts', () => {
	const filePath = '/content/blog/test-post.md'

	test('saveMarkdownDraft + loadMarkdownDraft round-trip', () => {
		saveMarkdownDraft(filePath, { title: 'Hello', date: '2026-05-11' }, 'Body content')

		const loaded = loadMarkdownDraft(filePath)
		expect(loaded).not.toBeNull()
		expect(loaded?.content).toBe('Body content')
		expect(loaded?.frontmatter).toEqual({ title: 'Hello', date: '2026-05-11' })
		expect(typeof loaded?.savedAt).toBe('number')
	})

	test('loadMarkdownDraft returns null when no draft exists', () => {
		expect(loadMarkdownDraft(filePath)).toBeNull()
	})

	test('clearMarkdownDraft removes the draft', () => {
		saveMarkdownDraft(filePath, { title: 'X' }, 'body')
		expect(loadMarkdownDraft(filePath)).not.toBeNull()

		clearMarkdownDraft(filePath)
		expect(loadMarkdownDraft(filePath)).toBeNull()
	})

	test('drafts are keyed per filePath', () => {
		saveMarkdownDraft('/content/blog/a.md', { title: 'A' }, 'body a')
		saveMarkdownDraft('/content/blog/b.md', { title: 'B' }, 'body b')

		expect(loadMarkdownDraft('/content/blog/a.md')?.content).toBe('body a')
		expect(loadMarkdownDraft('/content/blog/b.md')?.content).toBe('body b')

		clearMarkdownDraft('/content/blog/a.md')
		expect(loadMarkdownDraft('/content/blog/a.md')).toBeNull()
		expect(loadMarkdownDraft('/content/blog/b.md')?.content).toBe('body b')
	})

	test('helpers no-op on empty filePath', () => {
		// Doesn't throw and doesn't write a key
		saveMarkdownDraft('', { title: 'X' }, 'body')
		expect(loadMarkdownDraft('')).toBeNull()
		clearMarkdownDraft('')
	})

	test('loadMarkdownDraft handles invalid JSON gracefully', () => {
		sessionStorage.setItem('cms-markdown-draft:/x.md', 'not json')
		expect(loadMarkdownDraft('/x.md')).toBeNull()
	})

	test('hasAnyMarkdownDraft reflects presence of any draft key', () => {
		expect(hasAnyMarkdownDraft()).toBe(false)

		saveMarkdownDraft('/content/blog/x.md', { title: 'X' }, 'body')
		expect(hasAnyMarkdownDraft()).toBe(true)

		clearMarkdownDraft('/content/blog/x.md')
		expect(hasAnyMarkdownDraft()).toBe(false)
	})

	test('hasAnyMarkdownDraft ignores unrelated sessionStorage keys', () => {
		sessionStorage.setItem('cms-pending-edits', '{}')
		sessionStorage.setItem('cms-settings', '{}')
		expect(hasAnyMarkdownDraft()).toBe(false)
	})
})
