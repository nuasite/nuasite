import { useCallback, useState } from 'preact/hooks'
import { logDebug } from '../dom'
import { startDeploymentPolling } from '../editor'
import { getComponentInstances } from '../manifest'
import * as signals from '../signals'
import type { CmsConfig, CmsManifest, ComponentInstance, InsertPosition } from '../types'

/**
 * Detect whether a component is rendered from a data array via `.map()`.
 * Heuristic: if multiple component instances share the same name AND the same
 * invocationSourcePath, they are likely array-rendered.
 */
function isArrayRendered(manifest: CmsManifest, component: ComponentInstance): boolean {
	const instances = getComponentInstances(manifest)
	let count = 0
	for (const c of Object.values(instances)) {
		if (
			c.componentName === component.componentName
			&& c.invocationSourcePath === component.invocationSourcePath
		) {
			count++
			if (count > 1) return true
		}
	}
	return false
}

/** Collapse a DOM element with a smooth height transition */
function collapseElement(el: Element) {
	const htmlEl = el as HTMLElement
	htmlEl.style.overflow = 'hidden'
	htmlEl.style.height = `${htmlEl.offsetHeight}px`
	htmlEl.style.transition = 'height 0.3s ease, opacity 0.3s ease'
	// Force reflow before changing values
	void htmlEl.offsetHeight
	htmlEl.style.height = '0'
	htmlEl.style.opacity = '0'
}

export interface BlockEditorHandlersOptions {
	config: CmsConfig
	showToast: (message: string, type?: 'info' | 'success' | 'error') => void
}

/**
 * Hook providing block editor handlers for the CMS editor.
 * Uses signals directly for state management.
 */
export function useBlockEditorHandlers({
	config,
	showToast,
}: BlockEditorHandlersOptions) {
	const [blockEditorCursor, setBlockEditorCursor] = useState<{ x: number; y: number } | null>(null)

	/**
	 * Open block editor for a component, or deselect if already selected
	 */
	const handleComponentSelect = useCallback(
		(componentId: string, cursor: { x: number; y: number }) => {
			// Toggle: clicking the same component deselects it
			if (signals.currentComponentId.value === componentId) {
				signals.setCurrentComponentId(null)
				signals.setBlockEditorOpen(false)
				setBlockEditorCursor(null)
				return
			}
			signals.setCurrentComponentId(componentId)
			signals.setBlockEditorOpen(true)
			setBlockEditorCursor(cursor)
		},
		[],
	)

	/**
	 * Close block editor
	 */
	const handleBlockEditorClose = useCallback(() => {
		signals.setBlockEditorOpen(false)
		signals.setCurrentComponentId(null)
		setBlockEditorCursor(null)
	}, [])

	/**
	 * Update component props
	 */
	const handleUpdateProps = useCallback(
		(componentId: string, props: Record<string, any>) => {
			logDebug(config.debug, 'Update props for component:', componentId, props)
			// TODO: Implement prop update logic - this will require server-side file modification
			showToast('Props updated (preview only)', 'info')
		},
		[config.debug, showToast],
	)

	/**
	 * Insert a new component (or add array item if array-rendered)
	 */
	const handleInsertComponent = useCallback(
		async (
			position: InsertPosition,
			referenceComponentId: string,
			componentName: string,
			props: Record<string, any>,
		) => {
			logDebug(
				config.debug,
				'Insert component:',
				componentName,
				position,
				referenceComponentId,
				'props:',
				props,
			)

			// Check if this is an array-rendered component
			const currentManifest = signals.manifest.value
			const refComponent = currentManifest.components[referenceComponentId]
			const arrayMode = refComponent && isArrayRendered(currentManifest, refComponent)

			// Clone the existing mock preview before the block editor unmounts and removes it
			const existingMock = document.querySelector('[data-cms-preview-mock]') as HTMLElement | null
			let previewEl: HTMLElement | null = null
			if (existingMock) {
				previewEl = existingMock.cloneNode(true) as HTMLElement
				previewEl.removeAttribute('data-cms-preview-mock')
				previewEl.style.outline = 'none'
				previewEl.style.outlineOffset = ''
				previewEl.style.opacity = '1'
				existingMock.parentNode?.insertBefore(previewEl, existingMock.nextSibling)
			}

			try {
				if (arrayMode) {
					// Route to array-item endpoint
					const response = await fetch(`${config.apiBase}/add-array-item`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({
							referenceComponentId,
							position,
							props,
							meta: {
								source: 'inline-editor',
								url: window.location.href,
							},
						}),
					})

					if (!response.ok) {
						const error = await response.text()
						throw new Error(error || 'Failed to add array item')
					}

					showToast(`Item added ${position} current item`, 'success')
				} else {
					// Standard component insertion
					const response = await fetch(`${config.apiBase}/insert-component`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({
							position,
							referenceComponentId,
							componentName,
							props,
							meta: {
								source: 'inline-editor',
								url: window.location.href,
							},
						}),
					})

					if (!response.ok) {
						const error = await response.text()
						throw new Error(error || 'Failed to insert component')
					}

					showToast(`${componentName} inserted ${position} component`, 'success')
				}

				// Trigger deployment polling after successful insert
				startDeploymentPolling(config)
			} catch (error) {
				console.error('[CMS] Failed to insert component:', error)

				// Remove the preview on failure
				previewEl?.remove()

				showToast(arrayMode ? 'Failed to add array item' : 'Failed to insert component', 'error')
			}
		},
		[config.apiBase, config.debug, config, showToast],
	)

	/**
	 * Remove a block/component (or remove array item if array-rendered)
	 */
	const handleRemoveBlock = useCallback(
		async (componentId: string) => {
			logDebug(config.debug, 'Remove block:', componentId)

			// Check if this is an array-rendered component
			const currentManifest = signals.manifest.value
			const component = currentManifest.components[componentId]
			const arrayMode = component && isArrayRendered(currentManifest, component)

			// Find the element in the DOM
			const componentEl = document.querySelector(
				`[data-cms-component-id="${componentId}"]`,
			)

			// Dim the component while the API call is in progress
			if (componentEl) {
				;(componentEl as HTMLElement).style.opacity = '0.4'
				;(componentEl as HTMLElement).style.pointerEvents = 'none'
			}

			try {
				const endpoint = arrayMode ? 'remove-array-item' : 'remove-component'
				const response = await fetch(`${config.apiBase}/${endpoint}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						componentId,
						meta: {
							source: 'inline-editor',
							url: window.location.href,
						},
					}),
				})

				if (!response.ok) {
					const error = await response.text()
					throw new Error(error || `Failed to ${arrayMode ? 'remove item' : 'remove component'}`)
				}

				showToast(arrayMode ? 'Item removed' : 'Component removed', 'success')

				// Trigger deployment polling after successful remove
				startDeploymentPolling(config)

				// Visually collapse and hide the component until page refreshes after deploy
				if (componentEl) {
					collapseElement(componentEl)
				}
			} catch (error) {
				console.error('[CMS] Failed to remove component:', error)
				showToast(arrayMode ? 'Failed to remove item' : 'Failed to remove component', 'error')

				// Restore the component's appearance on failure
				if (componentEl) {
					;(componentEl as HTMLElement).style.opacity = ''
					;(componentEl as HTMLElement).style.pointerEvents = ''
				}
			}
		},
		[config.apiBase, config.debug, config, showToast],
	)

	return {
		blockEditorCursor,
		handleComponentSelect,
		handleBlockEditorClose,
		handleUpdateProps,
		handleInsertComponent,
		handleRemoveBlock,
	}
}
