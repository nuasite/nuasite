import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Z_INDEX } from '../constants'
import { cn } from '../lib/cn'
import * as signals from '../signals'
import { saveBgImageEditsToStorage } from '../storage'
import { FieldLabel, ImageField, SelectField } from './fields'

export interface BgImageOverlayProps {
	visible: boolean
	rect: DOMRect | null
	element: HTMLElement | null
	cmsId: string | null
}

/** Map bg-size class to CSS value for inline preview */
const BG_SIZE_CSS: Record<string, string> = {
	'bg-auto': 'auto',
	'bg-cover': 'cover',
	'bg-contain': 'contain',
}

/** Map bg-position class to CSS value for inline preview */
const BG_POSITION_CSS: Record<string, string> = {
	'bg-center': 'center',
	'bg-top': 'top',
	'bg-bottom': 'bottom',
	'bg-left': 'left',
	'bg-right': 'right',
	'bg-top-left': 'top left',
	'bg-top-right': 'top right',
	'bg-bottom-left': 'bottom left',
	'bg-bottom-right': 'bottom right',
}

/** Map bg-repeat class to CSS value for inline preview */
const BG_REPEAT_CSS: Record<string, string> = {
	'bg-repeat': 'repeat',
	'bg-no-repeat': 'no-repeat',
	'bg-repeat-x': 'repeat-x',
	'bg-repeat-y': 'repeat-y',
	'bg-repeat-round': 'round',
	'bg-repeat-space': 'space',
}

/** Extract image URL from bg-[url('...')] class */
function extractUrlFromClass(cls: string): string {
	const match = cls.match(/^bg-\[url\(['"]?([^'")\]]+)['"]?\)\]$/)
	return match?.[1] ?? ''
}

const SIZE_OPTIONS = [
	{ value: 'bg-auto', label: 'Auto' },
	{ value: 'bg-contain', label: 'Contain' },
	{ value: 'bg-cover', label: 'Cover' },
]

const POSITION_OPTIONS = [
	{ value: 'bg-top-left', label: 'Top Left' },
	{ value: 'bg-top', label: 'Top' },
	{ value: 'bg-top-right', label: 'Top Right' },
	{ value: 'bg-left', label: 'Left' },
	{ value: 'bg-center', label: 'Center' },
	{ value: 'bg-right', label: 'Right' },
	{ value: 'bg-bottom-left', label: 'Bottom Left' },
	{ value: 'bg-bottom', label: 'Bottom' },
	{ value: 'bg-bottom-right', label: 'Bottom Right' },
]

const REPEAT_OPTIONS = [
	{ value: 'bg-repeat', label: 'Repeat' },
	{ value: 'bg-no-repeat', label: 'No Repeat' },
	{ value: 'bg-repeat-x', label: 'Repeat X' },
	{ value: 'bg-repeat-y', label: 'Repeat Y' },
]

/**
 * Background image overlay component.
 * Shows a floating badge on hover and opens a right-side settings panel on click.
 */
export function BgImageOverlay({ visible, rect, element, cmsId }: BgImageOverlayProps) {
	const [panelOpen, setPanelOpen] = useState(false)
	// Capture target when panel opens so it stays stable when hover moves away
	const panelTargetRef = useRef<{ cmsId: string; element: HTMLElement } | null>(null)

	// Close panel when hovering a different bg-image element
	useEffect(() => {
		if (cmsId && panelTargetRef.current && cmsId !== panelTargetRef.current.cmsId) {
			setPanelOpen(false)
			panelTargetRef.current = null
		}
	}, [cmsId])

	// Close on click outside
	useEffect(() => {
		if (!panelOpen) return

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			if (target.closest('[data-cms-ui]')) return
			setPanelOpen(false)
			panelTargetRef.current = null
		}

		const timeout = setTimeout(() => {
			document.addEventListener('click', handleClickOutside)
		}, 100)

		return () => {
			clearTimeout(timeout)
			document.removeEventListener('click', handleClickOutside)
		}
	}, [panelOpen])

	const handleBadgeClick = useCallback((e: MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (panelOpen) {
			setPanelOpen(false)
			panelTargetRef.current = null
		} else if (cmsId && element) {
			setPanelOpen(true)
			panelTargetRef.current = { cmsId, element }
		}
	}, [panelOpen, cmsId, element])

	const handleClose = useCallback(() => {
		setPanelOpen(false)
		panelTargetRef.current = null
	}, [])

	// Use panel target (stable) or hover target for reading change data
	const activeCmsId = panelTargetRef.current?.cmsId ?? cmsId
	const activeElement = panelTargetRef.current?.element ?? element

	const handleImageUrlChange = useCallback((url: string) => {
		if (!activeElement || !activeCmsId) return
		const newBgImageClass = `bg-[url('${url}')]`
		applyBgImageUpdate(activeElement, activeCmsId, { newBgImageClass })
	}, [activeElement, activeCmsId])

	const handleBrowse = useCallback(() => {
		if (!activeElement || !activeCmsId) return
		signals.openMediaLibraryWithCallback((url: string) => {
			const newBgImageClass = `bg-[url('${url}')]`
			applyBgImageUpdate(activeElement, activeCmsId, { newBgImageClass })
		})
	}, [activeElement, activeCmsId])

	const handleSizeChange = useCallback((value: string) => {
		if (!activeElement || !activeCmsId) return
		applyBgImageUpdate(activeElement, activeCmsId, { newBgSize: value })
	}, [activeElement, activeCmsId])

	const handlePositionChange = useCallback((value: string) => {
		if (!activeElement || !activeCmsId) return
		applyBgImageUpdate(activeElement, activeCmsId, { newBgPosition: value })
	}, [activeElement, activeCmsId])

	const handleRepeatChange = useCallback((value: string) => {
		if (!activeElement || !activeCmsId) return
		applyBgImageUpdate(activeElement, activeCmsId, { newBgRepeat: value })
	}, [activeElement, activeCmsId])

	// Read change data for the active target
	// Subscribe to signal for reactivity
	const _bgChanges = signals.pendingBgImageChanges.value
	const change = activeCmsId ? signals.getPendingBgImageChange(activeCmsId) : null
	const currentUrl = change ? extractUrlFromClass(change.newBgImageClass) : ''

	// Per-field dirty tracking
	const isImageDirty = change ? change.newBgImageClass !== change.originalBgImageClass : false
	const isSizeDirty = change ? change.newBgSize !== change.originalBgSize : false
	const isPositionDirty = change ? change.newBgPosition !== change.originalBgPosition : false
	const isRepeatDirty = change ? change.newBgRepeat !== change.originalBgRepeat : false

	let dirtyCount = 0
	if (isImageDirty) dirtyCount++
	if (isSizeDirty) dirtyCount++
	if (isPositionDirty) dirtyCount++
	if (isRepeatDirty) dirtyCount++

	// Don't render anything if badge isn't visible and panel isn't open
	if (!visible && !panelOpen) return null

	// Badge positioning: top-right of element
	const badgeLeft = rect ? rect.right - 110 : 0
	const badgeTop = rect ? rect.top + 6 : 0

	return (
		<>
			{/* Badge - floating at element top-right */}
			{visible && rect && (
				<div
					data-cms-ui
					onClick={handleBadgeClick}
					class="fixed flex items-center gap-1.5 px-2.5 py-1 bg-cms-dark/90 border border-white/15 rounded-full text-white text-[11px] font-medium cursor-pointer backdrop-blur-sm transition-all hover:bg-cms-dark hover:border-cms-primary/50 whitespace-nowrap"
					style={{
						left: `${badgeLeft}px`,
						top: `${badgeTop}px`,
						zIndex: Z_INDEX.HIGHLIGHT,
						fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
					}}
				>
					<svg class="w-3.5 h-3.5 fill-current flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
						<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
					</svg>
					<span>Background</span>
				</div>
			)}

			{/* Panel - right-side fixed modal */}
			{panelOpen && change && (
				<div
					data-cms-ui
					onMouseDown={(e) => e.stopPropagation()}
					onClick={(e) => e.stopPropagation()}
					class="right-8 top-8 bottom-8 fixed text-xs w-80"
					style={{
						zIndex: Z_INDEX.MODAL,
						fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
					}}
				>
					<div class="bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-cms-lg flex flex-col h-full overflow-hidden">
						{/* Header */}
						<div class="flex items-center justify-between p-4 border-b border-white/10">
							<div class="flex items-center gap-2">
								<span class="font-medium text-white">Background Image</span>
								{dirtyCount > 0 && (
									<span class="px-2 py-0.5 text-xs font-medium bg-cms-primary/20 text-cms-primary rounded-full">
										{dirtyCount}
									</span>
								)}
							</div>
							<button
								type="button"
								onClick={handleClose}
								class="text-white/50 hover:text-white cursor-pointer p-1.5 hover:bg-white/10 rounded-full transition-colors"
								data-cms-ui
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>

						{/* Content */}
						<div class="flex-1 overflow-y-auto p-4">
							<div class="space-y-3">
								{/* Image URL */}
								<ImageField
									label="Image URL"
									value={currentUrl || undefined}
									placeholder="/assets/image.png"
									onChange={handleImageUrlChange}
									onBrowse={handleBrowse}
									isDirty={isImageDirty}
									onReset={isImageDirty
										? () => {
											if (activeElement && activeCmsId) {
												applyBgImageUpdate(activeElement, activeCmsId, { newBgImageClass: change.originalBgImageClass })
											}
										}
										: undefined}
								/>

								<div class="h-px bg-white/5" />

								{/* Size */}
								<div class="space-y-1.5">
									<FieldLabel
										label="Size"
										isDirty={isSizeDirty}
										onReset={isSizeDirty
											? () => {
												if (activeElement && activeCmsId) {
													applyBgImageUpdate(activeElement, activeCmsId, { newBgSize: change.originalBgSize || '' })
												}
											}
											: undefined}
									/>
									<div class="flex gap-1">
										{SIZE_OPTIONS.map(({ value, label }) => (
											<button
												key={value}
												type="button"
												onClick={() => handleSizeChange(value)}
												data-cms-ui
												class={cn(
													'flex-1 px-3 py-2 rounded-cms-sm text-sm border transition-colors cursor-pointer',
													change.newBgSize === value
														? 'bg-white/10 border-cms-primary text-white'
														: 'bg-white/10 border-white/20 text-white/70 hover:border-white/40 hover:text-white',
												)}
											>
												{label}
											</button>
										))}
									</div>
								</div>

								<div class="h-px bg-white/5" />

								{/* Position */}
								<div class="space-y-1.5">
									<FieldLabel
										label="Position"
										isDirty={isPositionDirty}
										onReset={isPositionDirty
											? () => {
												if (activeElement && activeCmsId) {
													applyBgImageUpdate(activeElement, activeCmsId, { newBgPosition: change.originalBgPosition || '' })
												}
											}
											: undefined}
									/>
									<div class="inline-grid grid-cols-3 gap-0.5 bg-white/10 border border-white/20 rounded-cms-sm p-1">
										{POSITION_OPTIONS.map(({ value, label }) => (
											<button
												key={value}
												type="button"
												onClick={() => handlePositionChange(value)}
												title={label}
												data-cms-ui
												class={cn(
													'w-7 h-7 flex items-center justify-center rounded-sm transition-colors cursor-pointer',
													change.newBgPosition === value
														? 'bg-cms-primary'
														: 'hover:bg-white/15',
												)}
											>
												<div
													class={cn(
														'w-1.5 h-1.5 rounded-full',
														change.newBgPosition === value ? 'bg-cms-primary-text' : 'bg-white/40',
													)}
												/>
											</button>
										))}
									</div>
								</div>

								<div class="h-px bg-white/5" />

								{/* Repeat */}
								<SelectField
									label="Repeat"
									value={change.newBgRepeat || undefined}
									options={REPEAT_OPTIONS}
									onChange={handleRepeatChange}
									isDirty={isRepeatDirty}
									onReset={isRepeatDirty
										? () => {
											if (activeElement && activeCmsId) {
												applyBgImageUpdate(activeElement, activeCmsId, { newBgRepeat: change.originalBgRepeat || '' })
											}
										}
										: undefined}
									allowEmpty={false}
								/>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	)
}

/**
 * Safely swap a class on an element using string manipulation.
 * Avoids classList which can corrupt bg-[url('...')] tokens containing
 * brackets, quotes, and other special characters.
 */
function swapClass(el: HTMLElement, oldClass: string | undefined, newClass: string): void {
	let classes = el.className

	// Remove old class using padded exact-match to avoid partial matches
	if (oldClass) {
		const padded = ` ${classes} `
		const idx = padded.indexOf(` ${oldClass} `)
		if (idx !== -1) {
			classes = (padded.slice(0, idx) + ' ' + padded.slice(idx + oldClass.length + 2)).trim().replace(/\s+/g, ' ')
		}
	}

	// Add new class if not already present
	if (newClass) {
		const padded = ` ${classes} `
		if (!padded.includes(` ${newClass} `)) {
			classes = classes ? `${classes} ${newClass}` : newClass
		}
	}

	el.className = classes
}

/**
 * Apply a partial bg image update to the element and signals.
 */
function applyBgImageUpdate(
	element: HTMLElement,
	cmsId: string,
	updates: Partial<{
		newBgImageClass: string
		newBgSize: string
		newBgPosition: string
		newBgRepeat: string
	}>,
): void {
	const change = signals.getPendingBgImageChange(cmsId)
	if (!change) return

	const newChange = { ...change }

	// Apply bg image class change
	if (updates.newBgImageClass !== undefined) {
		swapClass(element, newChange.newBgImageClass, updates.newBgImageClass)
		newChange.newBgImageClass = updates.newBgImageClass

		const url = extractUrlFromClass(updates.newBgImageClass)
		element.style.backgroundImage = `url('${url}')`
	}

	// Apply bg size change
	if (updates.newBgSize !== undefined) {
		swapClass(element, newChange.newBgSize, updates.newBgSize)
		newChange.newBgSize = updates.newBgSize

		element.style.backgroundSize = BG_SIZE_CSS[updates.newBgSize] ?? ''
	}

	// Apply bg position change
	if (updates.newBgPosition !== undefined) {
		swapClass(element, newChange.newBgPosition, updates.newBgPosition)
		newChange.newBgPosition = updates.newBgPosition

		element.style.backgroundPosition = BG_POSITION_CSS[updates.newBgPosition] ?? ''
	}

	// Apply bg repeat change
	if (updates.newBgRepeat !== undefined) {
		swapClass(element, newChange.newBgRepeat, updates.newBgRepeat)
		newChange.newBgRepeat = updates.newBgRepeat

		element.style.backgroundRepeat = BG_REPEAT_CSS[updates.newBgRepeat] ?? ''
	}

	// Check dirty state
	newChange.isDirty = newChange.newBgImageClass !== newChange.originalBgImageClass
		|| newChange.newBgSize !== newChange.originalBgSize
		|| newChange.newBgPosition !== newChange.originalBgPosition
		|| newChange.newBgRepeat !== newChange.originalBgRepeat

	signals.setPendingBgImageChange(cmsId, newChange)
	saveBgImageEditsToStorage(signals.pendingBgImageChanges.value)
}
