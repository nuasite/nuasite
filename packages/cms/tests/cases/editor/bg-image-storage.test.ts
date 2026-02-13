import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
	clearAllEditsFromStorage,
	clearBgImageEditsFromStorage,
	loadBgImageEditsFromStorage,
	saveBgImageEditsToStorage,
} from '../../../src/editor/storage'
import type { PendingBackgroundImageChange } from '../../../src/editor/types'

beforeEach(() => {
	sessionStorage.clear()
})

afterEach(() => {
	sessionStorage.clear()
})

test('saveBgImageEditsToStorage saves dirty changes', () => {
	const pendingChanges = new Map<string, PendingBackgroundImageChange>()

	const mockElement = document.createElement('div')

	pendingChanges.set('test-id', {
		element: mockElement,
		cmsId: 'test-id',
		originalBgImageClass: "bg-[url('/old.png')]",
		newBgImageClass: "bg-[url('/new.png')]",
		originalBgSize: 'bg-cover',
		newBgSize: 'bg-contain',
		originalBgPosition: 'bg-center',
		newBgPosition: 'bg-top',
		originalBgRepeat: 'bg-no-repeat',
		newBgRepeat: 'bg-repeat',
		isDirty: true,
	})

	saveBgImageEditsToStorage(pendingChanges)

	const stored = sessionStorage.getItem('cms-pending-bg-image-edits')
	expect(stored).not.toBeNull()

	const parsed = JSON.parse(stored!)
	expect(parsed['test-id']).toBeDefined()
	expect(parsed['test-id'].newBgImageClass).toBe("bg-[url('/new.png')]")
	expect(parsed['test-id'].originalBgImageClass).toBe("bg-[url('/old.png')]")
	expect(parsed['test-id'].newBgSize).toBe('bg-contain')
	expect(parsed['test-id'].newBgPosition).toBe('bg-top')
	expect(parsed['test-id'].newBgRepeat).toBe('bg-repeat')
})

test('saveBgImageEditsToStorage does not save clean changes', () => {
	const pendingChanges = new Map<string, PendingBackgroundImageChange>()

	const mockElement = document.createElement('div')

	pendingChanges.set('test-id', {
		element: mockElement,
		cmsId: 'test-id',
		originalBgImageClass: "bg-[url('/same.png')]",
		newBgImageClass: "bg-[url('/same.png')]",
		originalBgSize: 'bg-cover',
		newBgSize: 'bg-cover',
		originalBgPosition: 'bg-center',
		newBgPosition: 'bg-center',
		originalBgRepeat: 'bg-no-repeat',
		newBgRepeat: 'bg-no-repeat',
		isDirty: false,
	})

	saveBgImageEditsToStorage(pendingChanges)

	const stored = sessionStorage.getItem('cms-pending-bg-image-edits')
	expect(stored).not.toBeNull()

	const parsed = JSON.parse(stored!)
	expect(parsed['test-id']).toBeUndefined()
})

test('loadBgImageEditsFromStorage returns saved edits', () => {
	const edits = {
		'test-id': {
			originalBgImageClass: "bg-[url('/old.png')]",
			newBgImageClass: "bg-[url('/new.png')]",
			originalBgSize: 'bg-cover',
			newBgSize: 'bg-contain',
			originalBgPosition: 'bg-center',
			newBgPosition: 'bg-top',
			originalBgRepeat: 'bg-no-repeat',
			newBgRepeat: 'bg-repeat',
		},
	}

	sessionStorage.setItem('cms-pending-bg-image-edits', JSON.stringify(edits))

	const loaded = loadBgImageEditsFromStorage()
	expect(loaded['test-id']).toBeDefined()
	expect(loaded['test-id']?.newBgImageClass).toBe("bg-[url('/new.png')]")
	expect(loaded['test-id']?.originalBgSize).toBe('bg-cover')
})

test('loadBgImageEditsFromStorage returns empty object when no data', () => {
	const loaded = loadBgImageEditsFromStorage()
	expect(loaded).toEqual({})
})

test('loadBgImageEditsFromStorage handles invalid JSON gracefully', () => {
	sessionStorage.setItem('cms-pending-bg-image-edits', 'invalid json')

	const loaded = loadBgImageEditsFromStorage()
	expect(loaded).toEqual({})
})

test('clearBgImageEditsFromStorage removes stored data', () => {
	sessionStorage.setItem('cms-pending-bg-image-edits', JSON.stringify({ test: 'data' }))

	clearBgImageEditsFromStorage()

	const stored = sessionStorage.getItem('cms-pending-bg-image-edits')
	expect(stored).toBeNull()
})

test('clearAllEditsFromStorage also clears bg image edits', () => {
	sessionStorage.setItem('cms-pending-bg-image-edits', JSON.stringify({ test: 'data' }))
	sessionStorage.setItem('cms-pending-edits', JSON.stringify({ text: 'data' }))

	clearAllEditsFromStorage()

	const bgImageStored = sessionStorage.getItem('cms-pending-bg-image-edits')
	expect(bgImageStored).toBeNull()

	const textStored = sessionStorage.getItem('cms-pending-edits')
	expect(textStored).toBeNull()
})
