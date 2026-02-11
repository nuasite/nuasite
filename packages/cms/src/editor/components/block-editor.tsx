import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { LAYOUT } from '../constants'
import { getComponentDefinition, getComponentDefinitions, getComponentInstance, getComponentInstances } from '../manifest'
import { manifest } from '../signals'
import type { ComponentProp, InsertPosition } from '../types'

export interface BlockEditorProps {
	visible: boolean
	componentId: string | null
	rect: DOMRect | null
	onClose: () => void
	onUpdateProps: (componentId: string, props: Record<string, any>) => void
	onInsertComponent: (
		position: InsertPosition,
		referenceComponentId: string,
		componentName: string,
		props: Record<string, any>,
	) => void
	onRemoveBlock: (componentId: string) => void
}

type EditorMode = 'edit' | 'insert-picker' | 'insert-props' | 'confirm-remove'

export function BlockEditor({
	visible,
	componentId,
	rect,
	onClose,
	onUpdateProps,
	onInsertComponent,
	onRemoveBlock,
}: BlockEditorProps) {
	const [mode, setMode] = useState<EditorMode>('edit')
	const [insertPosition, setInsertPosition] = useState<InsertPosition>('after')
	const [selectedComponent, setSelectedComponent] = useState<string | null>(null)
	const [propValues, setPropValues] = useState<Record<string, any>>({})
	const containerRef = useRef<HTMLDivElement>(null)
	const mockPreviewRef = useRef<HTMLElement | null>(null)
	const removeOverlayRef = useRef<HTMLElement | null>(null)
	const [editorPosition, setEditorPosition] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 0 })
	const componentDefinitions = getComponentDefinitions(manifest.value)
	const currentInstance = componentId ? getComponentInstance(manifest.value, componentId) : null
	const currentDefinition = currentInstance ? getComponentDefinition(manifest.value, currentInstance.componentName) : null

	// Detect if this component is rendered from a data array (.map pattern)
	const isArrayItem = useMemo(() => {
		if (!currentInstance) return false
		const instances = getComponentInstances(manifest.value)
		let count = 0
		for (const c of Object.values(instances)) {
			if (
				c.componentName === currentInstance.componentName
				&& c.invocationSourcePath === currentInstance.invocationSourcePath
			) {
				count++
				if (count > 1) return true
			}
		}
		return false
	}, [currentInstance])

	// Reset internal state when modal opens or a different component is selected
	useEffect(() => {
		if (visible) {
			setMode('edit')
			setSelectedComponent(null)
			setInsertPosition('after')
		}
	}, [visible, componentId])

	useEffect(() => {
		if (currentInstance) {
			setPropValues(currentInstance.props || {})
		}
	}, [currentInstance])

	useEffect(() => {
		if (!visible) return

		const updatePosition = () => {
			const editorWidth = LAYOUT.BLOCK_EDITOR_WIDTH
			const editorHeight = LAYOUT.BLOCK_EDITOR_HEIGHT
			const padding = LAYOUT.VIEWPORT_PADDING
			const viewportWidth = window.innerWidth
			const viewportHeight = window.innerHeight

			let top: number
			let left: number

			if (rect) {
				top = rect.bottom + padding
				left = rect.left

				if (top + editorHeight > viewportHeight - padding) {
					top = Math.max(padding, rect.top - editorHeight - padding)
				}

				if (top < padding) {
					top = Math.max(padding, (viewportHeight - editorHeight) / 2)
				}

				if (left + editorWidth > viewportWidth - padding) {
					left = viewportWidth - editorWidth - padding
				}
				if (left < padding) {
					left = padding
				}
			} else {
				top = (viewportHeight - editorHeight) / 2
				left = (viewportWidth - editorWidth) / 2
			}

			// Clamp top so the panel never extends past the viewport bottom
			top = Math.max(padding, Math.min(top, viewportHeight - padding - 100))
			const maxHeight = viewportHeight - top - padding

			setEditorPosition({ top, left, maxHeight })
		}

		updatePosition()
		window.addEventListener('resize', updatePosition)
		window.addEventListener('scroll', updatePosition)

		return () => {
			window.removeEventListener('resize', updatePosition)
			window.removeEventListener('scroll', updatePosition)
		}
	}, [visible, rect])

	// Inject/remove inline mock preview into the real page at the insertion point
	useEffect(() => {
		if (mode !== 'insert-props' || !selectedComponent || !componentId) {
			// Clean up if we exit insert-props mode
			if (mockPreviewRef.current) {
				mockPreviewRef.current.remove()
				mockPreviewRef.current = null
			}
			return
		}

		const def = componentDefinitions[selectedComponent]
		if (!def?.previewUrl) return

		// Find the reference component element in the page
		const refEl = document.querySelector(`[data-cms-component-id="${componentId}"]`)
		if (!refEl) return

		// Create the mock wrapper
		const mockEl = document.createElement('div')
		mockEl.setAttribute('data-cms-preview-mock', 'true')
		mockEl.style.cssText =
			'outline: 2px dashed rgba(59, 130, 246, 0.6); outline-offset: -2px; position: relative; opacity: 0.75; transition: opacity 0.2s;'

		// Insert at the correct position
		if (insertPosition === 'before') {
			refEl.parentNode?.insertBefore(mockEl, refEl)
		} else {
			refEl.parentNode?.insertBefore(mockEl, refEl.nextSibling)
		}
		mockPreviewRef.current = mockEl

		// Fetch preview HTML and inject the component content
		fetch(def.previewUrl)
			.then((res) => res.text())
			.then((html) => {
				const parser = new DOMParser()
				const doc = parser.parseFromString(html, 'text/html')
				const container = doc.querySelector('.cms-preview-container')
				if (container && mockPreviewRef.current) {
					mockPreviewRef.current.innerHTML = container.innerHTML
				}
			})
			.catch(() => {
				// Silently ignore fetch errors - the mock just stays empty
			})

		// Scroll the mock into view
		mockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

		return () => {
			mockEl.remove()
			mockPreviewRef.current = null
		}
	}, [mode, selectedComponent, componentId, insertPosition, componentDefinitions[selectedComponent ?? '']])

	// Update text props in the inline mock when propValues change
	useEffect(() => {
		if (mode !== 'insert-props' || !mockPreviewRef.current) return
		const propEls = mockPreviewRef.current.querySelectorAll('[data-cms-preview-prop]')
		for (const el of propEls) {
			const propName = el.getAttribute('data-cms-preview-prop')
			if (propName && propValues[propName] !== undefined) {
				el.textContent = String(propValues[propName])
			}
		}
	}, [propValues, mode])

	// Show red overlay on the component when in confirm-remove mode
	useEffect(() => {
		if (mode !== 'confirm-remove' || !componentId) {
			if (removeOverlayRef.current) {
				removeOverlayRef.current.remove()
				removeOverlayRef.current = null
			}
			return
		}

		const targetEl = document.querySelector(`[data-cms-component-id="${componentId}"]`) as HTMLElement | null
		if (!targetEl) return

		// Create overlay positioned on top of the component
		const overlay = document.createElement('div')
		overlay.setAttribute('data-cms-remove-overlay', 'true')
		overlay.style.cssText =
			'position: absolute; inset: 0; background: rgba(239, 68, 68, 0.15); outline: 2px dashed rgba(239, 68, 68, 0.7); outline-offset: -2px; pointer-events: none; z-index: 9999; transition: opacity 0.2s;'

		// Ensure the target is positioned so the overlay can cover it
		const originalPosition = targetEl.style.position
		if (getComputedStyle(targetEl).position === 'static') {
			targetEl.style.position = 'relative'
		}
		targetEl.appendChild(overlay)
		removeOverlayRef.current = overlay

		targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

		return () => {
			overlay.remove()
			removeOverlayRef.current = null
			// Restore original position if we changed it
			if (originalPosition !== undefined) {
				targetEl.style.position = originalPosition
			}
		}
	}, [mode, componentId])

	const handlePropChange = (propName: string, value: string) => {
		setPropValues(prev => ({ ...prev, [propName]: value }))
	}

	const handleSave = () => {
		if (componentId) {
			onUpdateProps(componentId, propValues)
			onClose()
		}
	}

	const handleStartInsert = (position: InsertPosition) => {
		setInsertPosition(position)

		if (isArrayItem && currentInstance) {
			// For array items, skip the component picker — use the same component type
			const definition = componentDefinitions[currentInstance.componentName]
			if (definition) {
				const defaultProps: Record<string, any> = {}
				for (const prop of definition.props) {
					if (prop.defaultValue !== undefined) {
						defaultProps[prop.name] = prop.defaultValue
					} else if (prop.required) {
						defaultProps[prop.name] = ''
					}
				}
				setSelectedComponent(currentInstance.componentName)
				setPropValues(defaultProps)
				setMode('insert-props')
				return
			}
		}

		setMode('insert-picker')
		setSelectedComponent(null)
		setPropValues({})
	}

	const handleSelectComponentForInsert = (componentName: string) => {
		const definition = componentDefinitions[componentName]
		if (!definition) return

		// Initialize with default values
		const defaultProps: Record<string, any> = {}
		for (const prop of definition.props) {
			if (prop.defaultValue !== undefined) {
				defaultProps[prop.name] = prop.defaultValue
			} else if (prop.required) {
				defaultProps[prop.name] = ''
			}
		}

		setSelectedComponent(componentName)
		setPropValues(defaultProps)
		setMode('insert-props')
	}

	const handleConfirmInsert = () => {
		if (selectedComponent && componentId) {
			onInsertComponent(insertPosition, componentId, selectedComponent, propValues)
			onClose()
		}
	}

	const handleBackToEdit = () => {
		setMode('edit')
		setSelectedComponent(null)
		setPropValues(currentInstance?.props || {})
	}

	if (!visible) return null

	return (
		<>
			{/* Backdrop overlay — transparent so the page remains visible */}
			<div
				data-cms-ui
				onClick={onClose}
				onMouseDown={(e: MouseEvent) => e.stopPropagation()}
				class="fixed inset-0 z-2147483646"
			/>

			{/* Editor panel */}
			<div
				ref={containerRef}
				data-cms-ui
				onMouseDown={(e: MouseEvent) => e.stopPropagation()}
				onClick={(e: MouseEvent) => e.stopPropagation()}
				class="fixed z-2147483647 w-100 max-w-[calc(100vw-32px)] bg-cms-dark shadow-[0_8px_32px_rgba(0,0,0,0.4)] font-sans text-sm overflow-hidden flex flex-col rounded-cms-xl border border-white/10"
				style={{
					top: `${editorPosition.top}px`,
					left: `${editorPosition.left}px`,
					maxHeight: `${editorPosition.maxHeight}px`,
				}}
			>
				{/* Header */}
				<div class="px-5 py-4 flex justify-between items-center border-b border-white/10">
					<span class="font-semibold text-white">
						{mode === 'edit'
							? (
								currentDefinition
									? (isArrayItem ? `Edit ${currentDefinition.name} Item` : `Edit ${currentDefinition.name}`)
									: 'Block Editor'
							)
							: mode === 'confirm-remove'
							? (
								isArrayItem
									? `Remove ${currentDefinition?.name ?? ''} Item`
									: `Remove ${currentDefinition?.name ?? 'Component'}`
							)
							: mode === 'insert-picker'
							? (
								`Insert ${insertPosition === 'before' ? 'Before' : 'After'}`
							)
							: (
								isArrayItem ? `Add ${selectedComponent} Item` : `Add ${selectedComponent}`
							)}
					</span>
					<button
						onClick={onClose}
						class="bg-white/10 border-none cursor-pointer p-1.5 text-white/80 hover:bg-white/20 hover:text-white transition-colors rounded-full w-8 h-8 flex items-center justify-center text-lg"
					>
						✕
					</button>
				</div>

				{/* Content */}
				<div class="p-5 overflow-y-auto flex-1 bg-cms-dark">
					{mode === 'edit' && currentDefinition
						? (
							<>
								{/* Insert buttons */}
								<div class="mb-5 flex gap-2">
									<button
										onClick={() => handleStartInsert('before')}
										class="flex-1 py-2.5 px-3 bg-white/10 text-white/80 rounded-cms-md cursor-pointer text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-white/20 hover:text-white transition-colors"
									>
										<span class="text-base">↑</span> {isArrayItem ? 'Add item before' : 'Insert before'}
									</button>
									<button
										onClick={() => handleStartInsert('after')}
										class="flex-1 py-2.5 px-3 bg-white/10 text-white/80 rounded-cms-md cursor-pointer text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-white/20 hover:text-white transition-colors"
									>
										<span class="text-base">↓</span> {isArrayItem ? 'Add item after' : 'Insert after'}
									</button>
								</div>

								{/* Props editor */}
								<div class="mb-5">
									<div class="text-xs font-medium text-white/50 tracking-wide mb-3 uppercase">
										Properties
									</div>
									{currentDefinition.props.map((prop) => (
										<PropEditor
											key={prop.name}
											prop={prop}
											value={propValues[prop.name] || ''}
											onChange={(value) => handlePropChange(prop.name, value)}
										/>
									))}
								</div>

								{/* Actions */}
								<div class="flex gap-2 justify-between pt-4 border-t border-white/10 mt-4">
									<button
										onClick={() => setMode('confirm-remove')}
										class="px-4 py-2.5 bg-cms-error text-white rounded-cms-pill cursor-pointer hover:bg-red-600 transition-colors font-medium"
									>
										{isArrayItem ? 'Remove item' : 'Remove'}
									</button>
									<div class="flex gap-2">
										<button
											onClick={onClose}
											class="px-4 py-2.5 bg-white/10 text-white/80 rounded-cms-pill cursor-pointer hover:bg-white/20 hover:text-white transition-colors font-medium"
										>
											Cancel
										</button>
										<button
											onClick={handleSave}
											class="px-4 py-2.5 bg-cms-primary text-cms-primary-text rounded-cms-pill cursor-pointer hover:bg-cms-primary-hover transition-all font-medium"
										>
											Save
										</button>
									</div>
								</div>
							</>
						)
						: mode === 'confirm-remove'
						? (
							<div class="text-center py-4">
								<div class="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-cms-md mb-5 text-[13px] text-white">
									{isArrayItem
										? (
											<>
												This <strong>{currentDefinition?.name}</strong> item will be removed from the data array. This cannot be undone.
											</>
										)
										: (
											<>
												The <strong>{currentDefinition?.name}</strong> component highlighted in the page will be removed. This cannot be undone.
											</>
										)}
								</div>
								<div class="flex gap-2 justify-end pt-4 border-t border-white/10 mt-4">
									<button
										onClick={handleBackToEdit}
										class="px-4 py-2.5 bg-white/10 text-white/80 rounded-cms-pill cursor-pointer hover:bg-white/20 hover:text-white transition-colors font-medium"
									>
										Cancel
									</button>
									<button
										onClick={() => {
											if (componentId) {
												onRemoveBlock(componentId)
												onClose()
											}
										}}
										class="px-4 py-2.5 bg-cms-error text-white rounded-cms-pill cursor-pointer hover:bg-red-600 transition-colors font-medium"
									>
										{isArrayItem ? 'Confirm remove item' : 'Confirm remove'}
									</button>
								</div>
							</div>
						)
						: mode === 'insert-props' && selectedComponent
						? (
							<>
								{/* New component props */}
								<div class="mb-5">
									<div class="px-4 py-3 bg-white/10 rounded-cms-md mb-4 text-[13px] text-white">
										{isArrayItem
											? (
												<>
													Adding new <strong>{selectedComponent}</strong> item {insertPosition} current item
												</>
											)
											: (
												<>
													Inserting <strong>{selectedComponent}</strong> {insertPosition} current component
												</>
											)}
									</div>
									{componentDefinitions[selectedComponent]?.props.map((prop) => (
										<PropEditor
											key={prop.name}
											prop={prop}
											value={propValues[prop.name] || ''}
											onChange={(value) => handlePropChange(prop.name, value)}
										/>
									))}
								</div>

								<div class="flex gap-2 justify-end pt-4 border-t border-white/10 mt-4">
									<button
										onClick={() => isArrayItem ? handleBackToEdit() : setMode('insert-picker')}
										class="px-4 py-2.5 bg-white/10 text-white/80 rounded-cms-pill cursor-pointer hover:bg-white/20 hover:text-white transition-colors font-medium"
									>
										Back
									</button>
									<button
										onClick={handleConfirmInsert}
										class="px-4 py-2.5 bg-cms-primary text-cms-primary-text rounded-cms-pill cursor-pointer hover:bg-cms-primary-hover transition-all font-medium"
									>
										{isArrayItem ? 'Add item' : 'Insert component'}
									</button>
								</div>
							</>
						)
						: mode === 'insert-picker'
						? (
							/* Component picker for insertion */
							<div>
								<div class="text-xs font-medium text-white/50 tracking-wide mb-4 uppercase">
									Select component to insert
								</div>
								<div class="flex flex-col gap-2">
									{Object.values(componentDefinitions).map((def) => (
										<button
											key={def.name}
											onClick={() => handleSelectComponentForInsert(def.name)}
											class="p-4 bg-white/5 border border-white/10 rounded-cms-md cursor-pointer text-left transition-all hover:border-cms-primary/50 hover:bg-white/10 group"
										>
											{def.previewUrl && (
												<div class="mb-3 rounded overflow-hidden bg-white h-30 relative">
													{(() => {
														const pw = def.previewWidth ?? 1280
														const scale = 320 / pw
														return (
															<iframe
																src={def.previewUrl}
																class="border-none pointer-events-none"
																style={{ width: `${pw}px`, height: `${Math.round(120 / scale)}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}
																sandbox="allow-same-origin"
																loading="lazy"
																tabIndex={-1}
															/>
														)
													})()}
												</div>
											)}
											<div class="font-medium text-white">{def.name}</div>
											{def.description && (
												<div class="text-xs text-white/50 mt-1">
													{def.description}
												</div>
											)}
											<div class="text-[11px] text-white/40 mt-2 font-mono">
												{def.props.length} props
												{def.slots && def.slots.length > 0 && ` • ${def.slots.length} slots`}
											</div>
										</button>
									))}
								</div>
								<div class="mt-5 pt-4 border-t border-white/10">
									<button
										onClick={handleBackToEdit}
										class="w-full px-4 py-2.5 bg-white/10 text-white/80 rounded-cms-pill cursor-pointer hover:bg-white/20 hover:text-white transition-colors font-medium"
									>
										Back to edit
									</button>
								</div>
							</div>
						)
						: (
							/* No component selected - show placeholder */
							<div class="text-center text-white/50 py-8">
								<p>Select a component to edit its properties.</p>
							</div>
						)}
				</div>
			</div>
		</>
	)
}

interface PropEditorProps {
	prop: ComponentProp
	value: string
	onChange: (value: string) => void
}

function PropEditor({ prop, value, onChange }: PropEditorProps) {
	const isBoolean = prop.type === 'boolean'
	const isNumber = prop.type === 'number'

	return (
		<div class="mb-4">
			<label class="block text-[13px] font-medium text-white mb-1.5">
				{prop.name}
				{prop.required && <span class="text-cms-error ml-1">*</span>}
			</label>
			{prop.description && (
				<div class="text-[11px] text-white/50 mb-1.5">
					{prop.description}
				</div>
			)}
			{isBoolean
				? (
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={value === 'true'}
							onChange={(e) => onChange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
							class="accent-cms-primary w-5 h-5 rounded"
						/>
						<span class="text-[13px] text-white">
							{value === 'true' ? 'Enabled' : 'Disabled'}
						</span>
					</label>
				)
				: (
					<input
						type={isNumber ? 'number' : 'text'}
						value={value}
						onInput={(e) => onChange((e.target as HTMLInputElement).value)}
						placeholder={prop.defaultValue || `Enter ${prop.name}...`}
						class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
					/>
				)}
			<div class="text-[10px] text-white/40 mt-1.5 font-mono">
				{prop.type}
			</div>
		</div>
	)
}
