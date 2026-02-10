import { beforeEach, expect, test } from 'bun:test'
import {
	addChatMessage,
	aiState,
	batch,
	blockEditorState,
	clearChatMessages,
	clearPendingImageChanges,
	currentEditingId,
	deletePendingImageChange,
	dirtyChanges,
	dirtyChangesCount,
	dirtyImageChanges,
	dirtyImageChangesCount,
	getPendingImageChange,
	getStateSnapshot,
	hasDirtyChanges,
	hasDirtyImageChanges,
	isEditing,
	isEnabled,
	manifest,
	pendingChanges,
	pendingImageChanges,
	resetAIState,
	resetAllState,
	resetBlockEditorState,
	setAIChatOpen,
	setAIProcessing,
	setBlockEditorMode,
	setBlockEditorOpen,
	setCurrentEditingId,
	setEditing,
	setEnabled,
	setManifest,
	setPendingImageChange,
	setShowingOriginal,
	showingOriginal,
	showToast,
	toasts,
	totalDirtyCount,
	updateChatMessage,
	updatePendingImageChange,
} from '../../../src/editor/signals'

beforeEach(() => {
	// Reset all signals before each test
	resetAllState()
})

test('signals have correct initial values', () => {
	expect(isEnabled.value).toBe(false)
	expect(isEditing.value).toBe(false)
	expect(showingOriginal.value).toBe(false)
	expect(currentEditingId.value).toBeNull()
	expect(pendingChanges.value.size).toBe(0)
	expect(Object.keys(manifest.value.entries).length).toBe(0)
	expect(aiState.value.isProcessing).toBe(false)
	expect(aiState.value.isChatOpen).toBe(false)
	expect(blockEditorState.value.isOpen).toBe(false)
})

test('setEnabled updates isEnabled signal', () => {
	expect(isEnabled.value).toBe(false)

	setEnabled(true)
	expect(isEnabled.value).toBe(true)

	setEnabled(false)
	expect(isEnabled.value).toBe(false)
})

test('setEditing updates isEditing signal', () => {
	expect(isEditing.value).toBe(false)

	setEditing(true)
	expect(isEditing.value).toBe(true)

	setEditing(false)
	expect(isEditing.value).toBe(false)
})

test('setShowingOriginal updates showingOriginal signal', () => {
	expect(showingOriginal.value).toBe(false)

	setShowingOriginal(true)
	expect(showingOriginal.value).toBe(true)

	setShowingOriginal(false)
	expect(showingOriginal.value).toBe(false)
})

test('setCurrentEditingId updates currentEditingId signal', () => {
	expect(currentEditingId.value).toBeNull()

	setCurrentEditingId('test-id')
	expect(currentEditingId.value).toBe('test-id')

	setCurrentEditingId(null)
	expect(currentEditingId.value).toBeNull()
})

test('setManifest updates manifest signal', () => {
	const newManifest = {
		entries: {
			'test-id': {
				id: 'test-id',
				file: '/test.astro',
				tag: 'p',
				text: 'Test content',
			},
		},
		components: {},
		componentDefinitions: {},
	}

	setManifest(newManifest)
	expect(manifest.value.entries['test-id']?.text).toBe('Test content')
})

test('AI state mutations work correctly', () => {
	expect(aiState.value.isProcessing).toBe(false)
	expect(aiState.value.isChatOpen).toBe(false)
	expect(aiState.value.chatMessages.length).toBe(0)

	setAIProcessing(true)
	expect(aiState.value.isProcessing).toBe(true)

	setAIChatOpen(true)
	expect(aiState.value.isChatOpen).toBe(true)

	addChatMessage({
		id: 'msg-1',
		role: 'user',
		content: 'Hello',
		timestamp: Date.now(),
	})
	expect(aiState.value.chatMessages.length).toBe(1)
	expect(aiState.value.chatMessages[0]?.content).toBe('Hello')

	addChatMessage({
		id: 'msg-2',
		role: 'assistant',
		content: 'Hi there!',
		timestamp: Date.now(),
	})
	expect(aiState.value.chatMessages.length).toBe(2)

	clearChatMessages()
	expect(aiState.value.chatMessages.length).toBe(0)
})

test('resetAIState resets to initial values', () => {
	setAIProcessing(true)
	setAIChatOpen(true)
	addChatMessage({
		id: 'msg-1',
		role: 'user',
		content: 'Hello',
		timestamp: Date.now(),
	})

	resetAIState()

	expect(aiState.value.isProcessing).toBe(false)
	expect(aiState.value.isChatOpen).toBe(false)
	expect(aiState.value.chatMessages.length).toBe(0)
})

test('Block editor state mutations work correctly', () => {
	expect(blockEditorState.value.isOpen).toBe(false)
	expect(blockEditorState.value.mode).toBe('edit')

	setBlockEditorOpen(true)
	expect(blockEditorState.value.isOpen).toBe(true)

	setBlockEditorMode('add')
	expect(blockEditorState.value.mode).toBe('add')

	setBlockEditorMode('picker')
	expect(blockEditorState.value.mode).toBe('picker')
})

test('resetBlockEditorState resets to initial values', () => {
	setBlockEditorOpen(true)
	setBlockEditorMode('add')

	resetBlockEditorState()

	expect(blockEditorState.value.isOpen).toBe(false)
	expect(blockEditorState.value.mode).toBe('edit')
})

test('batch updates multiple signals atomically', () => {
	batch(() => {
		setEnabled(true)
		setEditing(true)
		setCurrentEditingId('batch-test')
	})

	expect(isEnabled.value).toBe(true)
	expect(isEditing.value).toBe(true)
	expect(currentEditingId.value).toBe('batch-test')
})

test('getStateSnapshot returns complete state object', () => {
	setEnabled(true)
	setEditing(true)
	setCurrentEditingId('snapshot-test')

	const snapshot = getStateSnapshot()

	expect(snapshot.isEnabled).toBe(true)
	expect(snapshot.isEditing).toBe(true)
	expect(snapshot.currentEditingId).toBe('snapshot-test')
	expect(snapshot.pendingChanges).toBeInstanceOf(Map)
	expect(snapshot.ai).toBeDefined()
	expect(snapshot.blockEditor).toBeDefined()
})

test('resetAllState resets everything to initial values', () => {
	// Set various state
	setEnabled(true)
	setEditing(true)
	setCurrentEditingId('reset-test')
	setAIProcessing(true)
	setBlockEditorOpen(true)

	resetAllState()

	expect(isEnabled.value).toBe(false)
	expect(isEditing.value).toBe(false)
	expect(currentEditingId.value).toBeNull()
	expect(aiState.value.isProcessing).toBe(false)
	expect(blockEditorState.value.isOpen).toBe(false)
})

test('computed signals update automatically', () => {
	// dirtyChangesCount is a computed signal that depends on pendingChanges
	expect(dirtyChangesCount.value).toBe(0)
	expect(dirtyChanges.value.length).toBe(0)

	// Note: We can't easily test with real PendingChange objects here
	// since they require HTMLElement which isn't available in this test environment
})

test('updateChatMessage updates specific message', () => {
	const message1 = {
		id: 'msg-1',
		role: 'user' as const,
		content: 'Hello',
		timestamp: Date.now(),
	}
	const message2 = {
		id: 'msg-2',
		role: 'assistant' as const,
		content: 'Hi there',
		timestamp: Date.now(),
	}

	addChatMessage(message1)
	addChatMessage(message2)

	expect(aiState.value.chatMessages.length).toBe(2)

	updateChatMessage('msg-2', 'Updated content')

	expect(aiState.value.chatMessages[0]?.content).toBe('Hello')
	expect(aiState.value.chatMessages[1]?.content).toBe('Updated content')
})

test('showToast returns unique IDs', () => {
	const id1 = showToast('Message 1', 'info')
	const id2 = showToast('Message 2', 'success')
	const id3 = showToast('Message 3', 'error')

	expect(id1).not.toBe(id2)
	expect(id2).not.toBe(id3)
	expect(toasts.value.length).toBe(3)

	// IDs should follow pattern toast-N
	expect(id1).toMatch(/^toast-\d+$/)
	expect(id2).toMatch(/^toast-\d+$/)
	expect(id3).toMatch(/^toast-\d+$/)
})

test('hasDirtyChanges computed signal works', () => {
	expect(hasDirtyChanges.value).toBe(false)
	// More detailed testing would require mocking HTMLElement
})

// Image change tracking tests
test('pendingImageChanges has correct initial value', () => {
	expect(pendingImageChanges.value.size).toBe(0)
})

test('setPendingImageChange adds image change to pending', () => {
	const mockElement = document.createElement('img')
	const change = {
		element: mockElement,
		originalSrc: '/assets/old.webp',
		newSrc: '/assets/old.webp',
		originalAlt: 'Old alt',
		newAlt: 'Old alt',
		originalSrcSet: '',
		isDirty: false,
	}

	setPendingImageChange('img-1', change)

	expect(pendingImageChanges.value.size).toBe(1)
	expect(pendingImageChanges.value.get('img-1')).toEqual(change)
})

test('getPendingImageChange retrieves correct change', () => {
	const mockElement = document.createElement('img')
	const change = {
		element: mockElement,
		originalSrc: '/assets/test.webp',
		newSrc: '/assets/test.webp',
		originalAlt: 'Test',
		newAlt: 'Test',
		originalSrcSet: '',
		isDirty: false,
	}

	setPendingImageChange('img-2', change)

	const retrieved = getPendingImageChange('img-2')
	expect(retrieved).toEqual(change)
})

test('getPendingImageChange returns undefined for non-existent id', () => {
	const retrieved = getPendingImageChange('non-existent')
	expect(retrieved).toBeUndefined()
})

test('updatePendingImageChange updates existing change', () => {
	const mockElement = document.createElement('img')
	const initialChange = {
		element: mockElement,
		originalSrc: '/assets/old.webp',
		newSrc: '/assets/old.webp',
		originalAlt: 'Old',
		newAlt: 'Old',
		originalSrcSet: '',
		isDirty: false,
	}

	setPendingImageChange('img-3', initialChange)

	updatePendingImageChange('img-3', (change) => ({
		...change,
		newSrc: '/assets/new.webp',
		newAlt: 'New',
		originalSrcSet: '',
		isDirty: true,
	}))

	const updated = getPendingImageChange('img-3')
	expect(updated?.newSrc).toBe('/assets/new.webp')
	expect(updated?.newAlt).toBe('New')
	expect(updated?.isDirty).toBe(true)
	// Original values should remain unchanged
	expect(updated?.originalSrc).toBe('/assets/old.webp')
	expect(updated?.originalAlt).toBe('Old')
})

test('deletePendingImageChange removes change', () => {
	const mockElement = document.createElement('img')
	setPendingImageChange('img-4', {
		element: mockElement,
		originalSrc: '/assets/delete.webp',
		newSrc: '/assets/delete.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: false,
	})

	expect(pendingImageChanges.value.has('img-4')).toBe(true)

	deletePendingImageChange('img-4')

	expect(pendingImageChanges.value.has('img-4')).toBe(false)
})

test('clearPendingImageChanges removes all changes', () => {
	const mockElement = document.createElement('img')

	setPendingImageChange('img-a', {
		element: mockElement,
		originalSrc: '/a.webp',
		newSrc: '/a.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: false,
	})
	setPendingImageChange('img-b', {
		element: mockElement,
		originalSrc: '/b.webp',
		newSrc: '/b.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: false,
	})

	expect(pendingImageChanges.value.size).toBe(2)

	clearPendingImageChanges()

	expect(pendingImageChanges.value.size).toBe(0)
})

test('dirtyImageChangesCount counts only dirty changes', () => {
	const mockElement = document.createElement('img')

	setPendingImageChange('img-dirty', {
		element: mockElement,
		originalSrc: '/old.webp',
		newSrc: '/new.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: true,
	})
	setPendingImageChange('img-clean', {
		element: mockElement,
		originalSrc: '/same.webp',
		newSrc: '/same.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: false,
	})

	expect(dirtyImageChangesCount.value).toBe(1)
})

test('dirtyImageChanges returns only dirty changes', () => {
	const mockElement = document.createElement('img')

	setPendingImageChange('dirty-1', {
		element: mockElement,
		originalSrc: '/old1.webp',
		newSrc: '/new1.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: true,
	})
	setPendingImageChange('dirty-2', {
		element: mockElement,
		originalSrc: '/old2.webp',
		newSrc: '/new2.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: true,
	})
	setPendingImageChange('clean-1', {
		element: mockElement,
		originalSrc: '/same.webp',
		newSrc: '/same.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: false,
	})

	const dirty = dirtyImageChanges.value
	expect(dirty.length).toBe(2)
	expect(dirty.some(([id]) => id === 'dirty-1')).toBe(true)
	expect(dirty.some(([id]) => id === 'dirty-2')).toBe(true)
	expect(dirty.some(([id]) => id === 'clean-1')).toBe(false)
})

test('hasDirtyImageChanges computed signal works', () => {
	expect(hasDirtyImageChanges.value).toBe(false)

	const mockElement = document.createElement('img')
	setPendingImageChange('img-test', {
		element: mockElement,
		originalSrc: '/old.webp',
		newSrc: '/new.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: true,
	})

	expect(hasDirtyImageChanges.value).toBe(true)

	clearPendingImageChanges()

	expect(hasDirtyImageChanges.value).toBe(false)
})

test('totalDirtyCount includes image changes', () => {
	expect(totalDirtyCount.value).toBe(0)

	const mockElement = document.createElement('img')
	setPendingImageChange('img-total', {
		element: mockElement,
		originalSrc: '/old.webp',
		newSrc: '/new.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: true,
	})

	expect(totalDirtyCount.value).toBe(1)

	setPendingImageChange('img-total-2', {
		element: mockElement,
		originalSrc: '/old2.webp',
		newSrc: '/new2.webp',
		originalAlt: '',
		newAlt: '',
		originalSrcSet: '',
		isDirty: true,
	})

	expect(totalDirtyCount.value).toBe(2)
})

test('image change isDirty based on src comparison', () => {
	const mockElement = document.createElement('img')
	const originalSrc = '/assets/original.webp'

	// Initial state - not dirty
	setPendingImageChange('img-compare', {
		element: mockElement,
		originalSrc,
		newSrc: originalSrc,
		originalAlt: 'Alt',
		newAlt: 'Alt',
		originalSrcSet: '',
		isDirty: false,
	})

	expect(hasDirtyImageChanges.value).toBe(false)

	// Change the image - becomes dirty
	updatePendingImageChange('img-compare', (change) => ({
		...change,
		newSrc: '/assets/new.webp',
		isDirty: true,
	}))

	expect(hasDirtyImageChanges.value).toBe(true)

	// Revert to original - no longer dirty
	updatePendingImageChange('img-compare', (change) => ({
		...change,
		newSrc: originalSrc,
		isDirty: false,
	}))

	expect(hasDirtyImageChanges.value).toBe(false)
})
