import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getDropdownPosition } from '../constants'
import { useClickOutsideEscape } from '../hooks/useClickOutsideEscape'
import { useSearchFilter } from '../hooks/useSearchFilter'
import { cn } from '../lib/cn'
import { uploadMedia } from '../markdown-api'
import { config, showToast } from '../signals'

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
	maxLength?: number
	minLength?: number
	onChange: (value: string) => void
	isDirty?: boolean
	onReset?: () => void
	inputType?: string
	required?: boolean
}

export function TextField(
	{ label, value, placeholder, maxLength, minLength, onChange, isDirty, onReset, inputType = 'text', required }: TextFieldProps,
) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				type={inputType}
				value={value ?? ''}
				placeholder={placeholder}
				maxLength={maxLength}
				minLength={minLength}
				required={required}
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
	required?: boolean
}

export function ImageField({ label, value, placeholder, onChange, onBrowse, isDirty, onReset, required }: ImageFieldProps) {
	const hasImage = !!value && value.length > 0
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [isUploading, setIsUploading] = useState(false)
	const [isDragOver, setIsDragOver] = useState(false)
	// Track the src that failed so the fallback resets automatically when `value` changes
	const [failedSrc, setFailedSrc] = useState<string | null>(null)
	const showFallback = hasImage && failedSrc === value

	const handleUploadClick = useCallback(() => {
		fileInputRef.current?.click()
	}, [])

	const uploadFile = useCallback(async (file: File) => {
		const cfg = config.value
		if (!cfg) {
			showToast('CMS not configured', 'error')
			return
		}
		setIsUploading(true)
		try {
			const result = await uploadMedia(cfg, file)
			if (result.success && result.url) {
				onChange(result.url)
				showToast('File uploaded', 'success')
			} else {
				showToast(result.error || 'Upload failed', 'error')
			}
		} catch {
			showToast('Upload failed', 'error')
		} finally {
			setIsUploading(false)
		}
	}, [onChange])

	return (
		<div class="space-y-2 min-w-0">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				class="hidden"
				onChange={handleFileChange}
				data-cms-ui
			/>
			{hasImage
				? (
					<div class="w-full max-w-sm space-y-2">
						<div
							class="relative w-full rounded-cms-sm overflow-hidden bg-white/5 border border-white/10 cursor-pointer group"
							onClick={onBrowse}
							data-cms-ui
						>
							<img
								src={value}
								alt={label}
								class="w-full h-auto max-h-48 object-contain"
								onError={(e) => {
									;(e.target as HTMLImageElement).style.display = 'none'
								}}
							/>
							<div class="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-linear-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
								<span class="block text-white text-[11px] font-medium truncate" title={value}>
									{value}
								</span>
							</div>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation()
									onChange('')
								}}
								class="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-red-500/80 text-white rounded-cms-xs opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
								title="Remove image from this field"
								data-cms-ui
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						<div class="flex w-full mt-1.5 gap-2">
							<button
								type="button"
								onClick={handleUploadClick}
								disabled={isUploading}
								class="flex-1 px-3 py-1.5 bg-cms-primary hover:bg-cms-primary-hover text-cms-primary-text text-xs font-medium rounded-cms-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								data-cms-ui
							>
								{isUploading ? 'Uploading…' : 'Upload'}
							</button>
							<button
								type="button"
								onClick={onBrowse}
								class="flex-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-xs text-white rounded-cms-sm transition-colors cursor-pointer"
								data-cms-ui
							>
								Browse
							</button>
						</div>
					</div>
				)
				: (
					<div class="flex gap-2 min-w-0">
						<input
							type="text"
							value={value ?? ''}
							placeholder={placeholder}
							required={required}
							onInput={(e) => onChange((e.target as HTMLInputElement).value)}
							class={cn(
								'flex-1 min-w-0 px-3 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
								isDirty
									? 'border-cms-primary focus:border-cms-primary focus:ring-cms-primary/30'
									: 'border-white/20 focus:border-white/40 focus:ring-white/10',
							)}
							data-cms-ui
						/>
						<button
							type="button"
							onClick={onBrowse}
							class="shrink-0 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-cms-sm text-sm text-white transition-colors cursor-pointer"
							data-cms-ui
						>
							Browse
						</button>
						<button
							type="button"
							onClick={handleUploadClick}
							disabled={isUploading}
							class="shrink-0 px-3 py-2 bg-cms-primary hover:bg-cms-primary-hover text-cms-primary-text rounded-cms-sm text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
							data-cms-ui
						>
							{isUploading ? '…' : 'Upload'}
						</button>
					</div>
				)}
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
	required?: boolean
}

export function ColorField({ label, value, placeholder, onChange, isDirty, onReset, required }: ColorFieldProps) {
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
					required={required}
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
		<div class="space-y-2">
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
						'absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-sm pointer-events-none',
						isOn ? 'translate-x-4 bg-[#404040]' : 'translate-x-0 bg-white',
					)}
					style={{
						transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 200ms ease-out',
					}}
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
	step?: number
	onChange: (value: number | undefined) => void
	isDirty?: boolean
	onReset?: () => void
	required?: boolean
}

export function NumberField({ label, value, placeholder, min, max, step, onChange, isDirty, onReset, required }: NumberFieldProps) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				type="number"
				value={value ?? ''}
				placeholder={placeholder}
				min={min}
				max={max}
				step={step}
				required={required}
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
// Dropdown Panel (fixed-position container for select/combobox dropdowns)
// ============================================================================

export interface DropdownPanelProps {
	/** Ref to the trigger element — used for positioning and outside-click detection */
	triggerRef: { readonly current: HTMLElement | null }
	isOpen: boolean
	onClose: () => void
	maxHeight?: number
	children: ComponentChildren
	className?: string
	/** Forward a ref to the panel div (e.g. for keyboard-nav scroll) */
	panelRef?: { current: HTMLDivElement | null }
	/** Additional refs to exempt from outside-click detection (e.g. a wrapper containing related UI like selected tags) */
	exemptRefs?: ReadonlyArray<{ readonly current: HTMLElement | null }>
}

/**
 * Fixed-position dropdown container that escapes parent overflow clipping.
 * Handles outside-click and Escape-key dismissal.
 */
export function DropdownPanel({ triggerRef, isOpen, onClose, maxHeight = 192, children, className, panelRef, exemptRefs }: DropdownPanelProps) {
	const internalRef = useRef<HTMLDivElement>(null)
	const ref = panelRef ?? internalRef

	useClickOutsideEscape([ref, triggerRef, ...(exemptRefs ?? [])], isOpen, onClose)

	if (!isOpen) return null

	return (
		<div
			ref={ref}
			class={cn('overflow-y-auto bg-cms-dark shadow-lg', className)}
			style={getDropdownPosition(triggerRef.current, maxHeight)}
			data-cms-ui
		>
			<button
				type="button"
				onClick={onClose}
				class="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-cms-xs transition-colors z-10"
				title="Close"
				data-cms-ui
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
			{children}
		</div>
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
	required?: boolean
}

export function ComboBoxField({ label, value, placeholder, options, onChange, isDirty, onReset, required }: ComboBoxFieldProps) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const [highlightedIndex, setHighlightedIndex] = useState(-1)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	const filtered = useSearchFilter(options, query, o => `${o.label} ${o.value}`)

	const handleInput = useCallback((e: Event) => {
		const v = (e.target as HTMLInputElement).value
		setQuery(v)
		onChange(v)
		setIsOpen(true)
		setHighlightedIndex(-1)
	}, [onChange])

	const selectOption = useCallback((optValue: string) => {
		onChange(optValue)
		setQuery('')
		setIsOpen(false)
	}, [onChange])

	const closeDropdown = useCallback(() => setIsOpen(false), [])

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			if (isOpen && highlightedIndex >= 0 && filtered[highlightedIndex]) {
				selectOption(filtered[highlightedIndex]!.value)
			}
			return
		}
		if (!isOpen || filtered.length === 0) return
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setHighlightedIndex(i => Math.max(i - 1, 0))
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
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				ref={inputRef}
				type="text"
				value={value ?? ''}
				placeholder={placeholder}
				required={required}
				onInput={handleInput}
				onFocus={() => setIsOpen(true)}
				onBlur={() => setTimeout(closeDropdown, 150)}
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
			<DropdownPanel
				triggerRef={inputRef}
				isOpen={showDropdown}
				onClose={closeDropdown}
				maxHeight={160}
				panelRef={listRef}
				className="border border-white/15 rounded-cms-sm"
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
			</DropdownPanel>
		</div>
	)
}

// ============================================================================
// MultiSelect Field (searchable checkbox list with selected items as pills)
// ============================================================================

export interface MultiSelectFieldProps {
	label: string
	selected: string[]
	options: string[] | Array<{ value: string; label: string }>
	onChange: (selected: string[]) => void
	isDirty?: boolean
	onReset?: () => void
}

interface NormalizedOption {
	value: string
	label: string
}

export function MultiSelectField({ label, selected, options, onChange, isDirty, onReset }: MultiSelectFieldProps) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	const normalizedOptions = useMemo<NormalizedOption[]>(() => options.map(o => typeof o === 'string' ? { value: o, label: o } : o), [options])

	const labelMap = useMemo(() => {
		const map = new Map<string, string>()
		for (const o of normalizedOptions) map.set(o.value, o.label)
		return map
	}, [normalizedOptions])

	const filtered = useSearchFilter(normalizedOptions, query, o => `${o.label} ${o.value}`)

	const toggleOption = useCallback((value: string) => {
		if (selected.includes(value)) {
			onChange(selected.filter(s => s !== value))
		} else {
			onChange([...selected, value])
		}
	}, [selected, onChange])

	const closeDropdown = useCallback(() => setIsOpen(false), [])

	return (
		<div class="space-y-1.5" ref={containerRef} data-cms-ui>
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />

			{/* Selected pills */}
			{selected.length > 0 && (
				<div class="flex flex-wrap gap-1.5">
					{selected.map(val => (
						<span
							key={val}
							class="inline-flex items-center gap-1 px-2 py-0.5 bg-cms-primary/20 text-cms-primary text-xs rounded-full"
						>
							{labelMap.get(val) ?? val}
							<button
								type="button"
								onClick={() => toggleOption(val)}
								class="text-cms-primary/60 hover:text-cms-primary transition-colors cursor-pointer"
								data-cms-ui
							>
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</span>
					))}
				</div>
			)}

			{/* Search input */}
			<input
				ref={inputRef}
				type="text"
				value={query}
				placeholder={selected.length > 0 ? 'Search to add more...' : 'Search options...'}
				onInput={(e) => {
					setQuery((e.target as HTMLInputElement).value)
					setIsOpen(true)
				}}
				onFocus={() => setIsOpen(true)}
				autocomplete="off"
				class="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-colors"
				data-cms-ui
			/>

			<DropdownPanel
				triggerRef={inputRef}
				isOpen={isOpen}
				onClose={closeDropdown}
				maxHeight={192}
				className="border border-white/15 rounded-cms-sm"
				exemptRefs={[containerRef]}
			>
				{filtered.length === 0
					? <div class="px-3 py-2 text-xs text-white/40">No options found</div>
					: filtered.map(opt => {
						const isSelected = selected.includes(opt.value)
						return (
							<button
								key={opt.value}
								type="button"
								onMouseDown={(e) => {
									e.preventDefault()
									toggleOption(opt.value)
								}}
								class={cn(
									'w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer flex items-center gap-2',
									isSelected
										? 'bg-cms-primary/10 text-white'
										: 'text-white/70 hover:bg-white/10 hover:text-white',
								)}
								data-cms-ui
							>
								<span
									class={cn(
										'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
										isSelected
											? 'bg-cms-primary border-cms-primary'
											: 'border-white/30 bg-white/5',
									)}
								>
									{isSelected && (
										<svg class="w-3 h-3 text-cms-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
										</svg>
									)}
								</span>
								<span class="truncate font-medium">
									{query ? <HighlightMatch text={opt.label} query={query} /> : opt.label}
								</span>
							</button>
						)
					})}
			</DropdownPanel>
		</div>
	)
}
