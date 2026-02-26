import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { CSS, LAYOUT, TIMING } from '../constants'
import { getCmsElementAtPosition, getComponentAtPosition, isNearElementEdge } from '../dom'
import { getComponentInstance } from '../manifest'
import * as signals from '../signals'
import type { SelectedElement } from '../signals'
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
 * Build a component-style outline state for a given component element.
 */
function buildComponentOutline(componentEl: HTMLElement, manifest: any): OutlineState {
	const componentId = componentEl.getAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
	const instance = componentId ? getComponentInstance(manifest, componentId) : null
	return {
		visible: true,
		rect: componentEl.getBoundingClientRect(),
		isComponent: true,
		componentName: instance?.componentName,
		tagName: componentEl.tagName.toLowerCase(),
		element: componentEl,
		cmsId: null,
	}
}

/**
 * Check if an element is currently selected (either as component or select-mode element).
 */
function isElementSelected(el: HTMLElement): boolean {
	// Check component selection
	const componentId = el.getAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
	if (componentId && componentId === signals.currentComponentId.value) return true

	// Check select-mode selection
	const selectEl = signals.selectModeElement.value
	if (selectEl && selectEl.element === el) return true

	return false
}

/**
 * Resolve a CMS element to a SelectedElement descriptor for select mode.
 */
function resolveSelectedElement(el: HTMLElement, manifest: any): SelectedElement | null {
	// Component element
	const componentId = el.getAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
	if (componentId) {
		const instance = getComponentInstance(manifest, componentId)
		return {
			element: el,
			id: componentId,
			label: instance?.componentName ?? el.tagName.toLowerCase(),
			type: 'component',
		}
	}

	// Image element
	if (el.hasAttribute('data-cms-img')) {
		const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE) ?? el.getAttribute('data-cms-img') ?? ''
		return {
			element: el,
			id: cmsId,
			label: el.getAttribute('alt') || 'Image',
			type: 'image',
		}
	}

	// Background image element
	if (el.hasAttribute('data-cms-bg-img')) {
		const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE) ?? el.getAttribute('data-cms-bg-img') ?? ''
		return {
			element: el,
			id: cmsId,
			label: 'Background Image',
			type: 'image',
		}
	}

	// Text/CMS element
	const cmsId = el.getAttribute(CSS.ID_ATTRIBUTE)
	if (cmsId) {
		const tagName = el.tagName.toLowerCase()
		return {
			element: el,
			id: cmsId,
			label: tagName,
			type: 'text',
		}
	}

	return null
}

/**
 * Find any CMS element at position (text, image, bg-image, or component).
 * Returns the deepest/most specific CMS element at the given point.
 */
function getAnyCmsElementAtPosition(x: number, y: number): HTMLElement | null {
	const elementsAtPoint = document.elementsFromPoint(x, y)
	for (const el of elementsAtPoint) {
		if (!(el instanceof HTMLElement)) continue
		// Skip CMS UI elements
		if (el.hasAttribute(CSS.UI_ATTRIBUTE) || el.closest(`[${CSS.UI_ATTRIBUTE}]`)) continue
		// Any element with a CMS attribute
		if (
			el.hasAttribute(CSS.ID_ATTRIBUTE)
			|| el.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
			|| el.hasAttribute('data-cms-img')
			|| el.hasAttribute('data-cms-bg-img')
		) {
			return el
		}
	}
	return null
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

	// Hide hover outline immediately when a component is selected
	const currentComponentId = signals.currentComponentId.value
	useEffect(() => {
		if (currentComponentId) {
			setOutlineState(INITIAL_STATE)
		}
	}, [currentComponentId])

	// Hide hover outline immediately when a select-mode element is selected
	const selectModeElement = signals.selectModeElement.value
	useEffect(() => {
		if (selectModeElement) {
			setOutlineState(INITIAL_STATE)
		}
	}, [selectModeElement])

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

			// ── Select mode: show component-style outline for any CMS element ──
			if (selectMode) {
				const cmsEl = getAnyCmsElementAtPosition(ev.clientX, ev.clientY)
				if (cmsEl) {
					if (isElementSelected(cmsEl)) {
						setOutlineState(INITIAL_STATE)
						return
					}
					if (hideTimeoutRef.current) {
						clearTimeout(hideTimeoutRef.current)
						hideTimeoutRef.current = null
					}
					const resolved = resolveSelectedElement(cmsEl, manifest)
					const rect = cmsEl.getBoundingClientRect()
					setOutlineState({
						visible: true,
						rect,
						isComponent: true,
						componentName: resolved?.label,
						tagName: cmsEl.tagName.toLowerCase(),
						element: cmsEl,
						cmsId: null,
					})
					return
				}
				setOutlineState(INITIAL_STATE)
				return
			}

			// ── Edit mode: standard detection ──

			// Use the improved elementsFromPoint-based detection
			const cmsEl = getCmsElementAtPosition(ev.clientX, ev.clientY, entries)

			if (cmsEl && !cmsEl.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) {
				// Hide hover outline if this element is inside the selected component
				const selectedId = signals.currentComponentId.value
				if (selectedId && cmsEl.closest(`[${CSS.COMPONENT_ID_ATTRIBUTE}="${selectedId}"]`)) {
					setOutlineState(INITIAL_STATE)
					return
				}

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
				// Hide hover outline if this component is already selected
				const componentId = componentEl.getAttribute(CSS.COMPONENT_ID_ATTRIBUTE)
				if (componentId && componentId === signals.currentComponentId.value) {
					setOutlineState(INITIAL_STATE)
					return
				}

				const rect = componentEl.getBoundingClientRect()

				if (ev.altKey || isNearElementEdge(ev.clientX, ev.clientY, rect, LAYOUT.COMPONENT_EDGE_THRESHOLD)) {
					// Cancel any pending hide
					if (hideTimeoutRef.current) {
						clearTimeout(hideTimeoutRef.current)
						hideTimeoutRef.current = null
					}
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

			// ── Select mode: select any CMS element ──
			if (selectMode) {
				const cmsEl = getAnyCmsElementAtPosition(ev.clientX, ev.clientY)
				if (cmsEl) {
					const resolved = resolveSelectedElement(cmsEl, manifest)
					if (resolved) {
						ev.preventDefault()
						ev.stopPropagation()
						signals.setSelectModeElement(resolved)
						return
					}
				}
				// Clicking empty space deselects
				signals.setSelectModeElement(null)
				return
			}

			// ── Edit mode: standard behavior ──

			// Check for text element first
			const textEl = getCmsElementAtPosition(ev.clientX, ev.clientY, entries)
			if (textEl && !textEl.hasAttribute(CSS.COMPONENT_ID_ATTRIBUTE)) {
				// In edit mode, clicking a text element deselects any selected component
				if (signals.currentComponentId.value && onComponentDeselect) {
					onComponentDeselect()
				}
				return
			}

			// Check for component click
			const componentEl = getComponentAtPosition(ev.clientX, ev.clientY)
			if (componentEl) {
				// In edit mode, require edge proximity or Alt key
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

		// Escape key deselects
		const handleKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape') {
				if (signals.selectModeElement.value) {
					ev.preventDefault()
					signals.setSelectModeElement(null)
				} else if (signals.currentComponentId.value && onComponentDeselect) {
					ev.preventDefault()
					onComponentDeselect()
				}
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
