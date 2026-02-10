import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { CSS, TIMING } from '../constants'
import * as signals from '../signals'
import { getTextSelection, type TextSelection } from '../text-styling'
import { isElementInCmsUI, usePositionTracking } from './utils'

export interface TextSelectionState {
	hasSelection: boolean
	selection: TextSelection | null
	rect: DOMRect | null
	element: HTMLElement | null
}

const INITIAL_STATE: TextSelectionState = {
	hasSelection: false,
	selection: null,
	rect: null,
	element: null,
}

/**
 * Hook for managing text selection state within CMS elements.
 * Tracks when the user has selected text and provides the selection details
 * for the text styling toolbar.
 */
export function useTextSelection(): TextSelectionState {
	const [state, setState] = useState<TextSelectionState>(INITIAL_STATE)

	// Track the last active element to detect if user clicked on CMS UI
	const lastActiveElementRef = useRef<Element | null>(null)

	// Update rect on scroll - using a simpler approach since selection rect
	// needs to be recalculated from the Selection API, not tracked element
	useEffect(() => {
		if (!state.hasSelection) return

		const updateRect = () => {
			const selection = window.getSelection()
			if (selection && selection.rangeCount > 0) {
				const range = selection.getRangeAt(0)
				const rect = range.getBoundingClientRect()
				setState(prev => ({ ...prev, rect }))
			}
		}

		window.addEventListener('scroll', updateRect, true)
		window.addEventListener('resize', updateRect)

		return () => {
			window.removeEventListener('scroll', updateRect, true)
			window.removeEventListener('resize', updateRect)
		}
	}, [state.hasSelection])

	useEffect(() => {
		const processSelection = () => {
			const isEditing = signals.isEditing.value
			if (!isEditing) {
				setState(INITIAL_STATE)
				return
			}

			const selection = window.getSelection()
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
				// Check if focus is on CMS UI element - if so, preserve the selection state
				// This allows clicking toolbar buttons without losing selection
				const activeElement = document.activeElement
				if (activeElement && isElementInCmsUI(activeElement as HTMLElement)) {
					return
				}
				setState(INITIAL_STATE)
				return
			}

			const range = selection.getRangeAt(0)
			const container = range.commonAncestorContainer

			// Find the CMS element that contains the selection
			let element: HTMLElement | null = container.nodeType === Node.TEXT_NODE
				? container.parentElement
				: container as HTMLElement

			let cmsElement: HTMLElement | null = null
			while (element && element !== document.body) {
				if (element.hasAttribute(CSS.ID_ATTRIBUTE) && element.contentEditable === 'true') {
					cmsElement = element
					break
				}
				element = element.parentElement
			}

			if (!cmsElement) {
				setState(INITIAL_STATE)
				return
			}

			const textSelection = getTextSelection(cmsElement)
			if (!textSelection) {
				setState(INITIAL_STATE)
				return
			}

			// Get the bounding rect of the selection
			const rect = range.getBoundingClientRect()

			setState({
				hasSelection: true,
				selection: textSelection,
				rect,
				element: cmsElement,
			})
		}

		// Debounce selection change handling
		let timeoutId: number | null = null
		const debouncedHandler = () => {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
			timeoutId = window.setTimeout(processSelection, TIMING.BLUR_DELAY_MS)
		}

		// Handle mousedown to track where user clicked
		const handleMouseDown = (e: MouseEvent) => {
			lastActiveElementRef.current = e.target as Element
		}

		// Handle mouseup for immediate feedback after selection
		const handleMouseUp = (e: MouseEvent) => {
			const target = e.target as HTMLElement

			// Don't process if clicking on CMS UI - let the selection persist
			if (isElementInCmsUI(target)) {
				return
			}

			// Process selection after a brief delay for the browser to update selection
			window.setTimeout(processSelection, TIMING.BLUR_DELAY_MS)
		}

		document.addEventListener('selectionchange', debouncedHandler)
		document.addEventListener('mousedown', handleMouseDown, true)
		document.addEventListener('mouseup', handleMouseUp)

		return () => {
			document.removeEventListener('selectionchange', debouncedHandler)
			document.removeEventListener('mousedown', handleMouseDown, true)
			document.removeEventListener('mouseup', handleMouseUp)
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
		}
	}, [])

	return state
}

/**
 * Clear the current text selection
 */
export function clearTextSelection(): void {
	const selection = window.getSelection()
	if (selection) {
		selection.removeAllRanges()
	}
}

/**
 * Save and restore selection - useful when applying styles
 */
export function saveSelection(): Range | null {
	const selection = window.getSelection()
	if (selection && selection.rangeCount > 0) {
		return selection.getRangeAt(0).cloneRange()
	}
	return null
}

export function restoreSelection(range: Range | null): void {
	if (!range) return

	const selection = window.getSelection()
	if (selection) {
		selection.removeAllRanges()
		selection.addRange(range)
	}
}
