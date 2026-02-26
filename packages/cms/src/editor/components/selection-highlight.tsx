import { useCallback, useEffect, useRef } from 'preact/hooks'
import { Z_INDEX } from '../constants'
import { usePositionTracking } from '../hooks/utils'
import { getComponentInstance } from '../manifest'
import * as signals from '../signals'

/**
 * Renders a persistent highlight around the currently selected element.
 * Supports both component selection (edit mode) and any CMS element selection (select mode).
 * Uses Shadow DOM to avoid style conflicts with page content.
 */
export function SelectionHighlight() {
	const containerRef = useRef<HTMLDivElement>(null)
	const shadowRootRef = useRef<ShadowRoot | null>(null)
	const overlayRef = useRef<HTMLDivElement | null>(null)
	const labelRef = useRef<HTMLDivElement | null>(null)

	const componentId = signals.currentComponentId.value
	const selectModeEl = signals.selectModeElement.value
	const isEditing = signals.isEditing.value
	const isSelectMode = signals.isSelectMode.value

	// Determine which element to highlight
	const hasComponentSelection = !!componentId && (isEditing || isSelectMode)
	const hasSelectModeSelection = isSelectMode && !!selectModeEl
	const visible = hasComponentSelection || hasSelectModeSelection

	// Resolve the DOM element and label
	let element: HTMLElement | null = null
	let label: string = 'Component'

	if (hasSelectModeSelection && selectModeEl) {
		element = selectModeEl.element
		label = selectModeEl.label
	} else if (hasComponentSelection && componentId) {
		element = document.querySelector(`[data-cms-component-id="${componentId}"]`) as HTMLElement | null
		const manifest = signals.manifest.value
		const instance = getComponentInstance(manifest, componentId)
		label = instance?.componentName ?? 'Component'
	}

	// Initialize Shadow DOM once
	useEffect(() => {
		if (containerRef.current && !shadowRootRef.current) {
			shadowRootRef.current = containerRef.current.attachShadow({ mode: 'open' })

			const style = document.createElement('style')
			style.textContent = `
				:host {
					position: fixed;
					top: 0;
					left: 0;
					pointer-events: none;
					z-index: ${Z_INDEX.SELECTION};
				}

				.selection-overlay {
					position: fixed;
					border: 2px solid #DFFF40;
					border-radius: 16px;
					box-sizing: border-box;
					background: rgba(223, 255, 64, 0.03);
					box-shadow: 0 0 0 1px rgba(223, 255, 64, 0.15);
					transition: opacity 150ms ease;
					pointer-events: none;
				}

				.selection-overlay.hidden {
					opacity: 0;
				}

				.selection-label {
					position: fixed;
					padding: 5px 8px 5px 12px;
					border-radius: 9999px;
					font-size: 11px;
					font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
					font-weight: 600;
					white-space: nowrap;
					background: #DFFF40;
					color: #1A1A1A;
					display: none;
					align-items: center;
					gap: 6px;
					pointer-events: auto;
					z-index: ${Z_INDEX.MODAL};
					box-shadow: 0 4px 12px rgba(0,0,0,0.2);
				}

				.deselect-btn {
					width: 18px;
					height: 18px;
					display: flex;
					align-items: center;
					justify-content: center;
					background: rgba(0,0,0,0.1);
					border: none;
					border-radius: 50%;
					cursor: pointer;
					padding: 0;
					color: #1A1A1A;
					font-size: 10px;
					line-height: 1;
					transition: background 150ms ease;
				}

				.deselect-btn:hover {
					background: rgba(0,0,0,0.25);
				}
			`

			overlayRef.current = document.createElement('div')
			overlayRef.current.className = 'selection-overlay hidden'

			labelRef.current = document.createElement('div')
			labelRef.current.className = 'selection-label'

			shadowRootRef.current.appendChild(style)
			shadowRootRef.current.appendChild(overlayRef.current)
			shadowRootRef.current.appendChild(labelRef.current)
		}
	}, [])

	// Handle deselection
	const handleDeselect = useCallback(() => {
		if (signals.selectModeElement.value) {
			signals.setSelectModeElement(null)
		} else {
			signals.setCurrentComponentId(null)
			signals.setBlockEditorOpen(false)
		}
	}, [])

	// Track position on scroll/resize
	const handlePositionChange = useCallback((rect: DOMRect | null) => {
		if (!overlayRef.current || !labelRef.current) return

		if (!rect) {
			overlayRef.current.className = 'selection-overlay hidden'
			labelRef.current.style.display = 'none'
			return
		}

		overlayRef.current.className = 'selection-overlay'
		overlayRef.current.style.left = `${rect.left - 6}px`
		overlayRef.current.style.top = `${rect.top - 6}px`
		overlayRef.current.style.width = `${rect.width + 12}px`
		overlayRef.current.style.height = `${rect.height + 12}px`

		// Position label above the element
		const labelTop = Math.max(8, rect.top - 32)
		const labelLeft = Math.max(8, rect.left)

		// Hide label if element is out of viewport
		if (rect.bottom < 0 || rect.top > window.innerHeight) {
			labelRef.current.style.display = 'none'
		} else {
			labelRef.current.style.display = 'flex'
			labelRef.current.style.top = `${labelTop}px`
			labelRef.current.style.left = `${labelLeft}px`
		}
	}, [])

	usePositionTracking(element, handlePositionChange, visible)

	// Update content and initial position when selection changes
	useEffect(() => {
		if (!overlayRef.current || !labelRef.current) return

		if (!visible || !element) {
			overlayRef.current.className = 'selection-overlay hidden'
			labelRef.current.style.display = 'none'
			return
		}

		// Build label content
		labelRef.current.innerHTML = ''

		const nameSpan = document.createElement('span')
		nameSpan.textContent = label
		labelRef.current.appendChild(nameSpan)

		const deselectBtn = document.createElement('button')
		deselectBtn.className = 'deselect-btn'
		deselectBtn.innerHTML = '✕'
		deselectBtn.title = 'Deselect'
		deselectBtn.onclick = (e) => {
			e.stopPropagation()
			handleDeselect()
		}
		labelRef.current.appendChild(deselectBtn)

		// Set initial position
		const rect = element.getBoundingClientRect()
		handlePositionChange(rect)
	}, [visible, element, label, handleDeselect, handlePositionChange])

	return (
		<div
			ref={containerRef}
			data-cms-ui
			style={{
				position: 'fixed',
				top: 0,
				left: 0,
				width: 0,
				height: 0,
				pointerEvents: 'none',
				zIndex: Z_INDEX.SELECTION,
			}}
		/>
	)
}
