import { STORAGE_KEYS } from './constants'
import type {
	CmsSettings,
	PendingAttributeChange,
	PendingChange,
	PendingColorChange,
	PendingImageChange,
	SavedAttributeEdits,
	SavedColorEdits,
	SavedEdits,
	SavedImageEdits,
} from './types'

// ============================================================================
// Text Edits
// ============================================================================

export function saveEditsToStorage(pendingChanges: Map<string, PendingChange>): void {
	const edits: SavedEdits = {}

	pendingChanges.forEach((change, cmsId) => {
		if (change.isDirty) {
			edits[cmsId] = {
				originalText: change.originalText,
				newText: change.newText,
				currentHTML: change.currentHTML,
				hasStyledContent: change.hasStyledContent,
			}
		}
	})

	try {
		sessionStorage.setItem(STORAGE_KEYS.PENDING_EDITS, JSON.stringify(edits))
	} catch (e) {
		console.warn('[CMS] Failed to save edits to storage:', e)
	}
}

export function loadEditsFromStorage(): SavedEdits {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_EDITS)
		return stored ? JSON.parse(stored) : {}
	} catch (e) {
		console.warn('[CMS] Failed to load edits from storage:', e)
		return {}
	}
}

export function clearEditsFromStorage(): void {
	try {
		sessionStorage.removeItem(STORAGE_KEYS.PENDING_EDITS)
	} catch (e) {
		console.warn('[CMS] Failed to clear edits from storage:', e)
	}
}

// ============================================================================
// Image Edits
// ============================================================================

export function saveImageEditsToStorage(pendingImageChanges: Map<string, PendingImageChange>): void {
	const edits: SavedImageEdits = {}

	pendingImageChanges.forEach((change, cmsId) => {
		if (change.isDirty) {
			edits[cmsId] = {
				originalSrc: change.originalSrc,
				newSrc: change.newSrc,
				originalAlt: change.originalAlt,
				newAlt: change.newAlt,
				originalSrcSet: change.originalSrcSet,
			}
		}
	})

	try {
		sessionStorage.setItem(STORAGE_KEYS.PENDING_IMAGE_EDITS, JSON.stringify(edits))
	} catch (e) {
		console.warn('[CMS] Failed to save image edits to storage:', e)
	}
}

export function loadImageEditsFromStorage(): SavedImageEdits {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_IMAGE_EDITS)
		return stored ? JSON.parse(stored) : {}
	} catch (e) {
		console.warn('[CMS] Failed to load image edits from storage:', e)
		return {}
	}
}

export function clearImageEditsFromStorage(): void {
	try {
		sessionStorage.removeItem(STORAGE_KEYS.PENDING_IMAGE_EDITS)
	} catch (e) {
		console.warn('[CMS] Failed to clear image edits from storage:', e)
	}
}

// ============================================================================
// Color Edits
// ============================================================================

export function saveColorEditsToStorage(pendingColorChanges: Map<string, PendingColorChange>): void {
	const edits: SavedColorEdits = {}

	pendingColorChanges.forEach((change, cmsId) => {
		if (change.isDirty) {
			edits[cmsId] = {
				originalClasses: change.originalClasses,
				newClasses: change.newClasses,
			}
		}
	})

	try {
		sessionStorage.setItem(STORAGE_KEYS.PENDING_COLOR_EDITS, JSON.stringify(edits))
	} catch (e) {
		console.warn('[CMS] Failed to save color edits to storage:', e)
	}
}

export function loadColorEditsFromStorage(): SavedColorEdits {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_COLOR_EDITS)
		return stored ? JSON.parse(stored) : {}
	} catch (e) {
		console.warn('[CMS] Failed to load color edits from storage:', e)
		return {}
	}
}

export function clearColorEditsFromStorage(): void {
	try {
		sessionStorage.removeItem(STORAGE_KEYS.PENDING_COLOR_EDITS)
	} catch (e) {
		console.warn('[CMS] Failed to clear color edits from storage:', e)
	}
}

// ============================================================================
// Attribute Edits
// ============================================================================

export function saveAttributeEditsToStorage(pendingAttributeChanges: Map<string, PendingAttributeChange>): void {
	const edits: SavedAttributeEdits = {}

	pendingAttributeChanges.forEach((change, cmsId) => {
		if (change.isDirty) {
			edits[cmsId] = {
				originalAttributes: change.originalAttributes,
				newAttributes: change.newAttributes,
			}
		}
	})

	try {
		sessionStorage.setItem(STORAGE_KEYS.PENDING_ATTRIBUTE_EDITS, JSON.stringify(edits))
	} catch (e) {
		console.warn('[CMS] Failed to save attribute edits to storage:', e)
	}
}

export function loadAttributeEditsFromStorage(): SavedAttributeEdits {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_ATTRIBUTE_EDITS)
		return stored ? JSON.parse(stored) : {}
	} catch (e) {
		console.warn('[CMS] Failed to load attribute edits from storage:', e)
		return {}
	}
}

export function clearAttributeEditsFromStorage(): void {
	try {
		sessionStorage.removeItem(STORAGE_KEYS.PENDING_ATTRIBUTE_EDITS)
	} catch (e) {
		console.warn('[CMS] Failed to clear attribute edits from storage:', e)
	}
}

// ============================================================================
// Settings
// ============================================================================

export function saveSettingsToStorage(settings: CmsSettings): void {
	try {
		localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings))
	} catch (e) {
		console.warn('[CMS] Failed to save settings to storage:', e)
	}
}

export function loadSettingsFromStorage(): CmsSettings | null {
	try {
		const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS)
		return stored ? JSON.parse(stored) : null
	} catch (e) {
		console.warn('[CMS] Failed to load settings from storage:', e)
		return null
	}
}

export function clearSettingsFromStorage(): void {
	try {
		localStorage.removeItem(STORAGE_KEYS.SETTINGS)
	} catch (e) {
		console.warn('[CMS] Failed to clear settings from storage:', e)
	}
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
	try {
		sessionStorage.setItem(STORAGE_KEYS.PENDING_ENTRY_NAVIGATION, JSON.stringify(entry))
	} catch (e) {
		console.warn('[CMS] Failed to save pending entry navigation:', e)
	}
}

export function hasPendingEntryNavigation(): boolean {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_ENTRY_NAVIGATION)
		if (!stored) return false
		const entry: PendingEntryNavigation = JSON.parse(stored)
		return window.location.pathname === entry.pathname
	} catch {
		return false
	}
}

export function loadPendingEntryNavigation(): PendingEntryNavigation | null {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_ENTRY_NAVIGATION)
		if (!stored) return null
		const entry: PendingEntryNavigation = JSON.parse(stored)
		if (window.location.pathname !== entry.pathname) return null
		sessionStorage.removeItem(STORAGE_KEYS.PENDING_ENTRY_NAVIGATION)
		return entry
	} catch (e) {
		console.warn('[CMS] Failed to load pending entry navigation:', e)
		return null
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
}
