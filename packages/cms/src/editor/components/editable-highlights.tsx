import { useEffect, useRef } from 'preact/hooks'
import { Z_INDEX } from '../constants'
import * as signals from '../signals'

export interface EditableHighlightsProps {
	visible: boolean
}

interface HighlightRect {
	cmsId: string
	type: 'text' | 'component' | 'image'
	rect: DOMRect
}

/**
 * Renders lightweight dashed outlines around all editable elements.
 * Uses a single canvas-like approach with Shadow DOM for performance.
 */
export function EditableHighlights({ visible }: EditableHighlightsProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const shadowRootRef = useRef<ShadowRoot | null>(null)
	const overlaysContainerRef = useRef<HTMLDivElement | null>(null)
	const rafRef = useRef<number | null>(null)

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
					width: 100%;
					height: 100%;
					pointer-events: none;
					z-index: ${Z_INDEX.HIGHLIGHT};
				}

				.highlights-container {
					position: fixed;
					top: 0;
					left: 0;
					width: 100%;
					height: 100%;
					pointer-events: none;
				}

				.highlight-overlay {
					position: fixed;
					box-sizing: border-box;
					border: 2px dashed #1A1A1A;
					border-radius: 4px;
					pointer-events: none;
					opacity: 0.5;
					transition: opacity 100ms ease;
				}

				.highlight-overlay.component {
					border-style: solid;
				}

				.highlight-overlay.image {
					border-style: dotted;
				}

				.highlights-container.hidden {
					display: none;
				}
			`

			overlaysContainerRef.current = document.createElement('div')
			overlaysContainerRef.current.className = 'highlights-container hidden'

			shadowRootRef.current.appendChild(style)
			shadowRootRef.current.appendChild(overlaysContainerRef.current)
		}
	}, [])

	// Update highlights when visible changes or on scroll/resize
	useEffect(() => {
		if (!overlaysContainerRef.current) return

		if (!visible) {
			overlaysContainerRef.current.className = 'highlights-container hidden'
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current)
				rafRef.current = null
			}
			return
		}

		overlaysContainerRef.current.className = 'highlights-container'

		const updateHighlights = () => {
			if (!overlaysContainerRef.current || !visible) return

			const highlights = collectEditableElements()
			renderHighlights(overlaysContainerRef.current, highlights)
		}

		// Initial render
		updateHighlights()

		// Use RAF loop for smooth updates during scroll
		let lastScrollY = window.scrollY
		let lastScrollX = window.scrollX

		const rafLoop = () => {
			if (!visible) return

			// Only update if scroll position changed
			if (window.scrollY !== lastScrollY || window.scrollX !== lastScrollX) {
				lastScrollY = window.scrollY
				lastScrollX = window.scrollX
				updateHighlights()
			}

			rafRef.current = requestAnimationFrame(rafLoop)
		}

		rafRef.current = requestAnimationFrame(rafLoop)

		// Listen for resize
		const handleResize = () => {
			updateHighlights()
		}

		window.addEventListener('resize', handleResize)

		return () => {
			window.removeEventListener('resize', handleResize)
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current)
				rafRef.current = null
			}
		}
	}, [visible])

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
				zIndex: Z_INDEX.HIGHLIGHT,
			}}
		/>
	)
}

/**
 * Collect all editable elements from the DOM
 */
function collectEditableElements(): HighlightRect[] {
	const highlights: HighlightRect[] = []
	const manifest = signals.manifest.value

	// Query all elements with CMS data attributes
	const textElements = document.querySelectorAll('[data-cms-id]')
	const componentElements = document.querySelectorAll('[data-cms-component-id]')
	const imageElements = document.querySelectorAll('img[data-cms-img]')

	// Process text elements
	textElements.forEach((el) => {
		const cmsId = el.getAttribute('data-cms-id')
		if (!cmsId) return

		// Skip if this is also a component or image
		if (el.hasAttribute('data-cms-component-id') || el.tagName === 'IMG') return

		// Skip if not in manifest (invalid element)
		if (!manifest.entries[cmsId]) return

		const rect = el.getBoundingClientRect()
		// Skip elements not in viewport or too small
		if (rect.width < 10 || rect.height < 10) return
		if (rect.bottom < 0 || rect.top > window.innerHeight) return
		if (rect.right < 0 || rect.left > window.innerWidth) return

		highlights.push({ cmsId, type: 'text', rect })
	})

	// Process component elements
	componentElements.forEach((el) => {
		const componentId = el.getAttribute('data-cms-component-id')
		if (!componentId) return

		// Skip if not in manifest
		if (!manifest.components[componentId]) return

		const rect = el.getBoundingClientRect()
		if (rect.width < 10 || rect.height < 10) return
		if (rect.bottom < 0 || rect.top > window.innerHeight) return
		if (rect.right < 0 || rect.left > window.innerWidth) return

		highlights.push({ cmsId: componentId, type: 'component', rect })
	})

	// Process image elements
	imageElements.forEach((el) => {
		const cmsId = el.getAttribute('data-cms-img')
		if (!cmsId) return

		const rect = el.getBoundingClientRect()
		if (rect.width < 10 || rect.height < 10) return
		if (rect.bottom < 0 || rect.top > window.innerHeight) return
		if (rect.right < 0 || rect.left > window.innerWidth) return

		highlights.push({ cmsId, type: 'image', rect })
	})

	return highlights
}

/**
 * Render highlight overlays efficiently by reusing DOM elements
 */
function renderHighlights(container: HTMLDivElement, highlights: HighlightRect[]): void {
	// Get existing overlay elements
	const existingOverlays = container.querySelectorAll('.highlight-overlay')
	const existingCount = existingOverlays.length
	const neededCount = highlights.length

	// Update or create overlays
	highlights.forEach((highlight, index) => {
		let overlay: HTMLDivElement

		if (index < existingCount) {
			// Reuse existing overlay
			overlay = existingOverlays[index] as HTMLDivElement
		} else {
			// Create new overlay
			overlay = document.createElement('div')
			overlay.className = 'highlight-overlay'
			container.appendChild(overlay)
		}

		// Update class based on type
		overlay.className = `highlight-overlay ${highlight.type}`

		// Update position
		overlay.style.left = `${highlight.rect.left - 6}px`
		overlay.style.top = `${highlight.rect.top - 6}px`
		overlay.style.width = `${highlight.rect.width + 12}px`
		overlay.style.height = `${highlight.rect.height + 12}px`
	})

	// Remove extra overlays
	for (let i = neededCount; i < existingCount; i++) {
		existingOverlays[i]!.remove()
	}
}
