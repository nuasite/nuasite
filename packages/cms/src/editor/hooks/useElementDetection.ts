import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { CSS, LAYOUT, TIMING } from '../constants'
import { getCmsElementAtPosition, getComponentAtPosition, isNearElementEdge } from '../dom'
import { getComponentInstance } from '../manifest'
import * as signals from '../signals'
import { isEventOnCmsUI, usePositionTracking } from './utils'

export interface OutlineState {
	visible: boolean
	rect: DOMRect | null
	isComponent: boolean
	componentName: string | undefined
	tagName: string | undefined
	element: HTMLElement | null
	/** CMS ID of the detected element */
	cmsId: string | null
}

const INITIAL_STATE: OutlineState = {
	visible: false,
	rect: null,
	isComponent: false,
	componentName: undefined,
	tagName: undefined,
	element: null,
	cmsId: null,
}

/**
 * Hook for detecting and tracking hovered CMS elements.
 * Uses signals directly for state management.
 */
export function useElementDetection(): OutlineState {
	const [outlineState, setOutlineState] = useState<OutlineState>(INITIAL_STATE)

	// Throttle ref for element detection
	const lastDetectionTime = useRef<number>(0)
	// Timeout for delayed hide (allows reaching color swatches)
	const hideTimeoutRef = useRef<number | null>(null)

	// Handle position updates on scroll/resize
	const handlePositionChange = useCallback((rect: DOMRect | null) => {
		if (rect) {
			setOutlineState(prev => ({ ...prev, rect }))
		} else {
			setOutlineState(INITIAL_STATE)
		}
	}, [])

	// Track element position on scroll/resize
	usePositionTracking(
		outlineState.element,
		handlePositionChange,
		outlineState.visible,
	)

	// Setup hover highlight for both elements and components
	useEffect(() => {
		const handleMouseMove = (ev: MouseEvent) => {
			const isEditing = signals.isEditing.value
			const selectMode = signals.isSelectMode.value

			if (!isEditing && !selectMode) {
				if (hideTimeoutRef.current) {
					clearTimeout(hideTimeoutRef.current)
					hideTimeoutRef.current = null
				}
				setOutlineState(prev => prev.visible ? INITIAL_STATE : prev)
				return
			}

			// Check if hovering over CMS UI, swatches, or attribute button - keep current state
			if (isEventOnCmsUI(ev) || signals.isHoveringOutlineUI.value) {
				// Cancel any pending hide since we're on UI elements
				if (hideTimeoutRef.current) {
					clearTimeout(hideTimeoutRef.current)
					hideTimeoutRef.current = null
				}
				return
			}

			// Throttle detection for performance
			const now = Date.now()
			if (now - lastDetectionTime.current < TIMING.ELEMENT_DETECTION_THROTTLE_MS) {
				return
			}
			lastDetectionTime.current = now

			const manifest = signals.manifest.value
			const entries = manifest.entries

			// Use the improved elementsFromPoint-based detection
			const cmsEl = getCmsElementAtPosition(ev.clientX, ev.clientY, entries)

			if (cmsEl && !cmsEl.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) {
				// Found a text-editable element - cancel any pending hide
				if (hideTimeoutRef.current) {
					clearTimeout(hideTimeoutRef.current)
					hideTimeoutRef.current = null
				}
				const rect = cmsEl.getBoundingClientRect()
				const cmsId = cmsEl.getAttribute(CSS.ID_ATTRIBUTE)
				setOutlineState({
					visible: true,
					rect,
					isComponent: false,
					componentName: undefined,
					tagName: undefined,
					element: cmsEl,
					cmsId,
				})
				return
			}

			// Check for component at position
			const componentEl = getComponentAtPosition(ev.clientX, ev.clientY)
			if (componentEl) {
				const rect = componentEl.getBoundingClientRect()
				const nearEdge = isNearElementEdge(
					ev.clientX,
					ev.clientY,
					rect,
					LAYOUT.COMPONENT_EDGE_THRESHOLD,
				)

				if (ev.altKey || nearEdge) {
					// Cancel any pending hide
					if (hideTimeoutRef.current) {
						clearTimeout(hideTimeoutRef.current)
						hideTimeoutRef.current = null
					}
					const componentId = componentEl.getAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
					const instance = componentId ? getComponentInstance(manifest, componentId) : null

					setOutlineState({
						visible: true,
						rect,
						isComponent: true,
						componentName: instance?.componentName,
						tagName: componentEl.tagName.toLowerCase(),
						element: componentEl,
						cmsId: null,
					})
					return
				}
			}

			// Check if current outline has color swatches or attribute button - if so, delay hide
			setOutlineState(prev => {
				if (prev.visible && prev.cmsId) {
					const entry = manifest.entries[prev.cmsId]
					const hasColorClasses = entry?.colorClasses?.bg?.value || entry?.colorClasses?.text?.value
					const hasEditableAttributes = entry?.attributes && Object.keys(entry.attributes).length > 0

					if ((hasColorClasses || hasEditableAttributes) && !hideTimeoutRef.current) {
						// Schedule delayed hide to allow reaching swatches/attribute button
						hideTimeoutRef.current = window.setTimeout(() => {
							hideTimeoutRef.current = null
							// Only hide if still not hovering over any outline UI
							if (!signals.isHoveringOutlineUI.value) {
								setOutlineState(INITIAL_STATE)
							}
						}, 400) // Delay to allow reaching buttons below element
						return prev // Keep visible for now
					}
				}
				return INITIAL_STATE
			})
		}

		document.addEventListener('mousemove', handleMouseMove, true)
		return () => {
			document.removeEventListener('mousemove', handleMouseMove, true)
			if (hideTimeoutRef.current) {
				clearTimeout(hideTimeoutRef.current)
			}
		}
	}, [])

	return outlineState
}

export interface ComponentClickHandlerOptions {
	onComponentSelect: (componentId: string, cursor: { x: number; y: number }) => void
	onComponentDeselect?: () => void
}

/**
 * Hook for handling component click selection.
 * Uses signals directly for state management.
 */
export function useComponentClickHandler({
	onComponentSelect,
	onComponentDeselect,
}: ComponentClickHandlerOptions): void {
	useEffect(() => {
		const handleClick = (ev: MouseEvent) => {
			const isEditing = signals.isEditing.value
			const selectMode = signals.isSelectMode.value
			if (!isEditing && !selectMode) return

			// Ignore clicks on CMS UI elements
			if (isEventOnCmsUI(ev)) return

			const manifest = signals.manifest.value
			const entries = manifest.entries

			// Normal editing mode behavior
			// Check for text element first
			const textEl = getCmsElementAtPosition(ev.clientX, ev.clientY, entries)
			if (textEl && !textEl.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) {
				// Clicking a text element deselects any selected component
				if (signals.currentComponentId.value && onComponentDeselect) {
					onComponentDeselect()
				}
				return
			}

			// Check for component click
			const componentEl = getComponentAtPosition(ev.clientX, ev.clientY)
			if (componentEl) {
				const rect = componentEl.getBoundingClientRect()
				const nearEdge = isNearElementEdge(
					ev.clientX,
					ev.clientY,
					rect,
					LAYOUT.COMPONENT_EDGE_THRESHOLD,
				)

				if (ev.altKey || nearEdge) {
					const componentId = componentEl.getAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
					if (componentId) {
						ev.preventDefault()
						ev.stopPropagation()
						onComponentSelect(componentId, { x: ev.clientX, y: ev.clientY })
					}
					return
				}
			}

			// Clicking on empty space deselects any selected component
			if (signals.currentComponentId.value && onComponentDeselect) {
				onComponentDeselect()
			}
		}

		// Escape key deselects the selected component
		const handleKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape' && signals.currentComponentId.value && onComponentDeselect) {
				ev.preventDefault()
				onComponentDeselect()
			}
		}

		document.addEventListener('click', handleClick, true)
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('click', handleClick, true)
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [onComponentSelect, onComponentDeselect])
}

// Re-export utilities for backwards compatibility
export { isEventOnCmsUI }
