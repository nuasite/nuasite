/**
 * Shadow DOM-based highlight overlay for CMS elements.
 * This component renders highlights without modifying the target element's styles.
 */

export interface HighlightState {
	color: string
	style: 'solid' | 'dashed'
	visible: boolean
}

// Map to track highlights by element
const highlightMap = new WeakMap<HTMLElement, HTMLElement>()

// Container for all highlight overlays
let highlightContainer: HTMLElement | null = null

// Flag to track if custom element is registered
let customElementRegistered = false

/**
 * Custom element that renders a highlight overlay using Shadow DOM
 */
class CmsHighlightOverlay extends HTMLElement {
	private shadow: ShadowRoot
	private overlayElement: HTMLDivElement
	private resizeObserver: ResizeObserver | null = null
	private targetElement: HTMLElement | null = null
	private animationFrameId: number | null = null

	constructor() {
		super()
		this.shadow = this.attachShadow({ mode: 'open' })

		// Create styles
		const style = document.createElement('style')
		style.textContent = `
      :host {
        position: absolute;
        pointer-events: none;
        z-index: 2147483645;
        box-sizing: border-box;
      }
      
      .overlay {
        position: absolute;
        inset: 0;
        border-radius: 4px;
        box-sizing: border-box;
        transition: border-color 150ms ease, border-style 150ms ease;
      }
    `

		this.overlayElement = document.createElement('div')
		this.overlayElement.className = 'overlay'

		this.shadow.appendChild(style)
		this.shadow.appendChild(this.overlayElement)
	}

	connectedCallback() {
		this.startPositionTracking()
	}

	disconnectedCallback() {
		this.stopPositionTracking()
	}

	/**
	 * Set the target element to highlight
	 */
	setTarget(element: HTMLElement) {
		this.targetElement = element
		this.updatePosition()

		// Set up resize observer
		if (this.resizeObserver) {
			this.resizeObserver.disconnect()
		}

		this.resizeObserver = new ResizeObserver(() => {
			this.updatePosition()
		})
		this.resizeObserver.observe(element)
	}

	/**
	 * Set the highlight style
	 */
	setHighlightStyle(color: string, style: 'solid' | 'dashed') {
		this.overlayElement.style.borderWidth = '2px'
		this.overlayElement.style.borderColor = color
		this.overlayElement.style.borderStyle = style
	}

	/**
	 * Update position to match target element
	 */
	private updatePosition() {
		if (!this.targetElement) return

		const rect = this.targetElement.getBoundingClientRect()
		const scrollX = window.scrollX
		const scrollY = window.scrollY

		// Position with offset to give breathing room from content
		this.style.left = `${rect.left + scrollX - 6}px`
		this.style.top = `${rect.top + scrollY - 6}px`
		this.style.width = `${rect.width + 12}px`
		this.style.height = `${rect.height + 12}px`
	}

	/**
	 * Start continuous position tracking for scroll/resize
	 */
	private startPositionTracking() {
		const track = () => {
			this.updatePosition()
			this.animationFrameId = requestAnimationFrame(track)
		}
		this.animationFrameId = requestAnimationFrame(track)
	}

	/**
	 * Stop position tracking
	 */
	private stopPositionTracking() {
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId)
			this.animationFrameId = null
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect()
			this.resizeObserver = null
		}
	}
}

/**
 * Register the custom element (safe to call multiple times)
 */
function ensureCustomElementRegistered(): void {
	if (customElementRegistered) return
	if (typeof window === 'undefined' || typeof customElements === 'undefined') return

	if (!customElements.get('cms-highlight-overlay')) {
		customElements.define('cms-highlight-overlay', CmsHighlightOverlay)
	}
	customElementRegistered = true
}

/**
 * Initialize the highlight container
 */
export function initHighlightContainer(): void {
	if (typeof document === 'undefined') return
	if (highlightContainer) return

	ensureCustomElementRegistered()

	highlightContainer = document.createElement('div')
	highlightContainer.id = 'cms-highlight-container'
	highlightContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 2147483645;
  `
	document.body.appendChild(highlightContainer)
}

/**
 * Clean up the highlight container
 */
export function destroyHighlightContainer(): void {
	if (highlightContainer) {
		highlightContainer.remove()
		highlightContainer = null
	}
}

/**
 * Set highlight outline on an element using Shadow DOM overlay
 */
export function setElementHighlight(
	el: HTMLElement,
	color: string,
	style: 'solid' | 'dashed' = 'solid',
): void {
	initHighlightContainer()

	let overlay = highlightMap.get(el)

	if (!overlay) {
		overlay = document.createElement('cms-highlight-overlay') as HTMLElement
		highlightMap.set(el, overlay)
		highlightContainer?.appendChild(overlay) // Set target after adding to DOM
		;(overlay as CmsHighlightOverlay).setTarget(el)
	}

	;(overlay as CmsHighlightOverlay).setHighlightStyle(color, style)
}

/**
 * Clear highlight from an element
 */
export function clearElementHighlight(el: HTMLElement): void {
	const overlay = highlightMap.get(el)
	if (overlay) {
		overlay.remove()
		highlightMap.delete(el)
	}
}

/**
 * Clear all highlights
 */
export function clearAllHighlights(): void {
	if (highlightContainer) {
		highlightContainer.innerHTML = ''
	}
	// WeakMap entries will be garbage collected
}

// Export the class for type checking
export { CmsHighlightOverlay }
