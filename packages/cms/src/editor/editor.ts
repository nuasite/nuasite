import { fetchManifest, getDeploymentStatus, getMarkdownContent, saveBatchChanges } from './api'
import { CSS, TIMING } from './constants'
import {
	cleanupHighlightSystem,
	disableAllInteractiveElements,
	enableAllInteractiveElements,
	findInnermostCmsElement,
	getAllCmsElements,
	getChildCmsElements,
	getEditableHtmlFromElement,
	getEditableTextFromElement,
	initHighlightSystem,
	logDebug,
	makeElementEditable,
	makeElementNonEditable,
} from './dom'
import { clearHistory, isApplyingUndoRedo, recordChange, recordTextChange } from './history'
import { getManifestEntryCount, hasManifestEntry } from './manifest'
import * as signals from './signals'
import {
	clearAllEditsFromStorage,
	loadAttributeEditsFromStorage,
	loadBgImageEditsFromStorage,
	loadColorEditsFromStorage,
	loadEditsFromStorage,
	loadImageEditsFromStorage,
	loadPendingEntryNavigation,
	saveAttributeEditsToStorage,
	saveBgImageEditsToStorage,
	saveColorEditsToStorage,
	saveEditingState,
	saveEditsToStorage,
	saveImageEditsToStorage,
} from './storage'
import type { Attribute } from './types'
import type { AttributeChangePayload, ChangePayload, CmsConfig, DeploymentStatusResponse, ManifestEntry, SavedAttributeEdit } from './types'

// CSS attribute for markdown content elements
const MARKDOWN_ATTRIBUTE = 'data-cms-markdown'
// CSS attribute for image elements
const IMAGE_ATTRIBUTE = 'data-cms-img'
// CSS attribute for background image elements
const BG_IMAGE_ATTRIBUTE = 'data-cms-bg-img'

/**
 * Inline HTML elements that indicate styled/formatted content.
 * When an element contains these, we need to preserve the HTML structure.
 */
const INLINE_STYLE_ELEMENTS = [
	'strong',
	'b',
	'em',
	'i',
	'u',
	's',
	'strike',
	'del',
	'ins',
	'mark',
	'small',
	'sub',
	'sup',
	'abbr',
	'cite',
	'code',
	'kbd',
	'samp',
	'var',
	'time',
	'dfn',
	'q',
]

/**
 * Check if an element contains styled/formatted content (inline text styling).
 * This includes:
 * - Spans with data-cms-styled attribute (Tailwind styled)
 * - Inline HTML elements (strong, b, em, i, etc.)
 */
function hasStyledContent(el: HTMLElement): boolean {
	// Check for spans with explicit styling attribute
	if (el.querySelector('[data-cms-styled]') !== null) {
		return true
	}

	// Check for inline HTML style elements
	const selector = INLINE_STYLE_ELEMENTS.join(', ')
	return el.querySelector(selector) !== null
}

/**
 * Start edit mode - enables inline editing on all CMS elements.
 * Uses signals for state management.
 */
export async function startEditMode(
	config: CmsConfig,
	onStateChange?: () => void,
): Promise<void> {
	signals.setEditing(true)
	saveEditingState(true)
	disableAllInteractiveElements()
	initHighlightSystem()
	onStateChange?.()

	try {
		const manifest = await fetchManifest()
		signals.setManifest(manifest)
		const entryCount = getManifestEntryCount(manifest)
		logDebug(config.debug, 'Loaded manifest with', entryCount, 'entries')
	} catch (err) {
		console.error('[CMS] Failed to load manifest:', err)
		return
	}

	const savedEdits = loadEditsFromStorage()
	const savedImageEdits = loadImageEditsFromStorage()
	const savedColorEdits = loadColorEditsFromStorage()
	const savedAttributeEdits = loadAttributeEditsFromStorage()
	const savedBgImageEdits = loadBgImageEditsFromStorage()
	const currentManifest = signals.manifest.value

	getAllCmsElements().forEach(el => {
		const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)
		if (!cmsId) return

		// Skip component elements - they should not be contentEditable
		// Components are marked with data-cms-component-id and are block-level editable
		if (el.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) {
			logDebug(config.debug, 'Skipping component element:', cmsId)
			makeElementNonEditable(el)
			return
		}

		if (!hasManifestEntry(currentManifest, cmsId)) {
			logDebug(config.debug, 'Skipping element not in manifest:', cmsId)
			makeElementNonEditable(el)
			return
		}

		// Check if this is a markdown content element
		// Markdown elements use WYSIWYG editing instead of contentEditable
		if (el.hasAttribute(MARKDOWN_ATTRIBUTE)) {
			logDebug(config.debug, 'Markdown element detected:', cmsId)
			makeElementNonEditable(el)
			// Add click handler for markdown elements to open the editor
			setupMarkdownClickHandler(config, el, cmsId, onStateChange)
			return
		}

		// Check if this is an image element
		// Image elements open the media library for replacement
		if (el.hasAttribute(IMAGE_ATTRIBUTE)) {
			logDebug(config.debug, 'Image element detected:', cmsId)
			makeElementNonEditable(el)
			setupImageClickHandler(config, el as HTMLImageElement, cmsId, savedImageEdits[cmsId], onStateChange)
			return
		}

		// Check if this is a background image element
		// Background image elements are edited via the bg image overlay panel
		if (el.hasAttribute(BG_IMAGE_ATTRIBUTE)) {
			logDebug(config.debug, 'Background image element detected:', cmsId)
			makeElementNonEditable(el)
			setupBgImageTracking(config, el, cmsId, savedBgImageEdits[cmsId])
			return
		}

		makeElementEditable(el)

		// Suppress browser native contentEditable undo/redo (we handle it ourselves)
		// Also prevent Enter/Shift+Enter from inserting line breaks
		el.addEventListener('beforeinput', (e) => {
			if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
				e.preventDefault()
			}
			if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
				e.preventDefault()
			}
		})

		// Setup color tracking for elements with colorClasses in manifest
		setupColorTracking(config, el, cmsId, savedColorEdits[cmsId])

		// Setup attribute tracking for elements with editable attributes in manifest
		setupAttributeTracking(config, el, cmsId, savedAttributeEdits[cmsId])

		if (!signals.pendingChanges.value.has(cmsId)) {
			const originalHTML = el.innerHTML
			const originalText = getEditableTextFromElement(el)

			logDebug(config.debug, 'Setting up element:', cmsId, 'originalText:', originalText)

			const childCmsElements = getChildCmsElements(el)
			const savedEdit = savedEdits[cmsId]

			let currentHTML = originalHTML
			let newText = originalText
			let isDirty = false

			if (savedEdit) {
				// Use currentHTML for visual display, newText for the placeholder representation
				currentHTML = savedEdit.currentHTML
				newText = savedEdit.newText
				isDirty = true
				el.innerHTML = currentHTML
			}

			// Check for styled content after restoring HTML
			const hasStyled = hasStyledContent(el)

			signals.setPendingChange(cmsId, {
				element: el,
				originalHTML,
				originalText,
				newText,
				currentHTML,
				isDirty,
				childCmsElements,
				hasStyledContent: hasStyled,
			})
		}

		el.addEventListener('input', (e) => {
			const currentId = signals.currentEditingId.value
			logDebug(
				config.debug,
				'Input event on',
				cmsId,
				'currentEditingId:',
				currentId,
				'target:',
				(e.target as HTMLElement).getAttribute('data-cms-id'),
			)
			if (currentId === cmsId) {
				e.stopPropagation()
				logDebug(config.debug, 'Handling input for', cmsId)
				handleElementChange(config, cmsId, el, onStateChange)
			} else {
				logDebug(config.debug, 'Skipping input - not current editing element, expected:', currentId)
			}
		})

		el.addEventListener(
			'click',
			(e) => {
				if (e.detail !== 1) return

				const innermostCms = findInnermostCmsElement(e.target)

				if (innermostCms) {
					const targetId = innermostCms.getAttribute('data-cms-id')
					innermostCms.focus()
					signals.setCurrentEditingId(targetId)
					// Update chat context if chat is open
					if (signals.isChatOpen.value && targetId) {
						signals.setChatContextElement(targetId)
					}
					logDebug(config.debug, 'Click - focusing innermost CMS element:', targetId)
					onStateChange?.()
				}
			},
			true,
		)

		el.addEventListener(
			'focus',
			(e) => {
				if (e.target === el) {
					signals.setCurrentEditingId(cmsId)
					// Update chat context if chat is open
					if (signals.isChatOpen.value && cmsId) {
						signals.setChatContextElement(cmsId)
					}
					logDebug(config.debug, 'Focus on', cmsId)
					onStateChange?.()
				}
			},
			false,
		)

		el.addEventListener('blur', (e) => {
			// Don't clear currentEditingId if clicking on CMS UI elements
			const relatedTarget = (e as FocusEvent).relatedTarget as HTMLElement | null

			// Check if we're focusing on another CMS element
			if (relatedTarget?.hasAttribute(CSS.ID_ATTRIBUTE)) {
				return // Let the new element's focus handler set the ID
			}

			// Check if we're clicking on CMS UI (toolbar, tooltip, chat) using data-cms-ui attribute
			if (relatedTarget?.hasAttribute(CSS.UI_ATTRIBUTE) || relatedTarget?.closest(`[${CSS.UI_ATTRIBUTE}]`)) {
				return // Keep current selection
			}

			// Allow a small delay to check if we're clicking inside CMS UI
			setTimeout(() => {
				const activeElement = document.activeElement as HTMLElement | null

				// Check if active element is inside CMS UI
				if (activeElement?.hasAttribute(CSS.UI_ATTRIBUTE) || activeElement?.closest(`[${CSS.UI_ATTRIBUTE}]`)) {
					return // Keep current selection
				}

				// Only clear if we actually lost focus to something else
				if (signals.currentEditingId.value === cmsId) {
					signals.setCurrentEditingId(null)
					onStateChange?.()
				}
			}, TIMING.BLUR_DELAY_MS)
		})
	})

	// Check for pending entry navigation (from collections browser cross-page navigation)
	const pendingEntry = loadPendingEntryNavigation()
	if (pendingEntry) {
		const collectionDef = signals.manifest.value.collectionDefinitions?.[pendingEntry.collectionName]
		if (collectionDef) {
			signals.openMarkdownEditorForEntry(
				pendingEntry.collectionName,
				pendingEntry.slug,
				pendingEntry.sourcePath,
				collectionDef,
			)
		}
	}
}

/**
 * Stop edit mode - disables inline editing.
 */
export function stopEditMode(onStateChange?: () => void): void {
	signals.setEditing(false)
	saveEditingState(false)
	signals.setShowingOriginal(false)
	// Only re-enable interactive elements if select mode is not active
	if (!signals.isSelectMode.value) {
		enableAllInteractiveElements()
	}
	cleanupHighlightSystem()
	onStateChange?.()

	// Close all open dialogs
	signals.closeAttributeEditor()
	signals.closeSeoEditor()
	signals.closeColorEditor()
	signals.resetMediaLibraryState()
	signals.resetMarkdownEditorState()
	signals.resetCreatePageState()

	getAllCmsElements().forEach(el => {
		makeElementNonEditable(el)
	})
}

/**
 * Handle element content change - tracks dirty state.
 */
export function handleElementChange(
	config: CmsConfig,
	cmsId: string,
	el: HTMLElement,
	onStateChange?: () => void,
): void {
	logDebug(config.debug, 'handleElementChange called for', cmsId)
	const change = signals.getPendingChange(cmsId)

	if (!change) {
		logDebug(config.debug, 'ERROR: No change tracked for', cmsId)
		logDebug(config.debug, 'Available IDs in pendingChanges:', Array.from(signals.pendingChanges.value.keys()))
		logDebug(config.debug, 'Element:', el.tagName, el.textContent?.substring(0, 50))
		return
	}

	const newHTML = el.innerHTML
	const hasStyled = hasStyledContent(el)

	// For styled content, use innerHTML as newText to preserve the styled spans
	// For plain text, use the extracted text
	const newText = hasStyled ? getEditableHtmlFromElement(el) : getEditableTextFromElement(el)

	const textChanged = newText !== change.originalText
	// Also consider as changed if HTML differs (e.g., styling like bold was applied)
	const htmlChanged = newHTML !== change.originalHTML
	const isDirty = textChanged || htmlChanged

	const updatedChildElements = change.childCmsElements?.map(child => {
		const childEl = el.querySelector(`[data-cms-id="${child.id}"]`)
		if (childEl) {
			return { ...child, currentHTML: childEl.outerHTML }
		}
		return child
	})

	// Record undo action before updating signal
	if (!isApplyingUndoRedo) {
		recordTextChange({
			type: 'text',
			cmsId,
			element: el,
			previousHTML: change.currentHTML,
			previousText: change.newText,
			currentHTML: newHTML,
			currentText: newText,
			wasDirty: change.isDirty,
		})
	}

	// Update the change in signals
	signals.updatePendingChange(cmsId, (c) => ({
		...c,
		newText,
		currentHTML: newHTML,
		isDirty,
		childCmsElements: updatedChildElements,
		hasStyledContent: hasStyled,
	}))

	logDebug(config.debug, `Change tracked for ${cmsId}:`, {
		originalText: change.originalText,
		newText,
		isDirty,
		textChanged,
		htmlChanged,
		hasStyledContent: hasStyled,
	})

	saveEditsToStorage(signals.pendingChanges.value)
	onStateChange?.()
}

/**
 * Toggle showing original content vs edited content.
 */
export function toggleShowOriginal(
	config: CmsConfig,
	onStateChange?: () => void,
): void {
	const newShowingOriginal = !signals.showingOriginal.value
	signals.setShowingOriginal(newShowingOriginal)

	signals.pendingChanges.value.forEach((change) => {
		if (newShowingOriginal) {
			change.element.innerHTML = change.originalHTML
			makeElementNonEditable(change.element)
		} else {
			change.element.innerHTML = change.currentHTML || change.originalHTML
			makeElementEditable(change.element)
		}
	})

	// Toggle image sources between original and new
	signals.pendingImageChanges.value.forEach((change) => {
		if (newShowingOriginal) {
			change.element.src = change.originalSrc
			change.element.alt = change.originalAlt
			// Restore original srcset when showing original
			if (change.originalSrcSet) {
				change.element.setAttribute('srcset', change.originalSrcSet)
			}
		} else {
			change.element.src = change.newSrc
			change.element.alt = change.newAlt
			// Clear srcset when showing new image so browser uses src
			if (change.isDirty) {
				change.element.removeAttribute('srcset')
			}
		}
	})

	onStateChange?.()
}

/**
 * Discard all pending changes and restore original content.
 * Note: Confirmation is handled by the caller (e.g., toolbar).
 */
export function discardAllChanges(onStateChange?: () => void): void {
	signals.pendingChanges.value.forEach((change) => {
		change.element.innerHTML = change.originalHTML
		makeElementNonEditable(change.element)
	})

	// Restore original image sources
	signals.pendingImageChanges.value.forEach((change) => {
		change.element.src = change.originalSrc
		change.element.alt = change.originalAlt
		// Restore original srcset
		if (change.originalSrcSet) {
			change.element.setAttribute('srcset', change.originalSrcSet)
		}
	})

	// Restore original color classes
	signals.pendingColorChanges.value.forEach((change) => {
		const { element, originalClasses, newClasses } = change
		// Remove new color classes and add back original ones
		const classes = element.className.split(/\s+/).filter(Boolean)
		const newClassValues = new Set(Object.values(newClasses).map(a => a.value).filter(Boolean))
		const originalClassValues = new Set(Object.values(originalClasses).map(a => a.value).filter(Boolean))

		// Filter out new classes
		const filtered = classes.filter(c => !newClassValues.has(c))
		// Add back original classes
		originalClassValues.forEach(c => {
			if (!filtered.includes(c)) {
				filtered.push(c)
			}
		})
		element.className = filtered.join(' ')

		// Clear inline color styles
		element.style.backgroundColor = ''
		element.style.color = ''
	})

	// Restore original attributes
	signals.pendingAttributeChanges.value.forEach((change) => {
		const { element, originalAttributes } = change
		applyAttributesToElement(element, originalAttributes)
	})

	// Restore original background image classes
	signals.pendingBgImageChanges.value.forEach((change) => {
		const {
			element,
			originalBgImageClass,
			newBgImageClass,
			originalBgSize,
			newBgSize,
			originalBgPosition,
			newBgPosition,
			originalBgRepeat,
			newBgRepeat,
		} = change
		const classes = element.className.split(/\s+/).filter(Boolean)
		const newClassValues = new Set([newBgImageClass, newBgSize, newBgPosition, newBgRepeat].filter(Boolean))
		const originalClassValues = [originalBgImageClass, originalBgSize, originalBgPosition, originalBgRepeat].filter(Boolean)

		const filtered = classes.filter(c => !newClassValues.has(c))
		for (const c of originalClassValues) {
			if (!filtered.includes(c)) {
				filtered.push(c)
			}
		}
		element.className = filtered.join(' ')

		// Clear inline bg style overrides
		element.style.backgroundImage = ''
		element.style.backgroundSize = ''
		element.style.backgroundPosition = ''
		element.style.backgroundRepeat = ''
	})

	cleanupHighlightSystem()
	for (const entry of Object.values(signals.changeRegistry)) {
		entry.mapSignal.value = new Map()
	}
	clearAllEditsFromStorage()
	clearHistory()
	stopEditMode(onStateChange)
}

function findSeoSourceById(
	seoData: import('./types').PageSeoData | undefined,
	id: string,
): { sourcePath: string; sourceLine: number; sourceSnippet: string; content: string } | null {
	if (!seoData) return null

	const fields = [
		seoData.title,
		seoData.description,
		seoData.keywords,
		seoData.canonical,
		...(seoData.openGraph ? Object.values(seoData.openGraph) : []),
		...(seoData.twitterCard ? Object.values(seoData.twitterCard) : []),
	]

	for (const field of fields) {
		if (field && (field as any).id === id) {
			return {
				sourcePath: field.sourcePath ?? '',
				sourceLine: field.sourceLine ?? 0,
				sourceSnippet: field.sourceSnippet ?? '',
				content: (field as any).content ?? (field as any).href ?? '',
			}
		}
	}
	return null
}

/**
 * Save all dirty changes to the server.
 */
export async function saveAllChanges(
	config: CmsConfig,
	onStateChange?: () => void,
): Promise<{ success: boolean; updated: number; errors?: Array<{ cmsId: string; error: string }> }> {
	const dirtyChanges = signals.dirtyChanges.value
	const dirtyImageChanges = signals.dirtyImageChanges.value
	const dirtyColorChanges = signals.dirtyColorChanges.value
	const dirtyBgImageChanges = signals.dirtyBgImageChanges.value
	const dirtyAttributeChanges = signals.dirtyAttributeChanges.value
	const dirtySeoChanges = signals.dirtySeoChanges.value

	if (
		dirtyChanges.length === 0 && dirtyImageChanges.length === 0 && dirtyColorChanges.length === 0 && dirtyBgImageChanges.length === 0
		&& dirtyAttributeChanges.length === 0 && dirtySeoChanges.length === 0
	) {
		return { success: true, updated: 0 }
	}

	signals.isSaving.value = true
	try {
		const manifest = signals.manifest.value
		console.log('[CMS] Manifest entries keys:', Object.keys(manifest.entries).slice(0, 10))

		const changes: ChangePayload[] = dirtyChanges.map(([cmsId, change]) => {
			const entry = manifest.entries[cmsId]

			// Debug: log entry lookup
			if (!entry) {
				console.warn(`[CMS] No manifest entry found for ${cmsId}. Available keys:`, Object.keys(manifest.entries))
			} else if (!entry.sourcePath) {
				console.warn(`[CMS] Entry ${cmsId} has no sourcePath:`, JSON.stringify(entry, null, 2))
			}

			const payload: ChangePayload = {
				cmsId,
				newValue: change.newText,
				originalValue: entry?.text ?? change.originalText,
				sourcePath: entry?.sourcePath ?? '',
				sourceLine: entry?.sourceLine ?? 0,
				sourceSnippet: entry?.sourceSnippet ?? '',
			}

			if (change.childCmsElements && change.childCmsElements.length > 0) {
				payload.childCmsIds = change.childCmsElements.map(c => c.id)
			}

			// Include HTML content when there are styled spans
			if (change.hasStyledContent) {
				payload.hasStyledContent = true
				payload.htmlValue = getEditableHtmlFromElement(change.element)
			}

			return payload
		})

		// Add image changes to the payload
		dirtyImageChanges.forEach(([cmsId, change]) => {
			const entry = manifest.entries[cmsId]
			changes.push({
				cmsId,
				newValue: change.newSrc,
				originalValue: change.originalSrc,
				sourcePath: entry?.sourcePath ?? '',
				sourceLine: entry?.sourceLine ?? 0,
				sourceSnippet: entry?.sourceSnippet ?? '',
				imageChange: {
					newSrc: change.newSrc,
					newAlt: change.newAlt,
				},
			})
		})

		// Add color changes to the payload
		dirtyColorChanges.forEach(([cmsId, change]) => {
			// For each color type that changed, add a separate change entry
			const { originalClasses, newClasses } = change
			const entry = manifest.entries[cmsId]
			const classTypes = ['bg', 'text', 'border', 'hoverBg', 'hoverText', 'fontWeight', 'fontStyle', 'textDecoration', 'fontSize'] as const

			// Find the best source info from any color type that has it
			// (all color types share the same class attribute on the same element)
			let sharedSourcePath: string | undefined
			let sharedSourceLine: number | undefined
			let sharedSourceSnippet: string | undefined
			for (const ct of classTypes) {
				const orig = originalClasses[ct]
				const curr = newClasses[ct]
				const sp = curr?.sourcePath ?? orig?.sourcePath
				const sl = curr?.sourceLine ?? orig?.sourceLine
				if (sp && sl) {
					sharedSourcePath = sp
					sharedSourceLine = sl
					sharedSourceSnippet = curr?.sourceSnippet ?? orig?.sourceSnippet
					break
				}
			}

			for (const classType of classTypes) {
				const origAttr = originalClasses[classType]
				const newAttr = newClasses[classType]
				if (newAttr && newAttr.value !== (origAttr?.value ?? '')) {
					const bestSourcePath = newAttr.sourcePath ?? origAttr?.sourcePath ?? sharedSourcePath
					const bestSourceLine = newAttr.sourceLine ?? origAttr?.sourceLine ?? sharedSourceLine
					const bestSourceSnippet = newAttr.sourceSnippet ?? origAttr?.sourceSnippet ?? sharedSourceSnippet
					changes.push({
						cmsId,
						newValue: '',
						originalValue: '',
						sourcePath: bestSourcePath ?? entry?.sourcePath ?? '',
						sourceLine: bestSourceLine ?? entry?.sourceLine ?? 0,
						sourceSnippet: bestSourceSnippet ?? entry?.sourceSnippet ?? '',
						styleChange: {
							oldClass: origAttr?.value || '',
							newClass: newAttr.value,
							type: classType,
							sourcePath: bestSourcePath,
							sourceLine: bestSourceLine,
							sourceSnippet: bestSourceSnippet,
						},
					})
				}
			}
		})

		// Add background image changes to the payload
		dirtyBgImageChanges.forEach(([cmsId, change]) => {
			const entry = manifest.entries[cmsId]
			const bgChanges: Array<{ oldClass: string; newClass: string; type: 'bgImage' | 'bgSize' | 'bgPosition' | 'bgRepeat' }> = []

			if (change.newBgImageClass !== change.originalBgImageClass) {
				bgChanges.push({ oldClass: change.originalBgImageClass, newClass: change.newBgImageClass, type: 'bgImage' })
			}
			if (change.newBgSize !== change.originalBgSize) {
				bgChanges.push({ oldClass: change.originalBgSize, newClass: change.newBgSize, type: 'bgSize' })
			}
			if (change.newBgPosition !== change.originalBgPosition) {
				bgChanges.push({ oldClass: change.originalBgPosition, newClass: change.newBgPosition, type: 'bgPosition' })
			}
			if (change.newBgRepeat !== change.originalBgRepeat) {
				bgChanges.push({ oldClass: change.originalBgRepeat, newClass: change.newBgRepeat, type: 'bgRepeat' })
			}

			for (const bgChange of bgChanges) {
				changes.push({
					cmsId,
					newValue: '',
					originalValue: '',
					sourcePath: entry?.sourcePath ?? '',
					sourceLine: entry?.sourceLine ?? 0,
					sourceSnippet: entry?.sourceSnippet ?? '',
					styleChange: {
						oldClass: bgChange.oldClass,
						newClass: bgChange.newClass,
						type: bgChange.type,
						sourcePath: entry?.sourcePath,
						sourceLine: entry?.sourceLine,
						sourceSnippet: entry?.sourceSnippet,
					},
				})
			}
		})

		// Add attribute changes to the payload
		dirtyAttributeChanges.forEach(([cmsId, change]) => {
			const { originalAttributes, newAttributes } = change
			const entry = manifest.entries[cmsId]
			const attributeChanges = buildAttributeChangePayload(originalAttributes, newAttributes)

			if (attributeChanges.length > 0) {
				// Use source info from first changed attribute, or fall back to element-level
				const firstChange = attributeChanges[0]!
				changes.push({
					cmsId,
					newValue: '',
					originalValue: '',
					sourcePath: firstChange.sourcePath ?? entry?.sourcePath ?? '',
					sourceLine: firstChange.sourceLine ?? entry?.sourceLine ?? 0,
					sourceSnippet: firstChange.sourceSnippet ?? entry?.sourceSnippet ?? '',
					attributeChanges,
				})
			}
		})

		// Add SEO changes to the payload
		dirtySeoChanges.forEach(([cmsId, change]) => {
			const seoData = (manifest as any).seo as import('./types').PageSeoData | undefined
			const sourceInfo = findSeoSourceById(seoData, cmsId)
			changes.push({
				cmsId,
				newValue: change.newValue,
				originalValue: sourceInfo?.content ?? change.originalValue,
				sourcePath: sourceInfo?.sourcePath ?? '',
				sourceLine: sourceInfo?.sourceLine ?? 0,
				sourceSnippet: sourceInfo?.sourceSnippet ?? '',
			})
		})

		const result = await saveBatchChanges(config.apiBase, {
			changes,
			meta: {
				source: 'inline-editor',
				url: window.location.href,
			},
		})

		// Update all dirty text changes to mark as saved
		signals.batch(() => {
			dirtyChanges.forEach(([cmsId, change]) => {
				signals.updatePendingChange(cmsId, (c) => ({
					...c,
					originalText: c.newText,
					originalHTML: c.element.innerHTML,
					currentHTML: c.element.innerHTML,
					isDirty: false,
				}))
			})

			// Update all dirty image changes to mark as saved
			dirtyImageChanges.forEach(([cmsId, change]) => {
				signals.updatePendingImageChange(cmsId, (c) => ({
					...c,
					originalSrc: c.newSrc,
					originalAlt: c.newAlt,
					isDirty: false,
				}))
			})

			// Update all dirty color changes to mark as saved
			dirtyColorChanges.forEach(([cmsId, change]) => {
				signals.updatePendingColorChange(cmsId, (c) => ({
					...c,
					originalClasses: { ...c.newClasses },
					isDirty: false,
				}))
			})

			// Update all dirty bg image changes to mark as saved
			dirtyBgImageChanges.forEach(([cmsId, change]) => {
				signals.updatePendingBgImageChange(cmsId, (c) => ({
					...c,
					originalBgImageClass: c.newBgImageClass,
					originalBgSize: c.newBgSize,
					originalBgPosition: c.newBgPosition,
					originalBgRepeat: c.newBgRepeat,
					isDirty: false,
				}))
			})

			// Update all dirty attribute changes to mark as saved
			dirtyAttributeChanges.forEach(([cmsId, change]) => {
				signals.updatePendingAttributeChange(cmsId, (c) => ({
					...c,
					originalAttributes: { ...c.newAttributes },
					isDirty: false,
				}))
			})

			// Update all dirty SEO changes to mark as saved
			dirtySeoChanges.forEach(([cmsId, change]) => {
				signals.updatePendingSeoChange(cmsId, (c) => ({
					...c,
					originalValue: c.newValue,
					isDirty: false,
				}))
			})
		})

		clearAllEditsFromStorage()
		clearHistory()

		// Close all open dialogs after save
		signals.closeAttributeEditor()
		signals.closeSeoEditor()
		signals.closeColorEditor()
		signals.resetMediaLibraryState()
		signals.resetMarkdownEditorState()
		signals.resetCreatePageState()

		if (result.errors && result.errors.length > 0) {
			console.error('[CMS] Save errors:', result.errors)
			return { success: false, updated: result.updated, errors: result.errors }
		}

		// Start polling for deployment status after successful save
		startDeploymentPolling(config)

		onStateChange?.()
		return { success: true, updated: result.updated }
	} catch (err) {
		console.error('[CMS] Save failed:', err)
		// Save all edits to storage on failure so they can be recovered
		saveEditsToStorage(signals.pendingChanges.value)
		saveImageEditsToStorage(signals.pendingImageChanges.value)
		saveColorEditsToStorage(signals.pendingColorChanges.value)
		saveBgImageEditsToStorage(signals.pendingBgImageChanges.value)
		saveAttributeEditsToStorage(signals.pendingAttributeChanges.value)
		throw err
	} finally {
		signals.isSaving.value = false
	}
}

/**
 * Setup click handler for markdown elements.
 * When a markdown element is clicked, it opens the WYSIWYG editor instead of using contentEditable.
 */
function setupMarkdownClickHandler(
	config: CmsConfig,
	el: HTMLElement,
	cmsId: string,
	_onStateChange?: () => void,
): void {
	// Add visual indicator that this is a markdown-editable element
	el.style.cursor = 'pointer'

	el.addEventListener('click', async (e) => {
		e.preventDefault()
		e.stopPropagation()

		logDebug(config.debug, 'Markdown element clicked:', cmsId)

		// Refresh manifest to get the latest content
		try {
			const newManifest = await fetchManifest()
			signals.setManifest(newManifest)
		} catch (err) {
			console.error('[CMS] Failed to refresh manifest:', err)
			// Continue with current manifest if refresh fails
		}

		// Get the manifest entry to find the markdown file path
		const manifest = signals.manifest.value
		const entry = manifest.entries[cmsId] as ManifestEntry | undefined

		if (!entry) {
			signals.showToast('Markdown element not found in manifest', 'error')
			return
		}

		// Check if it has a content path for markdown
		const contentPath = entry.contentPath
		if (!contentPath) {
			signals.showToast('No markdown file path configured for this element', 'error')
			return
		}

		// Fetch the markdown content from the API
		try {
			const result = await getMarkdownContent(config.apiBase, contentPath)

			if (!result) {
				signals.showToast('Markdown content not found', 'error')
				return
			}

			// Set the markdown page data
			signals.setMarkdownPage({
				filePath: result.filePath,
				slug: entry.collectionSlug || '',
				frontmatter: result.frontmatter as import('./types').BlogFrontmatter,
				content: result.content,
				isDirty: false,
			})

			// Set the markdown editor to open with this element
			signals.setMarkdownActiveElement(cmsId)
			signals.setMarkdownEditorOpen(true)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error'
			signals.showToast(`Failed to load markdown: ${message}`, 'error')
			logDebug(config.debug, 'Failed to fetch markdown content:', error)
		}
	})
}

/**
 * Setup click handler for image elements.
 * When an image is clicked, it opens the media library to select a replacement.
 */
function setupImageClickHandler(
	config: CmsConfig,
	el: HTMLImageElement,
	cmsId: string,
	savedEdit: import('./types').SavedImageEdit | undefined,
	onStateChange?: () => void,
): void {
	// Add visual indicator that this is a replaceable image
	el.style.cursor = 'pointer'

	// Store original values for change tracking
	// Use getAttribute to get the original attribute value (e.g., "/assets/image.webp")
	// instead of .src which returns the fully resolved URL (e.g., "http://localhost/assets/image.webp")
	const originalSrc = el.getAttribute('src') || el.src
	const originalAlt = el.alt || ''
	const originalSrcSet = el.getAttribute('srcset') || ''

	// Initialize pending image change if not already tracked
	if (!signals.pendingImageChanges.value.has(cmsId)) {
		// Restore saved edit if present
		if (savedEdit) {
			el.src = savedEdit.newSrc
			el.alt = savedEdit.newAlt
			// Clear srcset so browser uses the new src
			el.removeAttribute('srcset')
			signals.setPendingImageChange(cmsId, {
				element: el,
				originalSrc: savedEdit.originalSrc,
				newSrc: savedEdit.newSrc,
				originalAlt: savedEdit.originalAlt,
				newAlt: savedEdit.newAlt,
				originalSrcSet: savedEdit.originalSrcSet ?? originalSrcSet,
				isDirty: true,
			})
			logDebug(config.debug, 'Restored saved image edit:', cmsId, savedEdit)
		} else {
			signals.setPendingImageChange(cmsId, {
				element: el,
				originalSrc,
				newSrc: originalSrc,
				originalAlt,
				newAlt: originalAlt,
				originalSrcSet,
				isDirty: false,
			})
		}
	}

	el.addEventListener('click', (e) => {
		e.preventDefault()
		e.stopPropagation()

		logDebug(config.debug, 'Image element clicked:', cmsId)

		// Open media library with callback to handle image replacement
		signals.openMediaLibraryWithCallback((url: string, alt: string) => {
			logDebug(config.debug, 'Image replacement selected:', { cmsId, url, alt })

			// Record undo action before mutation
			const currentChange = signals.getPendingImageChange(cmsId)
			if (!isApplyingUndoRedo && currentChange) {
				recordChange({
					type: 'image',
					cmsId,
					element: el,
					previousSrc: currentChange.newSrc,
					previousAlt: currentChange.newAlt,
					currentSrc: url,
					currentAlt: alt || currentChange.originalAlt,
					wasDirty: currentChange.isDirty,
				})
			}

			// Update the image element
			el.src = url
			// Clear srcset so browser uses the new src
			el.removeAttribute('srcset')
			if (alt) {
				el.alt = alt
			}

			// Track the change
			const isDirty = url !== (currentChange?.originalSrc ?? originalSrc)

			signals.updatePendingImageChange(cmsId, (change) => ({
				...change,
				newSrc: url,
				newAlt: alt || change.originalAlt,
				isDirty,
			}))

			saveImageEditsToStorage(signals.pendingImageChanges.value)
			onStateChange?.()
		})
	})
}

/**
 * Initialize color change tracking for elements with color classes.
 * Color editing is now triggered via the outline component's color swatches.
 */
function setupColorTracking(
	config: CmsConfig,
	el: HTMLElement,
	cmsId: string,
	savedEdit: import('./types').SavedColorEdit | undefined,
): void {
	// Get the manifest entry to find the color classes
	const manifest = signals.manifest.value
	const entry = manifest.entries[cmsId]

	if (!entry?.colorClasses) {
		return
	}

	logDebug(config.debug, 'Setting up color tracking for:', cmsId, entry.colorClasses)

	// Initialize pending color change if not already tracked
	if (!signals.pendingColorChanges.value.has(cmsId)) {
		// Restore saved edit if present
		if (savedEdit) {
			// Apply saved color classes to the element
			const classes = el.className.split(/\s+/).filter(Boolean)
			const originalClassValues = new Set(Object.values(savedEdit.originalClasses).map(a => a.value).filter(Boolean))
			const newClassValues = new Set(Object.values(savedEdit.newClasses).map(a => a.value).filter(Boolean))

			// Remove original classes and add new ones
			const filtered = classes.filter(c => !originalClassValues.has(c))
			newClassValues.forEach(c => {
				if (!filtered.includes(c)) {
					filtered.push(c)
				}
			})
			el.className = filtered.join(' ')

			signals.setPendingColorChange(cmsId, {
				element: el,
				cmsId,
				originalClasses: savedEdit.originalClasses,
				newClasses: savedEdit.newClasses,
				isDirty: true,
			})
			logDebug(config.debug, 'Restored saved color edit:', cmsId, savedEdit)
		} else {
			const originalClasses = deepCopyColorClasses(entry.colorClasses)
			signals.setPendingColorChange(cmsId, {
				element: el,
				cmsId,
				originalClasses,
				newClasses: deepCopyColorClasses(entry.colorClasses),
				isDirty: false,
			})
		}
	}
}

/**
 * Initialize background image change tracking for elements with bg-[url()] classes.
 * Background image editing is triggered via the bg image overlay panel.
 */
function setupBgImageTracking(
	config: CmsConfig,
	el: HTMLElement,
	cmsId: string,
	savedEdit: import('./types').SavedBackgroundImageEdit | undefined,
): void {
	const manifest = signals.manifest.value
	const entry = manifest.entries[cmsId]

	if (!entry?.backgroundImage) {
		return
	}

	logDebug(config.debug, 'Setting up bg image tracking for:', cmsId, entry.backgroundImage)

	if (!signals.pendingBgImageChanges.value.has(cmsId)) {
		if (savedEdit) {
			// Restore saved bg image classes on the element
			const classes = el.className.split(/\s+/).filter(Boolean)
			const originals = [savedEdit.originalBgImageClass, savedEdit.originalBgSize, savedEdit.originalBgPosition, savedEdit.originalBgRepeat].filter(
				Boolean,
			)
			const news = [savedEdit.newBgImageClass, savedEdit.newBgSize, savedEdit.newBgPosition, savedEdit.newBgRepeat].filter(Boolean)

			const filtered = classes.filter(c => !originals.includes(c))
			for (const c of news) {
				if (!filtered.includes(c)) {
					filtered.push(c)
				}
			}
			el.className = filtered.join(' ')

			signals.setPendingBgImageChange(cmsId, {
				element: el,
				cmsId,
				originalBgImageClass: savedEdit.originalBgImageClass,
				newBgImageClass: savedEdit.newBgImageClass,
				originalBgSize: savedEdit.originalBgSize,
				newBgSize: savedEdit.newBgSize,
				originalBgPosition: savedEdit.originalBgPosition,
				newBgPosition: savedEdit.newBgPosition,
				originalBgRepeat: savedEdit.originalBgRepeat,
				newBgRepeat: savedEdit.newBgRepeat,
				isDirty: true,
			})
			logDebug(config.debug, 'Restored saved bg image edit:', cmsId, savedEdit)
		} else {
			const bg = entry.backgroundImage
			signals.setPendingBgImageChange(cmsId, {
				element: el,
				cmsId,
				originalBgImageClass: bg.bgImageClass,
				newBgImageClass: bg.bgImageClass,
				originalBgSize: bg.bgSize ?? '',
				newBgSize: bg.bgSize ?? '',
				originalBgPosition: bg.bgPosition ?? '',
				newBgPosition: bg.bgPosition ?? '',
				originalBgRepeat: bg.bgRepeat ?? '',
				newBgRepeat: bg.bgRepeat ?? '',
				isDirty: false,
			})
		}
	}
}

/**
 * Handle color change from the color toolbar.
 * Called when user selects a new color.
 */
export function handleColorChange(
	config: CmsConfig,
	cmsId: string,
	colorType: string,
	oldClass: string,
	newClass: string,
	onStateChange?: () => void,
	previousClassName?: string,
	previousStyleCssText?: string,
): void {
	const change = signals.getPendingColorChange(cmsId)
	if (!change) {
		logDebug(config.debug, 'No color change tracked for', cmsId)
		return
	}

	// Record undo action (DOM is already mutated by applyColorChange in color-toolbar)
	if (!isApplyingUndoRedo && previousClassName !== undefined) {
		const prevClasses: Record<string, Attribute> = {}
		for (const [key, attr] of Object.entries(change.newClasses)) {
			prevClasses[key] = { ...attr }
		}

		// Compute what the new classes will be after this change
		const nextClasses: Record<string, Attribute> = { ...change.newClasses }
		const existingAttrForNext = nextClasses[colorType] || change.originalClasses[colorType]
		nextClasses[colorType] = { ...(existingAttrForNext || {}), value: newClass }

		recordChange({
			type: 'color',
			cmsId,
			element: change.element,
			previousClassName,
			currentClassName: change.element.className, // Already mutated by applyColorChange
			previousStyleCssText: previousStyleCssText ?? '',
			currentStyleCssText: change.element.style.cssText, // Already mutated by applyColorChange
			previousClasses: prevClasses,
			currentClasses: nextClasses,
			wasDirty: change.isDirty,
		})
	}

	// Update the new classes - preserve source info from original, update value
	const newClasses = { ...change.newClasses }
	const existingAttr = newClasses[colorType] || change.originalClasses[colorType]
	newClasses[colorType] = {
		...(existingAttr || {}),
		value: newClass,
	}

	// Check if dirty (any class value different from original)
	let isDirty = false
	const allKeys = new Set([...Object.keys(change.originalClasses), ...Object.keys(newClasses)])
	for (const key of allKeys) {
		if (change.originalClasses[key]?.value !== newClasses[key]?.value) {
			isDirty = true
			break
		}
	}

	signals.updatePendingColorChange(cmsId, (c) => ({
		...c,
		newClasses,
		isDirty,
	}))

	logDebug(config.debug, 'Color change recorded:', { cmsId, colorType, oldClass, newClass, isDirty })

	saveColorEditsToStorage(signals.pendingColorChanges.value)
	onStateChange?.()
}

// ============================================================================
// Deployment Status Polling
// ============================================================================

const DEPLOYMENT_POLL_INTERVAL_MS = 3000
const DEPLOYMENT_SUCCESS_HIDE_DELAY_MS = 5000
const DEPLOYMENT_INITIAL_DELAY_MS = 2000
const DEPLOYMENT_MAX_WAIT_ATTEMPTS = 10 // Keep polling for up to 30 seconds waiting for deployment to start

let deploymentPollTimer: ReturnType<typeof setInterval> | null = null
let deploymentHideTimer: ReturnType<typeof setTimeout> | null = null
let deploymentWaitAttempts = 0
let deploymentStartTimestamp: string | null = null
let deploymentCallback: ((status: 'completed' | 'failed' | 'timeout') => void) | null = null

export interface DeploymentPollingOptions {
	/** Called when deployment completes, fails, or times out */
	onComplete?: (status: 'completed' | 'failed' | 'timeout') => void
}

/**
 * Start polling for deployment status after a save operation.
 * Polls the API every 3 seconds until deployment completes or fails.
 * Waits for deployment to appear for up to 30 seconds before giving up.
 * Skips polling entirely when deployment is not available (e.g. local dev).
 */
export async function startDeploymentPolling(config: CmsConfig, options?: DeploymentPollingOptions): Promise<void> {
	// Clear any existing timers
	stopDeploymentPolling()

	// Do a preflight check to see if deployment is available
	try {
		const preflight = await getDeploymentStatus(config.apiBase)
		if (preflight.deploymentEnabled === false) {
			// Deployment not available (e.g. local dev) — skip polling entirely
			return
		}
	} catch {
		// If we can't even reach the endpoint, skip polling
		return
	}

	// Reset wait attempts counter and store the timestamp when we started
	deploymentWaitAttempts = 0
	deploymentStartTimestamp = new Date().toISOString()
	deploymentCallback = options?.onComplete ?? null

	// Set initial status to indicate deployment started
	signals.updateDeploymentState({
		status: 'pending',
		isPolling: true,
		error: null,
	})

	const poll = async () => {
		try {
			const status: DeploymentStatusResponse = await getDeploymentStatus(config.apiBase)

			if (status.currentDeployment) {
				// Found an active deployment - reset wait counter
				deploymentWaitAttempts = 0

				signals.updateDeploymentState({
					status: status.currentDeployment.status,
				})

				// Check if deployment is still active
				const isActive = ['pending', 'queued', 'running'].includes(status.currentDeployment.status)

				if (!isActive) {
					// Deployment finished
					const cb = deploymentCallback
					stopDeploymentPolling()

					if (status.currentDeployment.status === 'completed') {
						// Update last deployed timestamp
						if (status.lastSuccessfulDeployment) {
							signals.setLastDeployedAt(status.lastSuccessfulDeployment.completedAt)
						}

						// Auto-hide after 5 seconds for successful deployments
						deploymentHideTimer = setTimeout(() => {
							signals.resetDeploymentState()
						}, DEPLOYMENT_SUCCESS_HIDE_DELAY_MS)

						cb?.('completed')
					} else {
						// For failed deployments, keep showing until user dismisses
						cb?.('failed')
					}
				}
			} else {
				// No active deployment found
				deploymentWaitAttempts++

				// Check if we have a recent successful deployment (completed after we started polling)
				if (status.lastSuccessfulDeployment && deploymentStartTimestamp) {
					const lastDeployTime = new Date(status.lastSuccessfulDeployment.completedAt).getTime()
					const startTime = new Date(deploymentStartTimestamp).getTime()

					if (lastDeployTime > startTime) {
						// Deployment completed after we started - show success
						signals.updateDeploymentState({
							status: 'completed',
							lastDeployedAt: status.lastSuccessfulDeployment.completedAt,
							isPolling: false,
						})

						// Auto-hide after 5 seconds
						deploymentHideTimer = setTimeout(() => {
							signals.resetDeploymentState()
						}, DEPLOYMENT_SUCCESS_HIDE_DELAY_MS)

						const cb = deploymentCallback
						stopDeploymentPolling()
						cb?.('completed')
						return
					}
				}

				// Keep waiting if we haven't exceeded max attempts
				if (deploymentWaitAttempts >= DEPLOYMENT_MAX_WAIT_ATTEMPTS) {
					// Give up waiting - deployment may have failed to start
					console.warn('[CMS] No deployment found after waiting, giving up')
					const cb = deploymentCallback
					signals.resetDeploymentState()
					stopDeploymentPolling()
					cb?.('timeout')
				}
				// Otherwise keep polling with "pending" status
			}
		} catch (error) {
			console.error('[CMS] Failed to fetch deployment status:', error)
			signals.updateDeploymentState({
				status: 'failed',
				error: error instanceof Error ? error.message : 'Unknown error',
				isPolling: false,
			})
			const cb = deploymentCallback
			stopDeploymentPolling()
			cb?.('failed')
		}
	}

	// Delay initial poll to allow deployment to be registered
	setTimeout(() => {
		poll()
		// Then poll every 3 seconds
		deploymentPollTimer = setInterval(poll, DEPLOYMENT_POLL_INTERVAL_MS)
	}, DEPLOYMENT_INITIAL_DELAY_MS)
}

/**
 * Stop polling for deployment status.
 */
export function stopDeploymentPolling(): void {
	if (deploymentPollTimer) {
		clearInterval(deploymentPollTimer)
		deploymentPollTimer = null
	}
	deploymentWaitAttempts = 0
	deploymentStartTimestamp = null
	deploymentCallback = null
	signals.setDeploymentPolling(false)
}

/**
 * Dismiss the deployment status indicator.
 * Used when user clicks on a failed deployment status.
 */
export function dismissDeploymentStatus(): void {
	if (deploymentHideTimer) {
		clearTimeout(deploymentHideTimer)
		deploymentHideTimer = null
	}
	stopDeploymentPolling()
	signals.resetDeploymentState()
}

// ============================================================================
// Attribute Tracking
// ============================================================================

/**
 * Initialize attribute change tracking for elements with editable attributes.
 * Called during edit mode setup.
 */
function setupAttributeTracking(
	config: CmsConfig,
	el: HTMLElement,
	cmsId: string,
	savedEdit: SavedAttributeEdit | undefined,
): void {
	// Get the manifest entry to find the attributes
	const manifest = signals.manifest.value
	const entry = manifest.entries[cmsId]

	// Check if element has any editable attributes
	if (!entry?.attributes || Object.keys(entry.attributes).length === 0) {
		return
	}

	logDebug(config.debug, 'Setting up attribute tracking for:', cmsId)

	// Initialize pending attribute change if not already tracked
	if (!signals.pendingAttributeChanges.value.has(cmsId)) {
		// Build original attributes from manifest entry (flat map)
		const originalAttributes = deepCopyAttributes(entry.attributes)

		// Restore saved edit if present
		if (savedEdit) {
			// Apply saved attribute values to the element
			applyAttributesToElement(el, savedEdit.newAttributes)

			signals.setPendingAttributeChange(cmsId, {
				element: el,
				cmsId,
				originalAttributes: savedEdit.originalAttributes,
				newAttributes: savedEdit.newAttributes,
				isDirty: true,
			})
			logDebug(config.debug, 'Restored saved attribute edit:', cmsId, savedEdit)
		} else {
			// Create deep copy for newAttributes to avoid shared references
			const newAttributes = deepCopyAttributes(entry.attributes)

			signals.setPendingAttributeChange(cmsId, {
				element: el,
				cmsId,
				originalAttributes,
				newAttributes,
				isDirty: false,
			})
		}
	}
}

/**
 * Deep copy flat attribute map to avoid shared object references.
 */
function deepCopyAttributes(attrs: Record<string, Attribute>): Record<string, Attribute> {
	const copy: Record<string, Attribute> = {}
	for (const [key, attr] of Object.entries(attrs)) {
		copy[key] = { ...attr }
	}
	return copy
}

/**
 * Deep copy color classes map to avoid shared references.
 */
function deepCopyColorClasses(classes: Record<string, Attribute>): Record<string, Attribute> {
	const copy: Record<string, Attribute> = {}
	for (const [key, attr] of Object.entries(classes)) {
		copy[key] = { ...attr }
	}
	return copy
}

/**
 * Handle attribute change from the attribute editor.
 * Called when user modifies an attribute value.
 */
export function handleAttributeChange(
	config: CmsConfig,
	cmsId: string,
	attributeName: string,
	newValue: string | boolean | number | undefined,
	onStateChange?: () => void,
): void {
	const change = signals.getPendingAttributeChange(cmsId)
	if (!change) {
		logDebug(config.debug, 'No attribute change tracked for', cmsId)
		return
	}

	// Record undo action before mutation
	if (!isApplyingUndoRedo) {
		const prevAttrs: Record<string, Attribute> = {}
		for (const [key, attr] of Object.entries(change.newAttributes)) {
			prevAttrs[key] = { ...attr }
		}

		const nextAttrs: Record<string, Attribute> = { ...change.newAttributes }
		const existingAttrForNext = nextAttrs[attributeName] || change.originalAttributes[attributeName]
		nextAttrs[attributeName] = {
			...(existingAttrForNext || {}),
			value: newValue === undefined ? '' : String(newValue),
		}

		recordChange({
			type: 'attribute',
			cmsId,
			element: change.element,
			previousAttributes: prevAttrs,
			currentAttributes: nextAttrs,
			wasDirty: change.isDirty,
		})
	}

	// Update the new attributes — preserve source info, update value
	const newAttributes = { ...change.newAttributes }
	const existingAttr = newAttributes[attributeName] || change.originalAttributes[attributeName]
	newAttributes[attributeName] = {
		...(existingAttr || {}),
		value: newValue === undefined ? '' : String(newValue),
	}

	// Apply the change to the DOM element
	applyAttributeToElement(change.element, attributeName, newValue)

	// Check if dirty (any attribute different from original)
	const isDirty = checkAttributesDirty(change.originalAttributes, newAttributes)

	signals.updatePendingAttributeChange(cmsId, (c) => ({
		...c,
		newAttributes,
		isDirty,
	}))

	logDebug(config.debug, 'Attribute change recorded:', { cmsId, attributeName, newValue, isDirty })

	saveAttributeEditsToStorage(signals.pendingAttributeChanges.value)
	onStateChange?.()
}

/** Boolean attribute names that use presence/absence rather than string values */
const BOOLEAN_ATTRIBUTES = new Set([
	'disabled',
	'required',
	'readonly',
	'multiple',
	'controls',
	'autoplay',
	'muted',
	'loop',
	'novalidate',
	'download',
	'aria-hidden',
	'aria-expanded',
	'aria-disabled',
])

/**
 * Apply a single attribute to a DOM element.
 * Attribute name is the DOM attribute name directly (e.g., 'href', 'aria-label').
 */
function applyAttributeToElement(
	element: HTMLElement,
	attributeName: string,
	value: string | boolean | number | undefined,
): void {
	// Handle boolean attributes
	if (typeof value === 'boolean' || BOOLEAN_ATTRIBUTES.has(attributeName)) {
		const boolVal = value === true || value === 'true'
		if (boolVal) {
			element.setAttribute(attributeName, '')
		} else {
			element.removeAttribute(attributeName)
		}
		return
	}

	// Handle undefined/empty - remove attribute
	if (value === undefined || value === '') {
		element.removeAttribute(attributeName)
		return
	}

	// Set the attribute
	element.setAttribute(attributeName, String(value))
}

/**
 * Apply all attributes from a flat Record<string, Attribute> to an element.
 */
function applyAttributesToElement(element: HTMLElement, attributes: Record<string, Attribute>): void {
	for (const [attrName, attr] of Object.entries(attributes)) {
		applyAttributeToElement(element, attrName, attr.value)
	}
}

/**
 * Check if any attributes have changed from original.
 */
function checkAttributesDirty(original: Record<string, Attribute>, current: Record<string, Attribute>): boolean {
	const allKeys = new Set([...Object.keys(original), ...Object.keys(current)])
	for (const key of allKeys) {
		if (original[key]?.value !== current[key]?.value) {
			return true
		}
	}
	return false
}

/**
 * Build attribute change payload for API from original and new attributes.
 * Includes per-attribute source info from the Attribute objects.
 */
function buildAttributeChangePayload(
	original: Record<string, Attribute>,
	current: Record<string, Attribute>,
): AttributeChangePayload[] {
	const changes: AttributeChangePayload[] = []
	const allKeys = new Set([...Object.keys(original), ...Object.keys(current)])

	for (const attrName of allKeys) {
		const origAttr = original[attrName]
		const currAttr = current[attrName]

		if (origAttr?.value !== currAttr?.value) {
			// Use source info from the original attribute (where it was defined)
			const sourceAttr = origAttr || currAttr
			changes.push({
				attributeName: attrName,
				oldValue: origAttr?.value,
				newValue: currAttr?.value,
				sourcePath: sourceAttr?.sourcePath,
				sourceLine: sourceAttr?.sourceLine,
				sourceSnippet: sourceAttr?.sourceSnippet,
			})
		}
	}

	return changes
}
