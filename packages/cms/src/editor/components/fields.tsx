import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getDropdownPosition } from '../constants'
import { useClickOutsideEscape } from '../hooks/useClickOutsideEscape'
import { useSearchFilter } from '../hooks/useSearchFilter'
import { cn } from '../lib/cn'
import { uploadMedia } from '../markdown-api'
import { config, showToast } from '../signals'
import { STRINGS } from '../strings'

// ============================================================================
// Field Label
// ============================================================================

export function FieldLabel({ label, isDirty, onReset, tooltip }: { label: string; isDirty?: boolean; onReset?: () => void; tooltip?: string }) {
	return (
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-1.5">
				<label class="text-xs font-medium text-white/70">{label}</label>
				{tooltip && (
					<span class="relative group/tt inline-flex" data-cms-ui>
						<svg class="w-3.5 h-3.5 text-white/40 hover:text-white/70 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<span class="absolute left-0 top-full mt-1 w-64 p-2 bg-black/90 text-white text-xs rounded-cms-sm opacity-0 invisible group-hover/tt:opacity-100 group-hover/tt:visible transition-all z-50 pointer-events-none whitespace-normal">
							{tooltip}
						</span>
					</span>
				)}
			</div>
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
	tooltip?: string
}

export function TextField(
	{ label, value, placeholder, maxLength, minLength, onChange, isDirty, onReset, inputType = 'text', required, tooltip }: TextFieldProps,
) {
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} tooltip={tooltip} />
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
						? 'border-white/30 focus:border-white/40 focus:ring-white/10'
						: 'border-white/20 focus:border-white/40 focus:ring-white/10',
				)}
				data-cms-ui
			/>
		</div>
	)
}

// ============================================================================
// Image Field — drop-zone preview (click/drag to upload) + "Choose from library" link
// ============================================================================

export interface ImageFieldProps {
	label: string
	value: string | undefined
	onChange: (value: string) => void
	onBrowse: () => void
	isDirty?: boolean
	onReset?: () => void
}

export function ImageField({ label, value, onChange, onBrowse, isDirty, onReset }: ImageFieldProps) {
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
			showToast(STRINGS.media.notConfigured, 'error')
			return
		}
		setIsUploading(true)
		try {
			const result = await uploadMedia(cfg, file)
			if (result.success && result.url) {
				onChange(result.url)
				showToast(STRINGS.media.fileUploaded, 'success')
			} else {
				showToast(result.error || STRINGS.media.uploadFailed, 'error')
			}
		} catch {
			showToast(STRINGS.media.uploadFailed, 'error')
		} finally {
			setIsUploading(false)
		}
	}, [onChange])

	const handleFileChange = useCallback(async (e: Event) => {
		const target = e.target as HTMLInputElement
		const file = target.files?.[0]
		if (file) await uploadFile(file)
		target.value = ''
	}, [uploadFile])

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault()
		if (e.dataTransfer?.types.includes('Files')) setIsDragOver(true)
	}, [])

	const handleDragLeave = useCallback((e: DragEvent) => {
		// Only clear on actually leaving the drop-zone, not crossing child boundaries
		if ((e.currentTarget as Node).contains(e.relatedTarget as Node | null)) return
		setIsDragOver(false)
	}, [])

	const handleDrop = useCallback(async (e: DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)
		const file = e.dataTransfer?.files?.[0]
		if (file && file.type.startsWith('image/')) await uploadFile(file)
	}, [uploadFile])

	const containerClass = cn(
		'relative w-full rounded-cms-sm overflow-hidden bg-white/5 border group transition-colors focus:outline-none focus:ring-1 focus:ring-white/30',
		isUploading ? 'cursor-wait' : 'cursor-pointer',
		isDragOver ? 'border-cms-primary bg-cms-primary/10' : 'border-white/10 hover:border-white/20',
	)
	const overlayHint = isUploading ? 'Uploading…' : isDragOver ? 'Drop to upload' : hasImage ? 'Click to view' : 'Click or drop file'

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
			<div class="w-full max-w-sm space-y-2">
				{hasImage
					? (
						<a
							href={value}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`Open ${label.toLowerCase()} in new tab`}
							onDragOver={handleDragOver}
							onDragEnter={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							class={cn(containerClass, 'block')}
							data-cms-ui
						>
							{!showFallback
								? (
									<>
										<img
											src={value}
											alt={label}
											class="w-full h-32 object-contain"
											onError={() => setFailedSrc(value ?? null)}
										/>
										<div class="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-linear-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
											<span class="block text-white text-[11px] font-medium truncate" title={value}>
												{value}
											</span>
										</div>
									</>
								)
								: (
									<div class="w-full h-32 flex flex-col items-center justify-center gap-1 text-white/40">
										<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
											/>
										</svg>
										<span class="text-[11px] font-medium" title={value}>Image failed to load</span>
									</div>
								)}
							<div class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-20">
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										handleUploadClick()
									}}
									class="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-white/20 text-white rounded-cms-xs transition-colors cursor-pointer"
									title="Replace image"
									data-cms-ui
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-5M20 14a8 8 0 01-14 5" />
									</svg>
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										onChange('')
									}}
									class="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-red-500/80 text-white rounded-cms-xs transition-colors cursor-pointer"
									title="Remove image from this field"
									data-cms-ui
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
							{/* Hover overlay — decorative hint (pointer-events-none) */}
							<div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors pointer-events-none">
								<span class="text-white/90 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">{overlayHint}</span>
							</div>
						</a>
					)
					: (
						<div
							role="button"
							tabIndex={isUploading ? -1 : 0}
							aria-label="Upload image — click or drop a file"
							aria-busy={isUploading}
							onClick={isUploading ? undefined : handleUploadClick}
							onKeyDown={(e) => {
								if (isUploading) return
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									handleUploadClick()
								}
							}}
							onDragOver={handleDragOver}
							onDragEnter={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							class={containerClass}
							data-cms-ui
						>
							<div class="w-full h-32 flex flex-col items-center justify-center gap-1 text-white/25 group-hover:text-white/40 transition-colors">
								<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
							</div>
							<div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors pointer-events-none">
								<span class="text-white/90 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">{overlayHint}</span>
							</div>
						</div>
					)}
				<button
					type="button"
					onClick={onBrowse}
					class="block text-xs text-white/50 hover:text-white underline decoration-white/20 hover:decoration-white underline-offset-2 transition-colors cursor-pointer"
					data-cms-ui
				>
					Choose from library
				</button>
			</div>
		</div>
	)
}

// ============================================================================
// File Field — generic file picker (PDF, docs, etc.) with drop-zone + library
// ============================================================================

export interface FileFieldProps {
	label: string
	value: string | undefined
	onChange: (value: string) => void
	onBrowse: () => void
	accept?: string
	isDirty?: boolean
	onReset?: () => void
}

function getFileBasename(url: string): string {
	const clean = url.split('?')[0]?.split('#')[0] ?? url
	const last = clean.split('/').pop() ?? clean
	try {
		return decodeURIComponent(last) || last
	} catch {
		return last
	}
}

export function FileField({ label, value, onChange, onBrowse, accept, isDirty, onReset }: FileFieldProps) {
	const hasFile = !!value && value.length > 0
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [isUploading, setIsUploading] = useState(false)
	const [isDragOver, setIsDragOver] = useState(false)

	const handleUploadClick = useCallback(() => {
		fileInputRef.current?.click()
	}, [])

	const uploadFile = useCallback(async (file: File) => {
		const cfg = config.value
		if (!cfg) {
			showToast(STRINGS.media.notConfigured, 'error')
			return
		}
		setIsUploading(true)
		try {
			const result = await uploadMedia(cfg, file)
			if (result.success && result.url) {
				onChange(result.url)
				showToast(STRINGS.media.fileUploaded, 'success')
			} else {
				showToast(result.error || STRINGS.media.uploadFailed, 'error')
			}
		} catch {
			showToast(STRINGS.media.uploadFailed, 'error')
		} finally {
			setIsUploading(false)
		}
	}, [onChange])

	const handleFileChange = useCallback(async (e: Event) => {
		const target = e.target as HTMLInputElement
		const file = target.files?.[0]
		if (file) await uploadFile(file)
		target.value = ''
	}, [uploadFile])

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault()
		if (e.dataTransfer?.types.includes('Files')) setIsDragOver(true)
	}, [])

	const handleDragLeave = useCallback((e: DragEvent) => {
		if ((e.currentTarget as Node).contains(e.relatedTarget as Node | null)) return
		setIsDragOver(false)
	}, [])

	const handleDrop = useCallback(async (e: DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)
		const file = e.dataTransfer?.files?.[0]
		if (file) await uploadFile(file)
	}, [uploadFile])

	const basename = hasFile ? getFileBasename(value) : ''
	const containerClass = cn(
		'relative w-full rounded-cms-sm overflow-hidden bg-white/5 border group transition-colors focus:outline-none focus:ring-1 focus:ring-white/30',
		isUploading ? 'cursor-wait' : 'cursor-pointer',
		isDragOver ? 'border-cms-primary bg-cms-primary/10' : 'border-white/10 hover:border-white/20',
	)
	const overlayHint = isUploading ? 'Uploading…' : isDragOver ? 'Drop to upload' : hasFile ? 'Click to view' : 'Click or drop file'

	return (
		<div class="space-y-2 min-w-0">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<input
				ref={fileInputRef}
				type="file"
				accept={accept}
				class="hidden"
				onChange={handleFileChange}
				data-cms-ui
			/>
			<div class="w-full max-w-sm space-y-2">
				{hasFile
					? (
						<a
							href={value}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`Open ${basename || 'file'} in new tab`}
							onDragOver={handleDragOver}
							onDragEnter={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							class={cn(containerClass, 'block')}
							data-cms-ui
						>
							<div class="w-full h-20 flex items-center gap-3 px-3 text-white/80">
								<svg class="w-8 h-8 flex-shrink-0 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
								<div class="flex-1 min-w-0">
									<div class="text-sm font-medium truncate" title={basename}>{basename}</div>
									<div class="text-[11px] text-white/40 truncate" title={value}>{value}</div>
								</div>
							</div>
							<div class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-20">
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										handleUploadClick()
									}}
									class="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-white/20 text-white rounded-cms-xs transition-colors cursor-pointer"
									title="Replace file"
									data-cms-ui
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-5M20 14a8 8 0 01-14 5" />
									</svg>
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										onChange('')
									}}
									class="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-red-500/80 text-white rounded-cms-xs transition-colors cursor-pointer"
									title="Remove file from this field"
									data-cms-ui
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
							<div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors pointer-events-none">
								<span class="text-white/90 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">{overlayHint}</span>
							</div>
						</a>
					)
					: (
						<div
							role="button"
							tabIndex={isUploading ? -1 : 0}
							aria-label="Upload file — click or drop a file"
							aria-busy={isUploading}
							onClick={isUploading ? undefined : handleUploadClick}
							onKeyDown={(e) => {
								if (isUploading) return
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									handleUploadClick()
								}
							}}
							onDragOver={handleDragOver}
							onDragEnter={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							class={containerClass}
							data-cms-ui
						>
							<div class="w-full h-20 flex flex-col items-center justify-center gap-1 text-white/25 group-hover:text-white/40 transition-colors">
								<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
									/>
								</svg>
							</div>
							<div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors pointer-events-none">
								<span class="text-white/90 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">{overlayHint}</span>
							</div>
						</div>
					)}
				<button
					type="button"
					onClick={onBrowse}
					class="block text-xs text-white/50 hover:text-white underline decoration-white/20 hover:decoration-white underline-offset-2 transition-colors cursor-pointer"
					data-cms-ui
				>
					Choose from library
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
							? 'border-white/30 focus:border-white/40 focus:ring-white/10'
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
						? 'border-white/30 focus:border-white/40 focus:ring-white/10'
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
	const stepValue = step ?? 1
	const adjust = (delta: number) => {
		const current = typeof value === 'number' ? value : 0
		let next = current + delta * stepValue
		if (typeof min === 'number' && next < min) next = min
		if (typeof max === 'number' && next > max) next = max
		onChange(next)
	}
	return (
		<div class="space-y-1.5">
			<FieldLabel label={label} isDirty={isDirty} onReset={onReset} />
			<div class="relative">
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
						'w-full pl-3 pr-12 py-2 bg-white/10 border rounded-cms-sm text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 transition-colors',
						isDirty
							? 'border-white/30 focus:border-white/40 focus:ring-white/10'
							: 'border-white/20 focus:border-white/40 focus:ring-white/10',
					)}
					data-cms-ui
				/>
				<div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-[3px]">
					<button
						type="button"
						onClick={() => adjust(-1)}
						class="w-5 h-5 flex items-center justify-center bg-cms-primary hover:bg-cms-primary-hover text-cms-dark rounded-cms-xs transition-colors cursor-pointer"
						title="Decrease"
						data-cms-ui
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
						</svg>
					</button>
					<button
						type="button"
						onClick={() => adjust(1)}
						class="w-5 h-5 flex items-center justify-center bg-cms-primary hover:bg-cms-primary-hover text-cms-dark rounded-cms-xs transition-colors cursor-pointer"
						title="Increase"
						data-cms-ui
					>
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
						</svg>
					</button>
				</div>
			</div>
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
function getCmsPortalTarget(): HTMLElement | null {
	if (typeof document === 'undefined') return null
	const host = document.getElementById('cms-app-host')
	if (!host?.shadowRoot) return null
	return host.shadowRoot.querySelector('.cms-root') as HTMLElement | null
}

export function DropdownPanel({ triggerRef, isOpen, onClose, maxHeight = 192, children, className, panelRef, exemptRefs }: DropdownPanelProps) {
	const internalRef = useRef<HTMLDivElement>(null)
	const ref = panelRef ?? internalRef

	useClickOutsideEscape([ref, triggerRef, ...(exemptRefs ?? [])], isOpen, onClose)

	if (!isOpen) return null

	const dropdown = (
		<div
			ref={ref}
			class={cn('flex flex-col bg-cms-dark shadow-lg', className)}
			style={getDropdownPosition(triggerRef.current, maxHeight)}
			data-cms-ui
		>
			<div class="flex justify-end p-1 shrink-0 border-b border-white/5">
				<button
					type="button"
					onClick={onClose}
					class="w-5 h-5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-cms-xs transition-colors"
					title="Close"
					data-cms-ui
				>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="overflow-y-auto flex-1 min-h-0">
				{children}
			</div>
		</div>
	)

	const portalTarget = getCmsPortalTarget()
	return portalTarget ? createPortal(dropdown, portalTarget) : dropdown
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
						? 'border-white/30 focus:border-white/40 focus:ring-white/10'
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
								class="text-cms-primary/60 hover:text-red-400 transition-colors cursor-pointer"
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
