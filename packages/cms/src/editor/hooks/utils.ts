import type { RefObject } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { CSS } from '../constants'

/**
 * Check if a mouse event originates from CMS UI elements.
 * This includes the toolbar, AI chat, color picker, and other CMS overlays.
 */
export function isEventOnCmsUI(ev: MouseEvent): boolean {
	const path = ev.composedPath()
	const cmsOverlay = document.querySelector(CSS.HIGHLIGHT_ELEMENT)

	for (const el of path) {
		if (el === cmsOverlay) return true
		if (el instanceof HTMLElement) {
			// Check for CMS custom elements
			if (el.tagName?.startsWith('CMS-')) return true
			// Check for toolbar and AI chat by data attribute
			if (el.hasAttribute?.(CSS.UI_ATTRIBUTE)) return true
		}
	}
	return false
}

/**
 * Check if a target element is part of CMS UI.
 * Non-event based variant for direct element checks.
 */
export function isElementInCmsUI(target: HTMLElement | null): boolean {
	if (!target) return false
	return target.hasAttribute?.(CSS.UI_ATTRIBUTE) || !!target.closest?.(`[${CSS.UI_ATTRIBUTE}]`)
}

/**
 * Hook for tracking an element's position on scroll and resize.
 * Returns a callback to get the latest rect, and automatically updates
 * when the element scrolls or the window resizes.
 *
 * @param element - The element to track
 * @param onPositionChange - Callback when position changes
 * @param enabled - Whether tracking is enabled
 */
export function usePositionTracking(
	element: HTMLElement | null,
	onPositionChange: (rect: DOMRect | null) => void,
	enabled: boolean = true,
): void {
	const elementRef = useRef(element)
	elementRef.current = element

	useEffect(() => {
		if (!enabled || !element) return

		const updatePosition = () => {
			if (elementRef.current && document.contains(elementRef.current)) {
				onPositionChange(elementRef.current.getBoundingClientRect())
			} else {
				onPositionChange(null)
			}
		}

		window.addEventListener('scroll', updatePosition, true)
		window.addEventListener('resize', updatePosition)

		return () => {
			window.removeEventListener('scroll', updatePosition, true)
			window.removeEventListener('resize', updatePosition)
		}
	}, [element, enabled, onPositionChange])
}

/**
 * Hook for throttling a callback function.
 * Returns a throttled version that will only execute once per interval.
 */
export function useThrottle<T extends (...args: unknown[]) => void>(
	callback: T,
	intervalMs: number,
): T {
	const lastCallTime = useRef<number>(0)
	const callbackRef = useRef(callback)
	callbackRef.current = callback

	return ((...args: Parameters<T>) => {
		const now = Date.now()
		if (now - lastCallTime.current >= intervalMs) {
			lastCallTime.current = now
			callbackRef.current(...args)
		}
	}) as T
}

/**
 * Creates a ref that always contains the latest value.
 * Useful for accessing current values in event handlers without stale closures.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
	const ref = useRef(value)
	ref.current = value
	return ref
}
