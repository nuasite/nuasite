import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { cn } from '../lib/cn'

// ============================================================================
// Field Label
// ============================================================================

export function FieldLabel({ label, isDirty, onReset }: { label: string; isDirty?: boolean; onReset?: () => void }) {
	return (
		<div class="flex items-center justify-between">
			<label class="text-xs font-medium text-white/70">{label}</label>
			{isDirty && (
				<div class="flex items-center gap-1.5">
					<span class="text-xs text-cms-primary font-medium">Modified</span>
					{onReset && (
						<button
							type="button"
							onClick={onReset}
							class="text-white/40 hover:text-white transition-colors cursor-pointer"
							title="Reset to original"
							data-cms-ui
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
							</svg>
						</button>
					)}
				</div>
			)}
		</div>
	)
}

// ============================================================================
// Text Field
// ============================================================================

export interface TextFieldProps {
	label: string
	value: string | undefined
	placeholder?: string
	onChange: (value: string) => void
	isDirty?: boolean
	onReset?: () => void
}

export function TextField({ label, value, placeholder, onChange, isDirty, onReset }: TextFieldProps) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				type="text"
				value={value ?? ''}
				placeholder={placeholder}
				onInput={(e) => onChange((e.target as HTMLInputElement).value)}
				class={cn(
					'w-full px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
					isDirty
						? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
						: 'border-white/20 focus:border-white/40 focus:ring-white/10',
				)}
				data-cms-ui
			/>
		</div>
	)
}

// ============================================================================
// Image Field (text input + Browse button)
// ============================================================================

export interface ImageFieldProps {
	label: string
	value: string | undefined
	placeholder?: string
	onChange: (value: string) => void
	onBrowse: () => void
	isDirty?: boolean
	onReset?: () => void
}

export function ImageField({ label, value, placeholder, onChange, onBrowse, isDirty, onReset }: ImageFieldProps) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<div class="flex gap-2">
				<input
					type="text"
					value={value ?? ''}
					placeholder={placeholder}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
					class={cn(
						'flex-1 px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
						isDirty
							? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
							: 'border-white/20 focus:border-white/40 focus:ring-white/10',
					)}
					data-cms-ui
				/>
				<button
					type="button"
					onClick={onBrowse}
					class="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-cms-sm text-sm text-white transition-colors cursor-pointer"
					data-cms-ui
				>
					Browse
				</button>
			</div>
		</div>
	)
}

// ============================================================================
// Color Field (color picker + hex text input)
// ============================================================================

export interface ColorFieldProps {
	label: string
	value: string | undefined
	placeholder?: string
	onChange: (value: string) => void
	isDirty?: boolean
	onReset?: () => void
}

export function ColorField({ label, value, placeholder, onChange, isDirty, onReset }: ColorFieldProps) {
	const colorValue = value || '#000000'
	// Validate hex for the native picker (must be #rrggbb)
	const isValidHex = /^#[0-9a-fA-F]{6}$/.test(colorValue)
	const pickerValue = isValidHex ? colorValue : '#000000'

	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<div class="flex gap-2">
				<input
					type="color"
					value={pickerValue}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
					class="w-10 h-[38px] p-0.5 bg-white/10 border border-white/20 rounded-cms-sm cursor-pointer"
					data-cms-ui
				/>
				<input
					type="text"
					value={value ?? ''}
					placeholder={placeholder ?? '#000000'}
					onInput={(e) => onChange((e.target as HTMLInputElement).value)}
					class={cn(
						'flex-1 px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
						isDirty
							? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
							: 'border-white/20 focus:border-white/40 focus:ring-white/10',
					)}
					data-cms-ui
				/>
			</div>
		</div>
	)
}

// ============================================================================
// Select Field (native select)
// ============================================================================

export interface SelectFieldProps {
	label: string
	value: string | undefined
	options: Array<{ value: string; label: string }>
	onChange: (value: string) => void
	isDirty?: boolean
	onReset?: () => void
	allowEmpty?: boolean
}

export function SelectField({ label, value, options, onChange, isDirty, onReset, allowEmpty = true }: SelectFieldProps) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<select
				value={value ?? ''}
				onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
				class={cn(
					'w-full px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white focus:outline-none focus:ring-1 transition-colors cursor-pointer',
					isDirty
						? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
						: 'border-white/20 focus:border-white/40 focus:ring-white/10',
				)}
				data-cms-ui
			>
				{allowEmpty && <option value="">None</option>}
				{options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
			</select>
		</div>
	)
}

// ============================================================================
// Toggle Field
// ============================================================================

export interface ToggleFieldProps {
	label: string
	value: boolean | undefined
	onChange: (value: boolean) => void
	isDirty?: boolean
	onReset?: () => void
}

export function ToggleField({ label, value, onChange, isDirty, onReset }: ToggleFieldProps) {
	const isOn = value === true

	const handleClick = useCallback((e: Event) => {
		e.preventDefault()
		e.stopPropagation()
		onChange(!isOn)
	}, [isOn, onChange])

	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<button
				type="button"
				onClick={handleClick}
				class={cn(
					'w-9 h-5 rounded-full transition-colors relative cursor-pointer flex-shrink-0',
					isOn ? 'bg-cms-primary' : 'bg-white/20',
				)}
				data-cms-ui
			>
				<span
					class={cn(
						'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm pointer-events-none',
						isOn && 'translate-x-4',
					)}
				/>
			</button>
		</div>
	)
}

// ============================================================================
// Number Field
// ============================================================================

export interface NumberFieldProps {
	label: string
	value: number | undefined
	placeholder?: string
	min?: number
	max?: number
	onChange: (value: number | undefined) => void
	isDirty?: boolean
	onReset?: () => void
}

export function NumberField({ label, value, placeholder, min, max, onChange, isDirty, onReset }: NumberFieldProps) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				type="number"
				value={value ?? ''}
				placeholder={placeholder}
				min={min}
				max={max}
				onInput={(e) => {
					const val = (e.target as HTMLInputElement).value
					onChange(val === '' ? undefined : Number(val))
				}}
				class={cn(
					'w-full px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
					isDirty
						? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
						: 'border-white/20 focus:border-white/40 focus:ring-white/10',
				)}
				data-cms-ui
			/>
		</div>
	)
}

// ============================================================================
// Highlight Match (helper for ComboBoxField)
// ============================================================================

export function HighlightMatch({ text, query }: { text: string; query: string }) {
	if (!query) return <>{text}</>
	const idx = text.toLowerCase().indexOf(query.toLowerCase())
	if (idx === -1) return <>{text}</>
	return (
		<>
			{text.slice(0, idx)}
			<span class="text-cms-primary font-semibold">{text.slice(idx, idx + query.length)}</span>
			{text.slice(idx + query.length)}
		</>
	)
}

// ============================================================================
// ComboBox Field (searchable dropdown with free-text input)
// ============================================================================

export interface ComboBoxFieldProps {
	label: string
	value: string | undefined
	placeholder?: string
	options: Array<{ value: string; label: string; description?: string }>
	onChange: (value: string) => void
	isDirty?: boolean
	onReset?: () => void
}

export function ComboBoxField({ label, value, placeholder, options, onChange, isDirty, onReset }: ComboBoxFieldProps) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const [highlightedIndex, setHighlightedIndex] = useState(-1)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	// Filter options based on query
	const filtered = useMemo(() => {
		if (!query) return options
		const q = query.toLowerCase()
		return options.filter(
			o => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
		)
	}, [query, options])

	const handleInput = useCallback((e: Event) => {
		const v = (e.target as HTMLInputElement).value
		setQuery(v)
		onChange(v)
		setIsOpen(true)
		setHighlightedIndex(-1)
	}, [onChange])

	const handleFocus = useCallback(() => {
		setIsOpen(true)
	}, [])

	const handleBlur = useCallback(() => {
		// Delay to allow click on option to register
		setTimeout(() => setIsOpen(false), 150)
	}, [])

	const selectOption = useCallback((optValue: string) => {
		onChange(optValue)
		setQuery('')
		setIsOpen(false)
	}, [onChange])

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if (!isOpen || filtered.length === 0) return
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setHighlightedIndex(i => Math.max(i - 1, 0))
		} else if (e.key === 'Enter' && highlightedIndex >= 0) {
			e.preventDefault()
			selectOption(filtered[highlightedIndex]!.value)
		} else if (e.key === 'Escape') {
			setIsOpen(false)
		}
	}, [isOpen, filtered, highlightedIndex, selectOption])

	// Scroll highlighted item into view
	useEffect(() => {
		if (highlightedIndex >= 0 && listRef.current) {
			const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined
			item?.scrollIntoView({ block: 'nearest' })
		}
	}, [highlightedIndex])

	const showDropdown = isOpen && filtered.length > 0

	return (
		<div class="space-y-1.5 relative">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				ref={inputRef}
				type="text"
				value={value ?? ''}
				placeholder={placeholder}
				onInput={handleInput}
				onFocus={handleFocus}
				onBlur={handleBlur}
				onKeyDown={handleKeyDown}
				autocomplete="off"
				class={cn(
					'w-full px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
					isDirty
						? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
						: 'border-white/20 focus:border-white/40 focus:ring-white/10',
				)}
				data-cms-ui
			/>
			{showDropdown && (
				<div
					ref={listRef}
					class="absolute z-50 left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-cms-dark border border-white/15 rounded-cms-sm shadow-lg"
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
								<HighlightMatch text={opt.label} query={query} />
							</span>
							{opt.description && (
								<span class="block truncate text-white/40">
									<HighlightMatch text={opt.description} query={query} />
								</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	)
}
