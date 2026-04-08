import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { clampPanelPosition, schedulePageReload, Z_INDEX } from '../constants'
import { updateMarkdownPage } from '../markdown-api'
import { closeReferencePicker, config, manifest, referencePickerState, showToast } from '../signals'

const PANEL_WIDTH = 320

function getCollectionEntryOptions(collectionName?: string): Array<{ value: string; label: string }> {
	if (!collectionName) return []
	const def = manifest.value.collectionDefinitions?.[collectionName]
	if (!def?.entries) return []
	return def.entries.map(e => ({
		value: e.slug,
		label: e.title ?? e.slug,
	}))
}

export function ReferencePicker() {
	const state = referencePickerState.value
	const panelRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const [query, setQuery] = useState('')
	const [saving, setSaving] = useState(false)

	const options = useMemo(
		() => getCollectionEntryOptions(state.collection ?? undefined),
		[state.collection],
	)

	// Reset search when picker opens
	useEffect(() => {
		if (state.isOpen) {
			setQuery('')
			setSaving(false)
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [state.isOpen])

	const filtered = useMemo(() => {
		if (!query) return options
		const q = query.toLowerCase()
		return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
	}, [query, options])

	const currentLabel = useMemo(() => {
		if (state.isArray) return null
		return options.find(o => o.value === state.currentValue)?.label ?? state.currentValue
	}, [options, state.currentValue, state.isArray])

	const updateReference = useCallback(async (value: string | string[]) => {
		if (!state.fieldName || !state.ownerPath) return
		setSaving(true)
		try {
			const result = await updateMarkdownPage(config.value, {
				filePath: state.ownerPath,
				frontmatter: { [state.fieldName]: value },
			})
			if (result.success) {
				showToast('Reference updated', 'success')
				schedulePageReload()
			} else {
				showToast(result.error || 'Failed to update reference', 'error')
			}
		} catch {
			showToast('Failed to update reference', 'error')
		}
		closeReferencePicker()
	}, [state.fieldName, state.ownerPath])

	const handleSelect = useCallback((newValue: string) => updateReference(newValue), [updateReference])

	const handleArrayToggle = useCallback((toggledValue: string) => {
		const current = new Set(state.currentValues)
		if (current.has(toggledValue)) {
			current.delete(toggledValue)
		} else {
			current.add(toggledValue)
		}
		updateReference([...current])
	}, [state.currentValues, updateReference])

	// Close on outside click or Escape
	useEffect(() => {
		if (!state.isOpen) return
		const onMouseDown = (e: MouseEvent) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				closeReferencePicker()
			}
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') closeReferencePicker()
		}
		document.addEventListener('mousedown', onMouseDown)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('mousedown', onMouseDown)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [state.isOpen])

	if (!state.isOpen || !state.cursorPos) return null

	const position = clampPanelPosition(state.cursorPos, PANEL_WIDTH)
	const fieldLabel = (state.fieldName ?? 'reference')
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, s => s.toUpperCase())
		.trim()

	const selectedSet = useMemo(
		() => new Set(state.isArray ? state.currentValues : (state.currentValue ? [state.currentValue] : [])),
		[state.isArray, state.currentValues, state.currentValue],
	)

	return (
		<div
			ref={panelRef}
			data-cms-ui
			style={{ zIndex: Z_INDEX.MODAL, top: position.top, left: position.left, maxHeight: position.maxHeight }}
			class="fixed w-80 bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10 font-sans overflow-hidden flex flex-col"
			onMouseDown={(e: MouseEvent) => e.stopPropagation()}
			onClick={(e: MouseEvent) => e.stopPropagation()}
		>
			{saving
				? (
					<div class="flex items-center justify-center gap-2 px-4 py-6">
						<span class="inline-block w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
						<span class="text-sm text-white/80">Updating...</span>
					</div>
				)
				: (
					<>
						{/* Header */}
						<div class="px-4 pt-3 pb-2">
							<div class="text-xs text-white/50 font-medium mb-1">{fieldLabel}</div>
							{currentLabel && !state.isArray && (
								<div class="text-sm text-white/70 mb-2">
									Current: <span class="text-white">{currentLabel}</span>
								</div>
							)}
							<input
								ref={inputRef}
								type="text"
								value={query}
								placeholder="Search..."
								onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
								autocomplete="off"
								class="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-colors"
								data-cms-ui
							/>
						</div>

						{/* Options list */}
						<div class="overflow-y-auto max-h-64 px-2 pb-2">
							{filtered.length === 0
								? <div class="px-2 py-3 text-xs text-white/40 text-center">No options found</div>
								: filtered.map(opt => {
									const isSelected = selectedSet.has(opt.value)
									return (
										<button
											key={opt.value}
											type="button"
											onMouseDown={(e) => {
												e.preventDefault()
												if (state.isArray) {
													handleArrayToggle(opt.value)
												} else {
													handleSelect(opt.value)
												}
											}}
											class={`w-full text-left px-3 py-2 text-sm rounded-cms-sm transition-colors cursor-pointer flex items-center gap-2 ${
												isSelected
													? 'bg-cms-primary/15 text-white'
													: 'text-white/70 hover:bg-white/10 hover:text-white'
											}`}
											data-cms-ui
										>
											{state.isArray && (
												<span
													class={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
														isSelected ? 'bg-cms-primary border-cms-primary' : 'border-white/30 bg-white/5'
													}`}
												>
													{isSelected && (
														<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
														</svg>
													)}
												</span>
											)}
											<span class="truncate">{opt.label}</span>
											{isSelected && !state.isArray && (
												<svg class="w-4 h-4 ml-auto text-cms-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
												</svg>
											)}
										</button>
									)
								})}
						</div>
					</>
				)}
		</div>
	)
}
