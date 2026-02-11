import { computed, signal } from '@preact/signals'
import * as signals from './signals'
import { saveAttributeEditsToStorage, saveColorEditsToStorage, saveEditsToStorage, saveImageEditsToStorage } from './storage'
import type { Attribute, UndoAction, UndoTextAction } from './types'

// ============================================================================
// Undo/Redo Stack
// ============================================================================

const MAX_HISTORY = 100
const TEXT_DEBOUNCE_MS = 500

export const undoStack = signal<UndoAction[]>([])
export const redoStack = signal<UndoAction[]>([])

export const canUndo = computed(() => undoStack.value.length > 0 || pendingTextAction !== null)
export const canRedo = computed(() => redoStack.value.length > 0)

/** Guard flag to prevent re-recording during undo/redo application */
export let isApplyingUndoRedo = false

// ============================================================================
// Debounced Text Recording
// ============================================================================

let pendingTextAction: UndoTextAction | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function flushPendingText(): void {
	if (pendingTextAction) {
		pushUndo(pendingTextAction)
		pendingTextAction = null
	}
	if (debounceTimer) {
		clearTimeout(debounceTimer)
		debounceTimer = null
	}
}

/**
 * Record a text change with debouncing.
 * Rapid keystrokes to the same element are grouped into a single undo unit.
 */
export function recordTextChange(snapshot: UndoTextAction): void {
	if (isApplyingUndoRedo) return

	// If there's a pending action for the same element, extend it (keep original previous, update current)
	if (pendingTextAction && pendingTextAction.cmsId === snapshot.cmsId) {
		pendingTextAction = {
			...pendingTextAction,
			currentHTML: snapshot.currentHTML,
			currentText: snapshot.currentText,
		}
	} else {
		// Flush any existing pending action for a different element
		flushPendingText()
		pendingTextAction = snapshot
	}

	// Clear redo stack on new user action
	redoStack.value = []

	// Reset debounce timer
	if (debounceTimer) {
		clearTimeout(debounceTimer)
	}
	debounceTimer = setTimeout(flushPendingText, TEXT_DEBOUNCE_MS)
}

// ============================================================================
// Immediate Recording (non-text changes)
// ============================================================================

/**
 * Record a non-text change immediately (color, image, attribute, seo).
 */
export function recordChange(action: UndoAction): void {
	if (isApplyingUndoRedo) return

	// Flush any pending text action first
	flushPendingText()

	pushUndo(action)

	// Clear redo stack on new user action
	redoStack.value = []
}

// ============================================================================
// Stack Operations
// ============================================================================

function pushUndo(action: UndoAction): void {
	const stack = [...undoStack.value, action]
	if (stack.length > MAX_HISTORY) {
		stack.shift()
	}
	undoStack.value = stack
}

function pushRedo(action: UndoAction): void {
	const stack = [...redoStack.value, action]
	if (stack.length > MAX_HISTORY) {
		stack.shift()
	}
	redoStack.value = stack
}

// ============================================================================
// Perform Undo / Redo
// ============================================================================

export function performUndo(): void {
	// Flush pending text so it can be undone
	flushPendingText()

	const stack = undoStack.value
	if (stack.length === 0) return

	const action = stack[stack.length - 1]!
	undoStack.value = stack.slice(0, -1)

	isApplyingUndoRedo = true
	try {
		applyReverse(action)
		pushRedo(action)
	} finally {
		isApplyingUndoRedo = false
	}
}

export function performRedo(): void {
	const stack = redoStack.value
	if (stack.length === 0) return

	const action = stack[stack.length - 1]!
	redoStack.value = stack.slice(0, -1)

	isApplyingUndoRedo = true
	try {
		applyForward(action)
		pushUndo(action)
	} finally {
		isApplyingUndoRedo = false
	}
}

// ============================================================================
// Apply Logic (Reverse = Undo, Forward = Redo)
// ============================================================================

function scrollToElement(element: HTMLElement): void {
	if (!element.isConnected) return

	const rect = element.getBoundingClientRect()
	const inView = rect.top >= 0 && rect.bottom <= window.innerHeight
	if (!inView) {
		element.scrollIntoView({ behavior: 'smooth', block: 'center' })
	}
}

function applyReverse(action: UndoAction): void {
	switch (action.type) {
		case 'text':
			scrollToElement(action.element)
			applyTextState(action.cmsId, action.element, action.previousHTML, action.previousText, action.wasDirty)
			break
		case 'image':
			scrollToElement(action.element)
			applyImageState(action.cmsId, action.element, action.previousSrc, action.previousAlt, action.wasDirty)
			break
		case 'color':
			scrollToElement(action.element)
			applyColorState(action.cmsId, action.element, action.previousClassName, action.previousStyleCssText, action.previousClasses, action.wasDirty)
			break
		case 'attribute':
			scrollToElement(action.element)
			applyAttributeState(action.cmsId, action.element, action.previousAttributes, action.wasDirty)
			break
		case 'seo':
			applySeoState(action.cmsId, action.previousValue, action.originalValue, action.wasDirty)
			break
	}
}

function applyForward(action: UndoAction): void {
	switch (action.type) {
		case 'text':
			scrollToElement(action.element)
			applyTextState(action.cmsId, action.element, action.currentHTML, action.currentText, true)
			break
		case 'image':
			scrollToElement(action.element)
			applyImageState(action.cmsId, action.element, action.currentSrc, action.currentAlt, true)
			break
		case 'color':
			scrollToElement(action.element)
			applyColorState(action.cmsId, action.element, action.currentClassName, action.currentStyleCssText, action.currentClasses, true)
			break
		case 'attribute':
			scrollToElement(action.element)
			applyAttributeState(action.cmsId, action.element, action.currentAttributes, true)
			break
		case 'seo':
			applySeoState(action.cmsId, action.currentValue, action.originalValue, true)
			break
	}
}

// ============================================================================
// State Application Helpers
// ============================================================================

function applyTextState(
	cmsId: string,
	element: HTMLElement,
	html: string,
	text: string,
	isDirty: boolean,
): void {
	if (element.isConnected) {
		element.innerHTML = html
	}

	signals.updatePendingChange(cmsId, (c) => ({
		...c,
		newText: text,
		currentHTML: html,
		isDirty,
	}))

	saveEditsToStorage(signals.pendingChanges.value)
}

function applyImageState(
	cmsId: string,
	element: HTMLImageElement,
	src: string,
	alt: string,
	isDirty: boolean,
): void {
	if (element.isConnected) {
		element.src = src
		element.alt = alt
		// When dirty (new image), clear srcset so browser uses src
		// When restoring to original, restore the original srcset
		const change = signals.getPendingImageChange(cmsId)
		if (isDirty) {
			element.removeAttribute('srcset')
		} else if (change?.originalSrcSet) {
			element.setAttribute('srcset', change.originalSrcSet)
		}
	}

	signals.updatePendingImageChange(cmsId, (c) => ({
		...c,
		newSrc: src,
		newAlt: alt,
		isDirty,
	}))

	saveImageEditsToStorage(signals.pendingImageChanges.value)
}

function applyColorState(
	cmsId: string,
	element: HTMLElement,
	className: string,
	styleCssText: string,
	classes: Record<string, Attribute>,
	isDirty: boolean,
): void {
	if (element.isConnected) {
		element.className = className
		element.style.cssText = styleCssText
	}

	signals.updatePendingColorChange(cmsId, (c) => ({
		...c,
		newClasses: deepCopyAttributes(classes),
		isDirty,
	}))

	saveColorEditsToStorage(signals.pendingColorChanges.value)
}

function applyAttributeState(
	cmsId: string,
	element: HTMLElement,
	attributes: Record<string, Attribute>,
	isDirty: boolean,
): void {
	if (element.isConnected) {
		for (const [attrName, attr] of Object.entries(attributes)) {
			if (attr.value === undefined || attr.value === '') {
				element.removeAttribute(attrName)
			} else {
				element.setAttribute(attrName, attr.value)
			}
		}
	}

	signals.updatePendingAttributeChange(cmsId, (c) => ({
		...c,
		newAttributes: deepCopyAttributes(attributes),
		isDirty,
	}))

	saveAttributeEditsToStorage(signals.pendingAttributeChanges.value)
}

function applySeoState(
	cmsId: string,
	value: string,
	originalValue: string,
	isDirty: boolean,
): void {
	signals.setPendingSeoChange(cmsId, {
		id: cmsId,
		originalValue,
		newValue: value,
		isDirty,
	})
}

// ============================================================================
// Clear History
// ============================================================================

export function clearHistory(): void {
	undoStack.value = []
	redoStack.value = []
	pendingTextAction = null
	if (debounceTimer) {
		clearTimeout(debounceTimer)
		debounceTimer = null
	}
}

// ============================================================================
// Helpers
// ============================================================================

function deepCopyAttributes(attrs: Record<string, Attribute>): Record<string, Attribute> {
	const copy: Record<string, Attribute> = {}
	for (const [key, attr] of Object.entries(attrs)) {
		copy[key] = { ...attr }
	}
	return copy
}
