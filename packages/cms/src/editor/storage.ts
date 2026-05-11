import { STORAGE_KEYS } from './constants'
import type {
	CmsSettings,
	PendingAttributeChange,
	PendingBackgroundImageChange,
	PendingChange,
	PendingColorChange,
	PendingImageChange,
	SavedAttributeEdits,
	SavedBackgroundImageEdits,
	SavedColorEdits,
	SavedEdits,
	SavedImageEdits,
} from './types'

// ============================================================================
// JSON-based storage helpers — all browser-storage access in this module
// goes through these so the try/catch + console.warn pattern lives in one place.
// ============================================================================

function readJson<T>(storage: Storage, key: string, fallback: T, label: string): T {
	try {
		const raw = storage.getItem(key)
		return raw === null ? fallback : (JSON.parse(raw) as T)
	} catch (e) {
		console.warn(`[CMS] ${label}:`, e)
		return fallback
	}
}

function writeJson(storage: Storage, key: string, value: unknown, label: string): void {
	try {
		storage.setItem(key, JSON.stringify(value))
	} catch (e) {
		console.warn(`[CMS] ${label}:`, e)
	}
}

function removeKey(storage: Storage, key: string, label: string): void {
	try {
		storage.removeItem(key)
	} catch (e) {
		console.warn(`[CMS] ${label}:`, e)
	}
}

function collectDirtyEdits<C, E>(
	pendingChanges: Map<string, C>,
	pickFields: (change: C) => E,
	isDirty: (change: C) => boolean,
): Record<string, E> {
	const edits: Record<string, E> = {}
	pendingChanges.forEach((change, cmsId) => {
		if (isDirty(change)) edits[cmsId] = pickFields(change)
	})
	return edits
}

// ============================================================================
// Text Edits
// ============================================================================

export function saveEditsToStorage(pendingChanges: Map<string, PendingChange>): void {
	const edits = collectDirtyEdits(pendingChanges, (c) => ({
		originalText: c.originalText,
		newText: c.newText,
		currentHTML: c.currentHTML,
		hasStyledContent: c.hasStyledContent,
	}), (c) => c.isDirty)
	writeJson(sessionStorage, STORAGE_KEYS.PENDING_EDITS, edits, 'Failed to save edits to storage')
}

export function loadEditsFromStorage(): SavedEdits {
	return readJson<SavedEdits>(sessionStorage, STORAGE_KEYS.PENDING_EDITS, {}, 'Failed to load edits from storage')
}

export function clearEditsFromStorage(): void {
	removeKey(sessionStorage, STORAGE_KEYS.PENDING_EDITS, 'Failed to clear edits from storage')
}

// ============================================================================
// Image Edits
// ============================================================================

export function saveImageEditsToStorage(pendingImageChanges: Map<string, PendingImageChange>): void {
	const edits = collectDirtyEdits(pendingImageChanges, (c) => ({
		originalSrc: c.originalSrc,
		newSrc: c.newSrc,
		originalAlt: c.originalAlt,
		newAlt: c.newAlt,
		originalSrcSet: c.originalSrcSet,
	}), (c) => c.isDirty)
	writeJson(sessionStorage, STORAGE_KEYS.PENDING_IMAGE_EDITS, edits, 'Failed to save image edits to storage')
}

export function loadImageEditsFromStorage(): SavedImageEdits {
	return readJson<SavedImageEdits>(
		sessionStorage,
		STORAGE_KEYS.PENDING_IMAGE_EDITS,
		{},
		'Failed to load image edits from storage',
	)
}

export function clearImageEditsFromStorage(): void {
	removeKey(sessionStorage, STORAGE_KEYS.PENDING_IMAGE_EDITS, 'Failed to clear image edits from storage')
}

// ============================================================================
// Color Edits
// ============================================================================

export function saveColorEditsToStorage(pendingColorChanges: Map<string, PendingColorChange>): void {
	const edits = collectDirtyEdits(pendingColorChanges, (c) => ({
		originalClasses: c.originalClasses,
		newClasses: c.newClasses,
	}), (c) => c.isDirty)
	writeJson(sessionStorage, STORAGE_KEYS.PENDING_COLOR_EDITS, edits, 'Failed to save color edits to storage')
}

export function loadColorEditsFromStorage(): SavedColorEdits {
	return readJson<SavedColorEdits>(
		sessionStorage,
		STORAGE_KEYS.PENDING_COLOR_EDITS,
		{},
		'Failed to load color edits from storage',
	)
}

export function clearColorEditsFromStorage(): void {
	removeKey(sessionStorage, STORAGE_KEYS.PENDING_COLOR_EDITS, 'Failed to clear color edits from storage')
}

// ============================================================================
// Attribute Edits
// ============================================================================

export function saveAttributeEditsToStorage(pendingAttributeChanges: Map<string, PendingAttributeChange>): void {
	const edits = collectDirtyEdits(pendingAttributeChanges, (c) => ({
		originalAttributes: c.originalAttributes,
		newAttributes: c.newAttributes,
	}), (c) => c.isDirty)
	writeJson(sessionStorage, STORAGE_KEYS.PENDING_ATTRIBUTE_EDITS, edits, 'Failed to save attribute edits to storage')
}

export function loadAttributeEditsFromStorage(): SavedAttributeEdits {
	return readJson<SavedAttributeEdits>(
		sessionStorage,
		STORAGE_KEYS.PENDING_ATTRIBUTE_EDITS,
		{},
		'Failed to load attribute edits from storage',
	)
}

export function clearAttributeEditsFromStorage(): void {
	removeKey(sessionStorage, STORAGE_KEYS.PENDING_ATTRIBUTE_EDITS, 'Failed to clear attribute edits from storage')
}

// ============================================================================
// Background Image Edits
// ============================================================================

export function saveBgImageEditsToStorage(pendingBgImageChanges: Map<string, PendingBackgroundImageChange>): void {
	const edits = collectDirtyEdits(pendingBgImageChanges, (c) => ({
		originalBgImageClass: c.originalBgImageClass,
		newBgImageClass: c.newBgImageClass,
		originalBgSize: c.originalBgSize,
		newBgSize: c.newBgSize,
		originalBgPosition: c.originalBgPosition,
		newBgPosition: c.newBgPosition,
		originalBgRepeat: c.originalBgRepeat,
		newBgRepeat: c.newBgRepeat,
	}), (c) => c.isDirty)
	writeJson(sessionStorage, STORAGE_KEYS.PENDING_BG_IMAGE_EDITS, edits, 'Failed to save bg image edits to storage')
}

export function loadBgImageEditsFromStorage(): SavedBackgroundImageEdits {
	return readJson<SavedBackgroundImageEdits>(
		sessionStorage,
		STORAGE_KEYS.PENDING_BG_IMAGE_EDITS,
		{},
		'Failed to load bg image edits from storage',
	)
}

export function clearBgImageEditsFromStorage(): void {
	removeKey(sessionStorage, STORAGE_KEYS.PENDING_BG_IMAGE_EDITS, 'Failed to clear bg image edits from storage')
}

// ============================================================================
// Settings
// ============================================================================

export function saveSettingsToStorage(settings: CmsSettings): void {
	writeJson(localStorage, STORAGE_KEYS.SETTINGS, settings, 'Failed to save settings to storage')
}

export function loadSettingsFromStorage(): CmsSettings | null {
	return readJson<CmsSettings | null>(localStorage, STORAGE_KEYS.SETTINGS, null, 'Failed to load settings from storage')
}

export function clearSettingsFromStorage(): void {
	removeKey(localStorage, STORAGE_KEYS.SETTINGS, 'Failed to clear settings from storage')
}

// ============================================================================
// Pending Entry Navigation (for navigating to a collection entry page and auto-opening editor)
// ============================================================================

export interface PendingEntryNavigation {
	collectionName: string
	slug: string
	sourcePath: string
	pathname: string
}

export function savePendingEntryNavigation(entry: PendingEntryNavigation): void {
	writeJson(sessionStorage, STORAGE_KEYS.PENDING_ENTRY_NAVIGATION, entry, 'Failed to save pending entry navigation')
}

export function hasPendingEntryNavigation(): boolean {
	const entry = readJson<PendingEntryNavigation | null>(
		sessionStorage,
		STORAGE_KEYS.PENDING_ENTRY_NAVIGATION,
		null,
		'Failed to load pending entry navigation',
	)
	return !!entry && window.location.pathname === entry.pathname
}

export function loadPendingEntryNavigation(): PendingEntryNavigation | null {
	const entry = readJson<PendingEntryNavigation | null>(
		sessionStorage,
		STORAGE_KEYS.PENDING_ENTRY_NAVIGATION,
		null,
		'Failed to load pending entry navigation',
	)
	if (!entry || window.location.pathname !== entry.pathname) return null
	removeKey(sessionStorage, STORAGE_KEYS.PENDING_ENTRY_NAVIGATION, 'Failed to clear pending entry navigation')
	return entry
}

// ============================================================================
// Editing State (persist edit mode across HMR/refresh)
// ============================================================================

export function saveEditingState(isEditing: boolean): void {
	if (isEditing) {
		writeJson(sessionStorage, STORAGE_KEYS.IS_EDITING, true, 'Failed to save editing state')
	} else {
		removeKey(sessionStorage, STORAGE_KEYS.IS_EDITING, 'Failed to clear editing state')
	}
}

export function loadEditingState(): boolean {
	return readJson<boolean>(sessionStorage, STORAGE_KEYS.IS_EDITING, false, 'Failed to load editing state')
}

// ============================================================================
// Markdown Drafts (per-file, sessionStorage)
// ============================================================================

export interface MarkdownDraft {
	frontmatter: Record<string, unknown>
	content: string
	savedAt: number
}

function markdownDraftKey(filePath: string): string {
	return `${STORAGE_KEYS.MARKDOWN_DRAFT_PREFIX}${filePath}`
}

export function saveMarkdownDraft(
	filePath: string,
	frontmatter: Record<string, unknown>,
	content: string,
): void {
	if (!filePath) return
	const draft: MarkdownDraft = { frontmatter, content, savedAt: Date.now() }
	writeJson(sessionStorage, markdownDraftKey(filePath), draft, 'Failed to save markdown draft')
}

export function loadMarkdownDraft(filePath: string): MarkdownDraft | null {
	if (!filePath) return null
	return readJson<MarkdownDraft | null>(sessionStorage, markdownDraftKey(filePath), null, 'Failed to load markdown draft')
}

export function clearMarkdownDraft(filePath: string): void {
	if (!filePath) return
	removeKey(sessionStorage, markdownDraftKey(filePath), 'Failed to clear markdown draft')
}

/** True when at least one markdown draft is present in sessionStorage. */
export function hasAnyMarkdownDraft(): boolean {
	try {
		for (let i = 0; i < sessionStorage.length; i++) {
			const key = sessionStorage.key(i)
			if (key?.startsWith(STORAGE_KEYS.MARKDOWN_DRAFT_PREFIX)) return true
		}
		return false
	} catch {
		return false
	}
}

// ============================================================================
// Clear All
// ============================================================================

export function clearAllEditsFromStorage(): void {
	clearEditsFromStorage()
	clearImageEditsFromStorage()
	clearColorEditsFromStorage()
	clearAttributeEditsFromStorage()
	clearBgImageEditsFromStorage()
}
