import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { CSS, TIMING } from '../constants'
import * as signals from '../signals'
import { isEventOnCmsUI, usePositionTracking } from './utils'

export interface BgImageHoverState {
	visible: boolean
	rect: DOMRect | null
	element: HTMLElement | null
	cmsId: string | null
}

const INITIAL_STATE: BgImageHoverState = {
	visible: false,
	rect: null,
	element: null,
	cmsId: null,
}

/**
 * Hook for detecting and tracking hovered CMS background image elements.
 * Shows a visual overlay when hovering over elements marked with data-cms-bg-img.
 */
export function useBgImageHoverDetection(): BgImageHoverState {
	const [bgImageHoverState, setBgImageHoverState] = useState<BgImageHoverState>(INITIAL_STATE)

	// Throttle ref for element detection
	const lastDetectionTime = useRef<number>(0)

	// Handle position updates on scroll/resize
	const handlePositionChange = useCallback((rect: DOMRect | null) => {
		if (rect) {
			setBgImageHoverState(prev => ({ ...prev, rect }))
		} else {
			setBgImageHoverState(INITIAL_STATE)
		}
	}, [])

	// Track element position on scroll/resize
	usePositionTracking(
		bgImageHoverState.element,
		handlePositionChange,
		bgImageHoverState.visible,
	)

	// Setup hover detection for background image elements
	useEffect(() => {
		const handleMouseMove = (ev: MouseEvent) => {
			const isEditing = signals.isEditing.value

			if (!isEditing) {
				setBgImageHoverState(prev => prev.visible ? INITIAL_STATE : prev)
				return
			}

			// Check if hovering over CMS UI - keep current state
			if (isEventOnCmsUI(ev)) {
				return
			}

			// Throttle detection for performance
			const now = Date.now()
			if (now - lastDetectionTime.current < TIMING.ELEMENT_DETECTION_THROTTLE_MS) {
				return
			}
			lastDetectionTime.current = now

			// Check if hovering over an element with data-cms-bg-img attribute
			const elements = document.elementsFromPoint(ev.clientX, ev.clientY)

			for (const el of elements) {
				// If there's a contentEditable element above, don't show overlay
				if (el instanceof HTMLElement && el.contentEditable === 'true') {
					setBgImageHoverState(INITIAL_STATE)
					return
				}

				if (el instanceof HTMLElement && el.hasAttribute(CSS.BG_IMAGE_ATTRIBUTE)) {
					const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)
					const rect = el.getBoundingClientRect()

					setBgImageHoverState({
						visible: true,
						rect,
						element: el,
						cmsId,
					})
					return
				}
			}

			// No bg image element found, hide overlay
			setBgImageHoverState(INITIAL_STATE)
		}

		document.addEventListener('mousemove', handleMouseMove, true)
		return () => document.removeEventListener('mousemove', handleMouseMove, true)
	}, [])

	return bgImageHoverState
}
