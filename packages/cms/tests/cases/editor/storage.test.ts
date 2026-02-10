import { afterEach, beforeEach, expect, test } from 'bun:test'
import { clearEditsFromStorage, loadEditsFromStorage, saveEditsToStorage } from '../../../src/editor/storage'
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
