import { useCallback, useEffect, useState } from 'preact/hooks'
import { CSS } from '../constants'
import * as signals from '../signals'

export interface TooltipState {
	elementId: string | null
	rect: DOMRect | null
	element: HTMLElement | null
}

export interface UseTooltipStateOptions {
	/** @deprecated No longer needed - signals are used directly */
	isEditing?: boolean
}

/**
 * Hook for managing tooltip visibility and positioning.
 * Uses signals directly for state management.
 */
export function useTooltipState(_options?: UseTooltipStateOptions) {
	const [tooltipState, setTooltipState] = useState<TooltipState>({
		elementId: null,
		rect: null,
		element: null,
	})

	/**
	 * Show tooltip for the current editing element
	 */
	const showTooltipForElement = useCallback(() => {
		const currentEditingId = signals.currentEditingId.value
		const isProcessing = signals.isAIProcessing.value

		if (!currentEditingId || isProcessing) {
			setTooltipState({ elementId: null, rect: null, element: null })
			return
		}

		const change = signals.getPendingChange(currentEditingId)
		if (!change) {
			setTooltipState({ elementId: null, rect: null, element: null })
			return
		}

		setTooltipState({
			elementId: currentEditingId,
			rect: change.element.getBoundingClientRect(),
			element: change.element,
		})
	}, [])

	/**
	 * Hide the tooltip
	 */
	const hideTooltip = useCallback(() => {
		setTooltipState({ elementId: null, rect: null, element: null })
	}, [])

	// Update tooltip position on scroll
	useEffect(() => {
		if (!tooltipState.elementId || !tooltipState.element) return

		const updateTooltipPosition = () => {
			if (tooltipState.element && document.contains(tooltipState.element)) {
				setTooltipState(prev => ({
					...prev,
					rect: tooltipState.element!.getBoundingClientRect(),
				}))
			} else {
				// Element no longer in DOM
				setTooltipState({ elementId: null, rect: null, element: null })
			}
		}

		// Hide tooltip when clicking outside the element and CMS UI
		const handleClickOutside = (e: MouseEvent) => {
			const path = e.composedPath()
			const target = path[0] as HTMLElement

			// Check if click is on the tooltip element itself
			if (tooltipState.element?.contains(target) || tooltipState.element === target) {
				return
			}

			// Check if any element in the path is inside CMS UI
			const cmsOverlay = document.querySelector(CSS.HIGHLIGHT_ELEMENT)
			for (const el of path) {
				if (el === cmsOverlay) {
					return // Click was inside Shadow DOM
				}
				if (el instanceof HTMLElement) {
					if (el.tagName?.startsWith('CMS-')) {
						return
					}
					if (el.hasAttribute?.(CSS.UI_ATTRIBUTE)) {
						return
					}
				}
			}

			// Check if click is on another CMS-editable element
			if (target.hasAttribute?.(CSS.ID_ATTRIBUTE)) {
				return // Will be handled by element focus
			}

			// Click was outside, hide tooltip
			setTooltipState({ elementId: null, rect: null, element: null })
		}

		window.addEventListener('scroll', updateTooltipPosition, true)
		window.addEventListener('resize', updateTooltipPosition)
		document.addEventListener('mousedown', handleClickOutside, true)

		return () => {
			window.removeEventListener('scroll', updateTooltipPosition, true)
			window.removeEventListener('resize', updateTooltipPosition)
			document.removeEventListener('mousedown', handleClickOutside, true)
		}
	}, [tooltipState.elementId, tooltipState.element])

	return {
		tooltipState,
		showTooltipForElement,
		hideTooltip,
	}
}
