import { useEffect, useRef } from 'preact/hooks'
import { Z_INDEX } from '../constants'
import * as signals from '../signals'

export interface ImageOverlayProps {
	visible: boolean
	rect: DOMRect | null
	element: HTMLImageElement | null
	cmsId: string | null
}

/**
 * Shadow DOM-based image overlay component.
 * Shows a clickable overlay on image elements to guide users to replace images.
 */
export function ImageOverlay({ visible, rect, element, cmsId }: ImageOverlayProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const shadowRootRef = useRef<ShadowRoot | null>(null)
	const overlayRef = useRef<HTMLDivElement | null>(null)

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
					z-index: ${Z_INDEX.HIGHLIGHT};
				}

				.image-overlay {
					position: fixed;
					box-sizing: border-box;
					transition: all 150ms ease;
					display: flex;
					align-items: center;
					justify-content: center;
					pointer-events: auto;
					cursor: pointer;
					background: rgba(26, 26, 26, 0.7);
					border: 2px solid rgba(255, 255, 255, 0.1);
					border-radius: 16px;
					backdrop-filter: blur(4px);
				}

				.image-overlay.hidden {
					opacity: 0;
					pointer-events: none;
				}

				.image-overlay.visible {
					opacity: 1;
				}

				.image-overlay:hover {
					background: rgba(26, 26, 26, 0.85);
					border-color: rgba(223, 255, 64, 0.5);
				}

				.overlay-content {
					display: flex;
					flex-direction: column;
					align-items: center;
					gap: 10px;
					color: white;
					text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
				}

				.overlay-icon {
					width: 32px;
					height: 32px;
					fill: currentColor;
				}

				.overlay-text {
					font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
					font-size: 13px;
					font-weight: 500;
					background: rgba(255, 255, 255, 0.1);
					padding: 8px 16px;
					border-radius: 9999px;
				}
			`

			overlayRef.current = document.createElement('div')
			overlayRef.current.className = 'image-overlay hidden'
			overlayRef.current.innerHTML = `
				<div class="overlay-content">
					<svg class="overlay-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
						<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
					</svg>
					<span class="overlay-text">Change image</span>
				</div>
			`

			shadowRootRef.current.appendChild(style)
			shadowRootRef.current.appendChild(overlayRef.current)
		}
	}, [])

	// Handle click on overlay
	useEffect(() => {
		if (!overlayRef.current) return

		const handleClick = (e: MouseEvent) => {
			if (!element || !cmsId) return

			// Check if there's an editable text element at this position that should take precedence
			// This allows clicking on text that's positioned over images
			const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY)
			for (const el of elementsAtPoint) {
				// If we hit the image first, capture the click for the overlay
				if (el === element) break

				// If there's a contentEditable element above the image, forward the click to it
				if (el instanceof HTMLElement && el.contentEditable === 'true') {
					e.preventDefault()
					e.stopPropagation()
					// Focus the element and place cursor at click position
					el.focus()
					// Try to place cursor at the click position using caretPositionFromPoint
					const caretPos = document.caretPositionFromPoint?.(e.clientX, e.clientY)
						?? (document as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY)
					if (caretPos) {
						const selection = window.getSelection()
						if (selection) {
							selection.removeAllRanges()
							const range = document.createRange()
							if ('offsetNode' in caretPos) {
								// caretPositionFromPoint result
								range.setStart(caretPos.offsetNode, caretPos.offset)
							} else {
								// caretRangeFromPoint result (Range)
								range.setStart(caretPos.startContainer, caretPos.startOffset)
							}
							range.collapse(true)
							selection.addRange(range)
						}
					}
					return
				}
			}

			e.preventDefault()
			e.stopPropagation()

			// Open media library with callback to replace the image
			signals.openMediaLibraryWithCallback((url: string, alt: string) => {
				// Track the change BEFORE modifying element.src
				const currentChange = signals.getPendingImageChange(cmsId)
				const originalSrc = currentChange?.originalSrc ?? element.getAttribute('src') ?? element.src
				const originalAlt = currentChange?.originalAlt ?? element.alt ?? ''
				const originalSrcSet = currentChange?.originalSrcSet ?? element.getAttribute('srcset') ?? ''
				const isDirty = url !== originalSrc

				// Update the image element
				element.src = url
				// Clear srcset so browser uses the new src
				element.removeAttribute('srcset')
				if (alt) {
					element.alt = alt
				}

				if (currentChange) {
					signals.updatePendingImageChange(cmsId, (change) => ({
						...change,
						newSrc: url,
						newAlt: alt || change.originalAlt,
						isDirty,
					}))
				} else {
					// Create pending change if it doesn't exist
					signals.setPendingImageChange(cmsId, {
						element,
						originalSrc,
						newSrc: url,
						originalAlt,
						newAlt: alt || originalAlt,
						originalSrcSet,
						isDirty,
					})
				}
			})
		}

		overlayRef.current.addEventListener('click', handleClick)
		return () => {
			overlayRef.current?.removeEventListener('click', handleClick)
		}
	}, [element, cmsId])

	// Update overlay visibility and position
	useEffect(() => {
		if (!overlayRef.current) return

		if (!visible || !rect) {
			overlayRef.current.className = 'image-overlay hidden'
			return
		}

		overlayRef.current.className = 'image-overlay visible'

		// Position the overlay to cover the image
		overlayRef.current.style.left = `${rect.left}px`
		overlayRef.current.style.top = `${rect.top}px`
		overlayRef.current.style.width = `${rect.width}px`
		overlayRef.current.style.height = `${rect.height}px`
	}, [visible, rect])

	return (
		<div
			ref={containerRef}
			style={{
				position: 'fixed',
				top: 0,
				left: 0,
				width: 0,
				height: 0,
				pointerEvents: 'none',
				zIndex: Z_INDEX.HIGHLIGHT,
			}}
		/>
	)
}
