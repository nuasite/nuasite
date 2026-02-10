import { useCallback, useEffect, useState } from 'preact/hooks'
import { CSS, Z_INDEX } from '../constants'
import { cn } from '../lib/cn'
import * as signals from '../signals'
import {
	getCurrentStyle,
	getStyledSpanFromSelection,
	getTextSelection,
	isValidStyleValue,
	parseStyleClasses,
	type StyleCategory,
	type StyleValue,
	TAILWIND_STYLES,
	type TextStyle,
	toggleStyle,
} from '../text-styling'

export interface TextStyleToolbarProps {
	visible: boolean
	rect: DOMRect | null
	element: HTMLElement | null
	onStyleChange?: () => void
}

interface StyleButtonProps<C extends StyleCategory> {
	category: C
	value: StyleValue<C>
	label: string
	icon: preact.ComponentChildren
	isActive: boolean
	onClick: () => void
}

function StyleButton<C extends StyleCategory>({
	label,
	icon,
	isActive,
	onClick,
}: StyleButtonProps<C>) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			class={cn(
				'w-8 h-8 flex items-center justify-center rounded-cms-sm transition-colors cursor-pointer',
				isActive
					? 'bg-cms-primary text-cms-primary-text'
					: 'hover:bg-white/20 text-white/80 hover:text-white',
			)}
		>
			{icon}
		</button>
	)
}

interface ColorButtonProps {
	color: string
	tailwindClass: string
	label: string
	isActive: boolean
	onClick: () => void
}

function ColorButton({ color, label, isActive, onClick }: ColorButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			class={cn(
				'w-5 h-5 rounded-full border-2 transition-transform cursor-pointer',
				isActive ? 'border-cms-primary scale-125 ring-2 ring-cms-primary/30' : 'border-transparent hover:scale-110',
			)}
			style={{ backgroundColor: color }}
		/>
	)
}

// Map Tailwind color names to actual colors for preview
const COLOR_MAP: Record<string, string> = {
	inherit: '#374151',
	slate: '#334155',
	gray: '#374151',
	red: '#dc2626',
	orange: '#ea580c',
	amber: '#d97706',
	green: '#16a34a',
	blue: '#2563eb',
	purple: '#9333ea',
}

const HIGHLIGHT_MAP: Record<string, string> = {
	none: 'transparent',
	yellow: '#fef08a',
	green: '#bbf7d0',
	blue: '#bfdbfe',
	pink: '#fbcfe8',
}

export function TextStyleToolbar({ visible, rect, element, onStyleChange }: TextStyleToolbarProps) {
	const [currentStyle, setCurrentStyle] = useState<TextStyle>({})
	const [showColorPicker, setShowColorPicker] = useState(false)
	const [showHighlightPicker, setShowHighlightPicker] = useState(false)

	// Update current style when selection changes
	useEffect(() => {
		if (!visible || !element) {
			setCurrentStyle({})
			setShowColorPicker(false)
			setShowHighlightPicker(false)
			return
		}

		const updateStyle = () => {
			setCurrentStyle(getCurrentStyle(element))
		}

		updateStyle()
		document.addEventListener('selectionchange', updateStyle)
		return () => document.removeEventListener('selectionchange', updateStyle)
	}, [visible, element])

	// Handle style toggle
	const handleToggleStyle = useCallback(
		<C extends StyleCategory>(category: C, value: StyleValue<C>) => {
			if (!element) return

			// Validate the style value
			if (!isValidStyleValue(category, value)) {
				console.warn(`[CMS] Invalid style value: ${category}=${String(value)}`)
				return
			}

			const selection = getTextSelection(element)
			const existingSpan = getStyledSpanFromSelection(element)
			if (!selection && !existingSpan) {
				return
			}

			// Ensure currentEditingId is set so input event is processed
			const cmsId = element.getAttribute(CSS.ID_ATTRIBUTE)
			if (cmsId) {
				signals.setCurrentEditingId(cmsId)
			}

			// Apply the style and get the resulting span
			const resultSpan = toggleStyle(element, category, value)

			// Trigger change event on the element to update pending changes
			element.dispatchEvent(new Event('input', { bubbles: true }))

			// Update current style display from the resulting span (not from selection which may be gone)
			if (resultSpan) {
				// Style was applied/updated - read from the span directly
				setCurrentStyle(parseStyleClasses(resultSpan.className))
			} else if (existingSpan) {
				// Style was toggled off - the existing span might still exist with other styles
				// Check if the span is still in the DOM and has remaining styles
				if (existingSpan.parentElement) {
					setCurrentStyle(parseStyleClasses(existingSpan.className))
				} else {
					// Span was removed completely
					setCurrentStyle({})
				}
			} else {
				// Fallback to selection-based detection
				setCurrentStyle(getCurrentStyle(element))
			}

			onStyleChange?.()
		},
		[element, onStyleChange],
	)

	if (!visible || !rect) {
		return null
	}

	// Position toolbar above the selection
	const toolbarHeight = 44
	const toolbarWidth = 320
	let left = rect.left + rect.width / 2 - toolbarWidth / 2
	let top = rect.top - toolbarHeight - 8

	const padding = 10
	const maxLeft = window.innerWidth - toolbarWidth - padding
	const minLeft = padding

	left = Math.max(minLeft, Math.min(left, maxLeft))

	if (top < padding) {
		top = rect.bottom + 8
	}

	return (
		<div
			data-cms-ui
			onMouseDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
			style={{
				position: 'fixed',
				left: `${left}px`,
				top: `${top}px`,
				zIndex: Z_INDEX.MODAL,
				fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
				fontSize: '12px',
			}}
		>
			<div class="flex items-center gap-1 px-3 py-2 bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-cms-xl">
				{/* Bold */}
				<StyleButton
					category="weight"
					value="bold"
					label="Bold"
					isActive={currentStyle.weight === 'bold'}
					onClick={() => handleToggleStyle('weight', 'bold')}
					icon={<span class="font-bold text-sm">B</span>}
				/>

				{/* Italic */}
				<StyleButton
					category="style"
					value="italic"
					label="Italic"
					isActive={currentStyle.style === 'italic'}
					onClick={() => handleToggleStyle('style', 'italic')}
					icon={<span class="italic text-sm">I</span>}
				/>

				{/* Underline */}
				<StyleButton
					category="decoration"
					value="underline"
					label="Underline"
					isActive={currentStyle.decoration === 'underline'}
					onClick={() => handleToggleStyle('decoration', 'underline')}
					icon={<span class="underline text-sm">U</span>}
				/>

				{/* Strikethrough */}
				<StyleButton
					category="decoration"
					value="lineThrough"
					label="Strikethrough"
					isActive={currentStyle.decoration === 'lineThrough'}
					onClick={() => handleToggleStyle('decoration', 'lineThrough')}
					icon={<span class="line-through text-sm">S</span>}
				/>

				<div class="w-px h-5 bg-white/20 mx-1" />

				{/* Text Color Picker */}
				<div class="relative">
					<button
						type="button"
						onClick={() => {
							setShowColorPicker(!showColorPicker)
							setShowHighlightPicker(false)
						}}
						title="Text Color"
						class={cn(
							'w-8 h-8 flex items-center justify-center rounded-cms-sm transition-colors cursor-pointer',
							showColorPicker ? 'bg-white/20' : 'hover:bg-white/20',
						)}
					>
						<span
							class="text-sm"
							style={{
								color: currentStyle.color ? COLOR_MAP[currentStyle.color] : '#ffffff',
							}}
						>
							A
						</span>
						<div
							class="absolute bottom-1 left-2 right-2 h-0.5 rounded-full"
							style={{ backgroundColor: currentStyle.color ? COLOR_MAP[currentStyle.color] : '#ffffff' }}
						/>
					</button>

					{showColorPicker && (
						<div class="absolute top-full left-0 mt-2 p-3 bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-cms-md flex gap-2 flex-wrap w-36 z-10">
							{Object.entries(COLOR_MAP).map(([key, color]) => (
								<ColorButton
									key={key}
									color={color}
									tailwindClass={TAILWIND_STYLES.color[key as keyof typeof TAILWIND_STYLES.color]?.class || ''}
									label={TAILWIND_STYLES.color[key as keyof typeof TAILWIND_STYLES.color]?.label || key}
									isActive={currentStyle.color === key}
									onClick={() => {
										handleToggleStyle('color', key as StyleValue<'color'>)
										setShowColorPicker(false)
									}}
								/>
							))}
						</div>
					)}
				</div>

				{/* Highlight Color Picker */}
				<div class="relative">
					<button
						type="button"
						onClick={() => {
							setShowHighlightPicker(!showHighlightPicker)
							setShowColorPicker(false)
						}}
						title="Highlight"
						class={cn(
							'w-8 h-8 flex items-center justify-center rounded-cms-sm transition-colors cursor-pointer text-white/80 hover:text-white',
							showHighlightPicker ? 'bg-white/20' : 'hover:bg-white/20',
						)}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M12 20h9" />
							<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
						</svg>
						<div
							class="absolute bottom-1 left-1.5 right-1.5 h-1.5 rounded-full"
							style={{
								backgroundColor: currentStyle.highlight ? HIGHLIGHT_MAP[currentStyle.highlight] : 'transparent',
								border: currentStyle.highlight && currentStyle.highlight !== 'none' ? 'none' : '1px solid rgba(255,255,255,0.3)',
							}}
						/>
					</button>

					{showHighlightPicker && (
						<div class="absolute top-full left-0 mt-2 p-3 bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-cms-md flex gap-2 flex-wrap w-32 z-10">
							{Object.entries(HIGHLIGHT_MAP).map(([key, color]) => (
								<button
									key={key}
									type="button"
									onClick={() => {
										handleToggleStyle('highlight', key as StyleValue<'highlight'>)
										setShowHighlightPicker(false)
									}}
									title={TAILWIND_STYLES.highlight[key as keyof typeof TAILWIND_STYLES.highlight]?.label || key}
									class={cn(
										'w-5 h-5 rounded-full border-2 transition-transform cursor-pointer',
										currentStyle.highlight === key ? 'border-cms-primary scale-125 ring-2 ring-cms-primary/30' : 'border-white/20 hover:scale-110',
									)}
									style={{ backgroundColor: color === 'transparent' ? '#333' : color }}
								/>
							))}
						</div>
					)}
				</div>

				<div class="w-px h-5 bg-white/20 mx-1" />

				{/* Font Size */}
				<select
					value={currentStyle.size || 'base'}
					onChange={(e) => handleToggleStyle('size', (e.target as HTMLSelectElement).value as StyleValue<'size'>)}
					class="h-8 px-2 text-xs border border-white/20 rounded-cms-sm bg-white/10 text-white cursor-pointer hover:border-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10"
				>
					{Object.entries(TAILWIND_STYLES.size).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
				</select>
			</div>
		</div>
	)
}
