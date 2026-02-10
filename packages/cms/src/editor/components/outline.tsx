import { useEffect, useRef } from 'preact/hooks'
import { getColorPreview, parseColorClass } from '../color-utils'
import { Z_INDEX } from '../constants'
import * as signals from '../signals'

export interface OutlineProps {
	visible: boolean
	rect: DOMRect | null
	isComponent?: boolean
	componentName?: string
	tagName?: string
	/** The actual element being outlined - used for scroll tracking */
	element?: HTMLElement | null
	/** CMS ID of the hovered element */
	cmsId?: string | null
	/** Callback when a color swatch is clicked */
	onColorClick?: (cmsId: string, rect: DOMRect) => void
	/** Callback when an attribute indicator is clicked */
	onAttributeClick?: (cmsId: string, rect: DOMRect) => void
}

// Minimum space needed to show label outside the element
const LABEL_OUTSIDE_THRESHOLD = 28
// Padding from viewport edges for sticky label
const STICKY_PADDING = 8

/**
 * Shadow DOM-based hover outline component.
 * Uses a custom element with Shadow DOM to avoid style conflicts.
 */
export function Outline(
	{ visible, rect, isComponent = false, componentName, tagName, element, cmsId, onColorClick, onAttributeClick }: OutlineProps,
) {
	const containerRef = useRef<HTMLDivElement>(null)
	const shadowRootRef = useRef<ShadowRoot | null>(null)
	const overlayRef = useRef<HTMLDivElement | null>(null)
	const labelRef = useRef<HTMLDivElement | null>(null)
	const toolbarRef = useRef<HTMLDivElement | null>(null)

	// Initialize Shadow DOM once
	useEffect(() => {
		if (containerRef.current && !shadowRootRef.current) {
			shadowRootRef.current = containerRef.current.attachShadow({ mode: 'open' })

			// Create styles
			const style = document.createElement('style')
			style.textContent = `
        :host {
          position: fixed;
          top: 0;
          left: 0;
          pointer-events: none;
          z-index: ${Z_INDEX.OVERLAY};
        }

        .outline-overlay {
          position: fixed;
          border-radius: 16px;
          box-sizing: border-box;
          transition: opacity 100ms ease;
          overflow: visible;
        }

        .outline-overlay.hidden {
          opacity: 0;
        }

        .outline-overlay.visible {
          opacity: 1;
        }

        .outline-label {
          position: fixed;
          padding: 6px 14px;
          border-radius: 9999px;
          font-size: 11px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-weight: 600;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
          z-index: ${Z_INDEX.MODAL};
        }

        .outline-label .tag {
          opacity: 0.85;
        }

        .outline-label .component-name {
          font-weight: 700;
        }

        .outline-label .separator {
          opacity: 0.5;
        }

        .element-toolbar {
          position: fixed;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px;
          background: #1A1A1A;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          pointer-events: auto;
          z-index: ${Z_INDEX.MODAL};
        }

        .element-toolbar.hidden {
          display: none;
        }

        .color-swatch {
          width: 24px;
          height: 24px;
          border: 2px solid transparent;
          border-radius: 50%;
          cursor: pointer;
          transition: all 150ms ease;
        }

        .color-swatch:hover {
          transform: scale(1.15);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          border-color: rgba(223, 255, 64, 0.5);
        }

        .color-swatch.white {
          border-color: rgba(255,255,255,0.2);
        }

        .toolbar-divider {
          width: 1px;
          height: 20px;
          background: rgba(255,255,255,0.15);
          margin: 0 2px;
        }

        .attr-button {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          transition: all 150ms ease;
        }

        .attr-button:hover {
          transform: scale(1.15);
          background: rgba(255,255,255,0.1);
        }

        .attr-button svg {
          width: 14px;
          height: 14px;
          color: rgba(255,255,255,0.7);
        }

        .attr-button:hover svg {
          color: #DFFF40;
        }
      `

			overlayRef.current = document.createElement('div')
			overlayRef.current.className = 'outline-overlay hidden'

			labelRef.current = document.createElement('div')
			labelRef.current.className = 'outline-label'
			// Label is now a sibling, not a child, for independent positioning

			toolbarRef.current = document.createElement('div')
			toolbarRef.current.className = 'element-toolbar hidden'

			// Add hover listeners for toolbar to signal hover state
			toolbarRef.current.addEventListener('mouseenter', () => {
				signals.setHoveringSwatches(true)
				signals.setHoveringAttributeButton(true)
			})
			toolbarRef.current.addEventListener('mouseleave', () => {
				signals.setHoveringSwatches(false)
				signals.setHoveringAttributeButton(false)
			})

			shadowRootRef.current.appendChild(style)
			shadowRootRef.current.appendChild(overlayRef.current)
			shadowRootRef.current.appendChild(labelRef.current)
			shadowRootRef.current.appendChild(toolbarRef.current)
		}
	}, [])

	// Update overlay visibility and position
	useEffect(() => {
		if (!overlayRef.current || !labelRef.current || !toolbarRef.current) return

		if (!visible || !rect) {
			overlayRef.current.className = 'outline-overlay hidden'
			labelRef.current.style.display = 'none'
			toolbarRef.current.className = 'element-toolbar hidden'
			signals.setHoveringSwatches(false)
			signals.setHoveringAttributeButton(false)
			return
		}

		overlayRef.current.className = 'outline-overlay visible'

		const viewportHeight = window.innerHeight
		const viewportWidth = window.innerWidth

		// Use viewport-relative coordinates (fixed positioning)
		const left = rect.left - 6
		const top = rect.top - 6
		const width = rect.width + 12
		const height = rect.height + 12

		overlayRef.current.style.left = `${left}px`
		overlayRef.current.style.top = `${top}px`
		overlayRef.current.style.width = `${width}px`
		overlayRef.current.style.height = `${height}px`

		// Different styling for components vs text elements
		if (isComponent) {
			overlayRef.current.style.border = `2px solid #1A1A1A` // Dark border
			overlayRef.current.style.backgroundColor = 'rgba(0, 0, 0, 0.03)'
			overlayRef.current.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.08)'
			labelRef.current.style.display = 'flex'
			labelRef.current.style.backgroundColor = '#1A1A1A'
			labelRef.current.style.color = 'white'
			toolbarRef.current.className = 'element-toolbar hidden' // Hide toolbar for components

			// Build label content
			let labelContent = ''
			if (tagName) {
				labelContent += `<span class="tag">&lt;${tagName}&gt;</span>`
			}
			if (componentName) {
				if (tagName) labelContent += `<span class="separator">·</span>`
				labelContent += `<span class="component-name">${componentName}</span>`
			}
			if (!tagName && !componentName) {
				labelContent = 'COMPONENT'
			}
			labelRef.current.innerHTML = labelContent

			// Calculate sticky label position
			// The label should stay visible within the viewport, attached to the element
			const elementTop = rect.top
			const elementBottom = rect.bottom
			const elementLeft = rect.left

			// Ideal position is above the element
			let labelTop = elementTop - 36 // Increased offset for thicker border/shadow
			let labelLeft = Math.max(STICKY_PADDING, elementLeft)

			// If element top is above viewport, stick label to top of viewport
			if (elementTop < STICKY_PADDING + 36) {
				// Element is partially scrolled up - stick label to visible portion
				labelTop = Math.max(STICKY_PADDING, Math.min(elementTop + STICKY_PADDING, elementBottom - 36))
			}

			// If element is below viewport, position at bottom
			if (elementTop > viewportHeight) {
				labelRef.current.style.display = 'none'
			} else if (elementBottom < 0) {
				labelRef.current.style.display = 'none'
			} else {
				// Clamp label position to viewport
				labelTop = Math.max(STICKY_PADDING, Math.min(labelTop, viewportHeight - 36))
				labelLeft = Math.min(labelLeft, viewportWidth - 150) // Ensure label doesn't go off-screen right

				labelRef.current.style.top = `${labelTop}px`
				labelRef.current.style.left = `${labelLeft}px`
			}
		} else {
			overlayRef.current.style.border = `2px dashed #1A1A1A`
			overlayRef.current.style.backgroundColor = 'transparent'
			overlayRef.current.style.boxShadow = 'none'
			labelRef.current.style.display = 'none'

			// Check for color swatches and attribute button
			const manifest = signals.manifest.value
			const pendingColorChange = cmsId ? signals.pendingColorChanges.value.get(cmsId) : null
			const entry = cmsId ? manifest.entries[cmsId] : null
			const colorClasses = pendingColorChange?.newClasses ?? entry?.colorClasses

			const hasColorSwatches = colorClasses && (colorClasses.bg?.value || colorClasses.text?.value) && onColorClick
			const hasEditableAttributes = entry?.attributes && Object.keys(entry.attributes).length > 0

			// Show unified toolbar if there are swatches or attribute button
			if ((hasColorSwatches || hasEditableAttributes) && (onColorClick || onAttributeClick)) {
				toolbarRef.current.className = 'element-toolbar'
				toolbarRef.current.innerHTML = ''

				// Position toolbar at bottom center of the element
				const toolbarTop = rect.bottom + 6
				const toolbarLeft = rect.left + rect.width / 2

				toolbarRef.current.style.top = `${toolbarTop}px`
				toolbarRef.current.style.left = `${toolbarLeft}px`
				toolbarRef.current.style.transform = 'translateX(-50%)'

				// Helper to apply swatch styles including transparent checkerboard
				const applySwatchStyle = (swatch: HTMLDivElement, colorName: string, preview: string) => {
					if (colorName === 'transparent') {
						swatch.style.backgroundColor = 'transparent'
						swatch.style.backgroundImage =
							'linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%, #555), linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%, #555)'
						swatch.style.backgroundSize = '8px 8px'
						swatch.style.backgroundPosition = '0 0, 4px 4px'
					} else {
						swatch.style.backgroundColor = preview
					}
				}

				// Add color swatches
				if (hasColorSwatches && colorClasses) {
					// Create bg swatch
					if (colorClasses.bg?.value) {
						const parsed = parseColorClass(colorClasses.bg.value)
						if (parsed) {
							const preview = getColorPreview(parsed.colorName, parsed.shade)
							const swatch = document.createElement('div')
							swatch.className = `color-swatch${parsed.colorName === 'white' ? ' white' : ''}`
							applySwatchStyle(swatch, parsed.colorName, preview)
							swatch.title = `Background: ${colorClasses.bg.value}`
							swatch.onclick = (e) => {
								e.stopPropagation()
								if (cmsId && onColorClick) onColorClick(cmsId, rect)
							}
							toolbarRef.current.appendChild(swatch)
						}
					}

					// Create text swatch
					if (colorClasses.text?.value) {
						const parsed = parseColorClass(colorClasses.text.value)
						if (parsed) {
							const preview = getColorPreview(parsed.colorName, parsed.shade)
							const swatch = document.createElement('div')
							swatch.className = `color-swatch${parsed.colorName === 'white' ? ' white' : ''}`
							applySwatchStyle(swatch, parsed.colorName, preview)
							swatch.title = `Text: ${colorClasses.text.value}`
							swatch.onclick = (e) => {
								e.stopPropagation()
								if (cmsId && onColorClick) onColorClick(cmsId, rect)
							}
							toolbarRef.current.appendChild(swatch)
						}
					}
				}

				// Add divider and attribute button if needed
				if (hasEditableAttributes && onAttributeClick) {
					// Add divider if there are swatches
					if (hasColorSwatches) {
						const divider = document.createElement('div')
						divider.className = 'toolbar-divider'
						toolbarRef.current.appendChild(divider)
					}

					// Add attribute button
					const attrButton = document.createElement('button')
					attrButton.className = 'attr-button'
					attrButton.innerHTML =
						`<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`
					attrButton.title = 'Edit attributes'
					attrButton.onclick = (e) => {
						e.stopPropagation()
						if (cmsId) onAttributeClick(cmsId, rect)
					}
					toolbarRef.current.appendChild(attrButton)
				}
			} else {
				toolbarRef.current.className = 'element-toolbar hidden'
			}
		}
	}, [visible, rect, isComponent, componentName, tagName, cmsId, onColorClick, onAttributeClick])

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
				zIndex: Z_INDEX.OVERLAY,
			}}
		/>
	)
}
