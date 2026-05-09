import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { cn } from '../lib/cn'
import { HighlightMatch } from './fields'
import { PrimaryButton } from './modal-shell'

export interface LinkSuggestion {
	value: string
	label: string
	description?: string
}

export interface LinkEditPopoverProps {
	initialUrl: string
	suggestions?: LinkSuggestion[]
	onApply: (url: string) => void
	onRemove?: () => void
	onClose: () => void
	/** Use static positioning instead of absolute (for inline contexts) */
	inline?: boolean
}

export function LinkEditPopover({ initialUrl, suggestions, onApply, onRemove, onClose, inline }: LinkEditPopoverProps) {
	const inputRef = useRef<HTMLInputElement>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const [query, setQuery] = useState(initialUrl)
	const [showSuggestions, setShowSuggestions] = useState(false)
	const [highlightedIndex, setHighlightedIndex] = useState(-1)

	const filtered = useMemo(() => {
		if (!suggestions?.length) return []
		if (!query || query === 'https://') return suggestions
		const q = query.toLowerCase()
		return suggestions.filter(
			o => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
		)
	}, [query, suggestions])

	useEffect(() => {
		const input = inputRef.current
		if (input) {
			input.focus()
			input.select()
		}
	}, [])

	// Close on click outside — uses `click` in bubble phase so form submit
	// (which fires synchronously during the button's click) completes first
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (rootRef.current && !e.composedPath().includes(rootRef.current)) {
				onClose()
			}
		}
		document.addEventListener('click', handler)
		return () => document.removeEventListener('click', handler)
	}, [onClose])

	// Scroll highlighted item into view
	useEffect(() => {
		if (highlightedIndex >= 0 && listRef.current) {
			const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined
			item?.scrollIntoView({ block: 'nearest' })
		}
	}, [highlightedIndex])

	const handleSubmit = useCallback((e: Event) => {
		e.preventDefault()
		const url = inputRef.current?.value.trim()
		if (url) {
			onApply(url)
		}
	}, [onApply])

	const selectOption = useCallback((value: string) => {
		if (inputRef.current) inputRef.current.value = value
		setQuery(value)
		setShowSuggestions(false)
		onApply(value)
	}, [onApply])

	const handleInput = useCallback((e: Event) => {
		const v = (e.target as HTMLInputElement).value
		setQuery(v)
		setShowSuggestions(true)
		setHighlightedIndex(-1)
	}, [])

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			if (showSuggestions && filtered.length > 0) {
				e.preventDefault()
				e.stopPropagation()
				setShowSuggestions(false)
				return
			}
			e.preventDefault()
			e.stopPropagation()
			onClose()
			return
		}

		if (!showSuggestions || filtered.length === 0) return

		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setHighlightedIndex(i => Math.max(i - 1, 0))
		} else if (e.key === 'Enter' && highlightedIndex >= 0) {
			e.preventDefault()
			selectOption(filtered[highlightedIndex]!.value)
		}
	}, [showSuggestions, filtered, highlightedIndex, selectOption, onClose])

	const handleFocus = useCallback(() => {
		setShowSuggestions(true)
	}, [])

	const handleBlur = useCallback(() => {
		setTimeout(() => setShowSuggestions(false), 150)
	}, [])

	const showDropdown = showSuggestions && filtered.length > 0

	return (
		<div
			ref={rootRef}
			class={inline ? 'slide-in' : 'relative z-[9999] slide-in shrink-0'}
			data-cms-ui
		>
			<form
				onSubmit={handleSubmit}
				class={cn(
					'flex items-center gap-2',
					inline ? 'py-1.5' : 'px-4 py-2 bg-cms-dark border-b border-white/10',
				)}
			>
				<svg class="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
					/>
				</svg>

				<div class="flex-1 min-w-0 relative">
					<input
						ref={inputRef}
						type="text"
						defaultValue={initialUrl}
						placeholder="https://example.com or /page"
						onInput={handleInput}
						onFocus={handleFocus}
						onBlur={handleBlur}
						onKeyDown={handleKeyDown}
						autocomplete="off"
						class="w-full bg-white/5 border border-white/10 rounded-cms-sm px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/30 outline-none focus:border-white/40 transition-colors"
						data-cms-ui
					/>
					{showDropdown && (
						<div
							ref={listRef}
							class="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-cms-dark border border-white/15 rounded-cms-sm shadow-lg"
							data-cms-ui
						>
							{filtered.map((opt, i) => (
								<button
									key={opt.value}
									type="button"
									onMouseDown={(e) => {
										e.preventDefault()
										selectOption(opt.value)
									}}
									class={cn(
										'w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer',
										i === highlightedIndex
											? 'bg-white/15 text-white'
											: 'text-white/70 hover:bg-white/10 hover:text-white',
									)}
									data-cms-ui
								>
									<span class="block truncate font-medium">
										<HighlightMatch text={opt.label} query={query === 'https://' ? '' : query} />
									</span>
									{opt.description && (
										<span class="block truncate text-white/40">
											<HighlightMatch text={opt.description} query={query === 'https://' ? '' : query} />
										</span>
									)}
								</button>
							))}
						</div>
					)}
				</div>

				<PrimaryButton type="submit" className="px-3 py-1.5 text-[12px] rounded-cms-sm shrink-0">
					Apply
				</PrimaryButton>

				{onRemove && (
					<button
						type="button"
						onClick={onRemove}
						class="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-cms-sm transition-colors shrink-0"
						title="Remove link"
						data-cms-ui
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
							/>
						</svg>
					</button>
				)}

				<button
					type="button"
					onClick={onClose}
					class="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-cms-sm transition-colors shrink-0"
					title="Cancel"
					data-cms-ui
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</form>
		</div>
	)
}
