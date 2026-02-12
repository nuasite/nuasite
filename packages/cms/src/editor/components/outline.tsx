import { useEffect, useRef } from 'preact/hooks'
import { getColorPreview, parseColorClass } from '../color-utils'
import { Z_INDEX } from '../constants'
import { isPageDark } from '../dom'
import * as signals from '../signals'
import type { Attribute } from '../../types'

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
	/** Current text style classes from pending changes (reactive) */
	textStyleClasses?: Record<string, Attribute>
	/** Callback when a color swatch is clicked */
	onColorClick?: (cmsId: string, rect: DOMRect) => void
	/** Callback when an attribute indicator is clicked */
	onAttributeClick?: (cmsId: string, rect: DOMRect) => void
	/** Callback when a text style toggle is clicked */
	onTextStyleChange?: (cmsId: string, styleType: string, oldClass: string, newClass: string) => void
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
	{ visible, rect, isComponent = false, componentName, tagName, element, cmsId, textStyleClasses, onColorClick, onAttributeClick, onTextStyleChange }: OutlineProps,
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
          margin-top: 6px;
        }

        .element-toolbar::before {
          content: '';
          position: absolute;
          top: -13px;
          left: -50px;
          right: -50px;
          bottom: 0;
          z-index: -1;
          pointer-events: auto;
          background: transparent;
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
          width: 32px;
          height: 32px;
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
          width: 18px;
          height: 18px;
          color: rgba(255,255,255,0.7);
        }

        .attr-button:hover svg {
          color: #DFFF40;
        }

        .text-style-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          transition: all 150ms ease;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 13px;
          color: rgba(255,255,255,0.7);
          padding: 0;
          line-height: 1;
        }

        .text-style-btn:hover {
          background: rgba(255,255,255,0.1);
          color: #DFFF40;
        }

        .text-style-btn.active {
          background: rgba(223, 255, 64, 0.15);
          border-color: rgba(223, 255, 64, 0.4);
          color: #DFFF40;
        }

        .text-size-select {
          height: 28px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 6px;
          color: rgba(255,255,255,0.7);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px;
          padding: 0 4px;
          cursor: pointer;
          transition: all 150ms ease;
          -webkit-appearance: none;
          appearance: none;
        }

        .text-size-select:hover {
          border-color: rgba(223, 255, 64, 0.4);
          color: #DFFF40;
        }

        .text-size-select:focus {
          outline: none;
          border-color: #DFFF40;
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

		// Detect page brightness for contrast-aware outline colors
		const dark = isPageDark()
		const outlineColor = dark ? '#FFFFFF' : '#1A1A1A'

		// Different styling for components vs text elements
		if (isComponent) {
			overlayRef.current.style.border = `2px solid ${outlineColor}`
			overlayRef.current.style.backgroundColor = dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)'
			overlayRef.current.style.boxShadow = dark ? '0 4px 16px rgba(255, 255, 255, 0.08)' : '0 4px 16px rgba(0, 0, 0, 0.08)'
			labelRef.current.style.display = 'flex'
			labelRef.current.style.backgroundColor = dark ? '#FFFFFF' : '#1A1A1A'
			labelRef.current.style.color = dark ? '#1A1A1A' : 'white'
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
			overlayRef.current.style.border = `2px dashed ${outlineColor}`
			overlayRef.current.style.backgroundColor = 'transparent'
			overlayRef.current.style.boxShadow = 'none'
			labelRef.current.style.display = 'none'

			// Check for color swatches and attribute button
			const manifest = signals.manifest.value
			const entry = cmsId ? manifest.entries[cmsId] : null
			const colorClasses = textStyleClasses ?? entry?.colorClasses

			const hasColorSwatches = colorClasses && (colorClasses.bg?.value || colorClasses.text?.value) && onColorClick
			const hasEditableAttributes = entry?.attributes && Object.keys(entry.attributes).length > 0
			const needsElementLevelStyling = entry?.allowStyling === false && onTextStyleChange

			// Show unified toolbar if there are swatches, attribute button, or element-level text styling
			if ((hasColorSwatches || hasEditableAttributes || needsElementLevelStyling) && (onColorClick || onAttributeClick || onTextStyleChange)) {
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

				// Add unified color swatch
				if (hasColorSwatches && colorClasses) {
					const bgParsed = colorClasses.bg?.value ? parseColorClass(colorClasses.bg.value) : null
					const textParsed = colorClasses.text?.value ? parseColorClass(colorClasses.text.value) : null
					const bgPreview = bgParsed ? getColorPreview(bgParsed.colorName, bgParsed.shade) : null
					const textPreview = textParsed ? getColorPreview(textParsed.colorName, textParsed.shade) : null

					const swatch = document.createElement('div')
					const isWhite = (bgParsed && !textParsed && bgParsed.colorName === 'white')
						|| (!bgParsed && textParsed && textParsed.colorName === 'white')
					swatch.className = `color-swatch${isWhite ? ' white' : ''}`

					if (bgPreview && textPreview) {
						// Split swatch: diagonal half bg, half text
						swatch.style.background = `linear-gradient(135deg, ${bgPreview} 50%, ${textPreview} 50%)`
						swatch.title = `Background: ${colorClasses.bg!.value} / Text: ${colorClasses.text!.value}`
					} else if (bgParsed && bgPreview) {
						applySwatchStyle(swatch, bgParsed.colorName, bgPreview)
						swatch.title = `Background: ${colorClasses.bg!.value}`
					} else if (textParsed && textPreview) {
						applySwatchStyle(swatch, textParsed.colorName, textPreview)
						swatch.title = `Text: ${colorClasses.text!.value}`
					}

					swatch.onclick = (e) => {
						e.stopPropagation()
						if (cmsId && onColorClick) onColorClick(cmsId, rect)
					}
					toolbarRef.current.appendChild(swatch)
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

				// Add text style buttons for elements where inline styling is unavailable
				if (needsElementLevelStyling && cmsId) {
					// Add divider if there are other toolbar items before
					if (hasColorSwatches || hasEditableAttributes) {
						const divider = document.createElement('div')
						divider.className = 'toolbar-divider'
						toolbarRef.current.appendChild(divider)
					}

					const currentClasses = textStyleClasses ?? colorClasses ?? {}

					// Bold toggle
					const boldBtn = document.createElement('button')
					const isBold = currentClasses.fontWeight?.value === 'font-bold'
					boldBtn.className = `text-style-btn${isBold ? ' active' : ''}`
					boldBtn.innerHTML = '<strong>B</strong>'
					boldBtn.title = isBold ? 'Remove bold' : 'Bold'
					boldBtn.onclick = (e) => {
						e.stopPropagation()
						const oldClass = currentClasses.fontWeight?.value || ''
						const newClass = isBold ? 'font-normal' : 'font-bold'
						onTextStyleChange!(cmsId!, 'fontWeight', oldClass, newClass)
					}
					toolbarRef.current.appendChild(boldBtn)

					// Italic toggle
					const italicBtn = document.createElement('button')
					const isItalic = currentClasses.fontStyle?.value === 'italic'
					italicBtn.className = `text-style-btn${isItalic ? ' active' : ''}`
					italicBtn.innerHTML = '<em>I</em>'
					italicBtn.title = isItalic ? 'Remove italic' : 'Italic'
					italicBtn.onclick = (e) => {
						e.stopPropagation()
						const oldClass = currentClasses.fontStyle?.value || ''
						const newClass = isItalic ? 'not-italic' : 'italic'
						onTextStyleChange!(cmsId!, 'fontStyle', oldClass, newClass)
					}
					toolbarRef.current.appendChild(italicBtn)

					// Underline toggle
					const underlineBtn = document.createElement('button')
					const isUnderline = currentClasses.textDecoration?.value === 'underline'
					underlineBtn.className = `text-style-btn${isUnderline ? ' active' : ''}`
					underlineBtn.innerHTML = '<span style="text-decoration:underline">U</span>'
					underlineBtn.title = isUnderline ? 'Remove underline' : 'Underline'
					underlineBtn.onclick = (e) => {
						e.stopPropagation()
						const oldClass = currentClasses.textDecoration?.value || ''
						const newClass = isUnderline ? 'no-underline' : 'underline'
						onTextStyleChange!(cmsId!, 'textDecoration', oldClass, newClass)
					}
					toolbarRef.current.appendChild(underlineBtn)

					// Strikethrough toggle
					const strikeBtn = document.createElement('button')
					const isStrike = currentClasses.textDecoration?.value === 'line-through'
					strikeBtn.className = `text-style-btn${isStrike ? ' active' : ''}`
					strikeBtn.innerHTML = '<span style="text-decoration:line-through">S</span>'
					strikeBtn.title = isStrike ? 'Remove strikethrough' : 'Strikethrough'
					strikeBtn.onclick = (e) => {
						e.stopPropagation()
						const oldClass = currentClasses.textDecoration?.value || ''
						const newClass = isStrike ? 'no-underline' : 'line-through'
						onTextStyleChange!(cmsId!, 'textDecoration', oldClass, newClass)
					}
					toolbarRef.current.appendChild(strikeBtn)

					// Font size dropdown
					const sizeSelect = document.createElement('select')
					sizeSelect.className = 'text-size-select'
					sizeSelect.title = 'Font size'
					const sizeOptions = [
						{ value: '', label: 'Size' },
						{ value: 'text-xs', label: 'XS' },
						{ value: 'text-sm', label: 'SM' },
						{ value: 'text-base', label: 'Base' },
						{ value: 'text-lg', label: 'LG' },
						{ value: 'text-xl', label: 'XL' },
						{ value: 'text-2xl', label: '2XL' },
						{ value: 'text-3xl', label: '3XL' },
					]
					const currentSize = currentClasses.fontSize?.value || ''
					for (const opt of sizeOptions) {
						const option = document.createElement('option')
						option.value = opt.value
						option.textContent = opt.label
						if (opt.value === currentSize) option.selected = true
						sizeSelect.appendChild(option)
					}
					sizeSelect.onchange = (e) => {
						e.stopPropagation()
						const newClass = (e.target as HTMLSelectElement).value
						if (newClass) {
							const oldClass = currentClasses.fontSize?.value || ''
							onTextStyleChange!(cmsId!, 'fontSize', oldClass, newClass)
						}
					}
					toolbarRef.current.appendChild(sizeSelect)
				}
			} else {
				toolbarRef.current.className = 'element-toolbar hidden'
			}
		}
	}, [visible, rect, isComponent, componentName, tagName, cmsId, textStyleClasses, onColorClick, onAttributeClick, onTextStyleChange])

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
