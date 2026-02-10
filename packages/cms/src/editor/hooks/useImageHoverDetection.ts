import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { CSS, TIMING } from '../constants'
import * as signals from '../signals'
import { isEventOnCmsUI, usePositionTracking } from './utils'

export interface ImageHoverState {
	visible: boolean
	rect: DOMRect | null
	element: HTMLImageElement | null
	cmsId: string | null
}

const INITIAL_STATE: ImageHoverState = {
	visible: false,
	rect: null,
	element: null,
	cmsId: null,
}

/**
 * Hook for detecting and tracking hovered CMS image elements.
 * Shows a visual overlay when hovering over images marked with data-cms-img.
 */
export function useImageHoverDetection(): ImageHoverState {
	const [imageHoverState, setImageHoverState] = useState<ImageHoverState>(INITIAL_STATE)

	// Throttle ref for element detection
	const lastDetectionTime = useRef<number>(0)

	// Handle position updates on scroll/resize
	const handlePositionChange = useCallback((rect: DOMRect | null) => {
		if (rect) {
			setImageHoverState(prev => ({ ...prev, rect }))
		} else {
			setImageHoverState(INITIAL_STATE)
		}
	}, [])

	// Track element position on scroll/resize
	usePositionTracking(
		imageHoverState.element,
		handlePositionChange,
		imageHoverState.visible,
	)

	// Setup hover detection for image elements
	useEffect(() => {
		const handleMouseMove = (ev: MouseEvent) => {
			const isEditing = signals.isEditing.value

			if (!isEditing) {
				setImageHoverState(prev => prev.visible ? INITIAL_STATE : prev)
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

			// Check if hovering over an image element with data-cms-img attribute
			const elements = document.elementsFromPoint(ev.clientX, ev.clientY)

			for (const el of elements) {
				// If there's a contentEditable element above the image, don't show overlay
				// This allows text editing on elements positioned over images
				if (el instanceof HTMLElement && el.contentEditable === 'true') {
					setImageHoverState(INITIAL_STATE)
					return
				}

				if (el instanceof HTMLImageElement && el.hasAttribute('data-cms-img')) {
					const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)
					const rect = el.getBoundingClientRect()

					setImageHoverState({
						visible: true,
						rect,
						element: el,
						cmsId,
					})
					return
				}
			}

			// No image found, hide overlay
			setImageHoverState(INITIAL_STATE)
		}

		document.addEventListener('mousemove', handleMouseMove, true)
		return () => document.removeEventListener('mousemove', handleMouseMove, true)
	}, [])

	return imageHoverState
}
