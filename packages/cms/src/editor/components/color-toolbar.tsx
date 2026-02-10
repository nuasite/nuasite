import { useCallback, useEffect, useState } from 'preact/hooks'
import {
	applyColorChange,
	COLOR_PREVIEW_MAP,
	DEFAULT_TAILWIND_COLORS,
	getColorPreview,
	parseColorClass,
	SPECIAL_COLORS,
	STANDARD_SHADES,
} from '../color-utils'
import { CSS, Z_INDEX } from '../constants'
import { cn } from '../lib/cn'
import * as signals from '../signals'
import type { Attribute, AvailableColors } from '../types'

export interface ColorToolbarProps {
	visible: boolean
	rect: DOMRect | null
	element: HTMLElement | null
	availableColors: AvailableColors | undefined
	currentClasses: Record<string, Attribute> | undefined
	onColorChange?: (type: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText', oldClass: string, newClass: string, previousClassName: string, previousStyleCssText: string) => void
	onClose?: () => void
}

interface ColorSwatchProps {
	colorName: string
	shade?: string
	isSelected: boolean
	onClick: () => void
}

function ColorSwatch({ colorName, shade, isSelected, onClick }: ColorSwatchProps) {
	const preview = getColorPreview(colorName, shade)
	const isWhite = colorName === 'white' || (preview === '#ffffff')
	const isTransparent = colorName === 'transparent'

	return (
		<button
			type="button"
			onClick={onClick}
			title={shade ? `${colorName}-${shade}` : colorName}
			class={cn(
				'w-7 h-7 rounded-full border-2 transition-all cursor-pointer hover:scale-110',
				isSelected ? 'border-cms-primary ring-2 ring-cms-primary/30 scale-110' : 'border-transparent',
				isWhite && !isSelected && 'border-white/30',
			)}
			style={{
				backgroundColor: isTransparent ? 'transparent' : preview,
				backgroundImage: isTransparent
					? 'linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%, #555), linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%, #555)'
					: undefined,
				backgroundSize: isTransparent ? '8px 8px' : undefined,
				backgroundPosition: isTransparent ? '0 0, 4px 4px' : undefined,
			}}
		/>
	)
}

interface ColorSectionProps {
	title: string
	type: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText'
	currentClass: string | undefined
	availableColors: AvailableColors | undefined
	onSelect: (colorName: string, shade?: string) => void
}

function ColorSection({ title, type, currentClass, availableColors, onSelect }: ColorSectionProps) {
	const [showAllShades, setShowAllShades] = useState(false)
	const [selectedColor, setSelectedColor] = useState<string | undefined>()

	// Parse current class to get selected color
	const parsedCurrent = currentClass ? parseColorClass(currentClass) : undefined

	// Get popular colors for quick selection
	const popularColors = [
		{ name: 'transparent', shade: undefined },
		{ name: 'white', shade: undefined },
		{ name: 'black', shade: undefined },
		{ name: 'slate', shade: '500' },
		{ name: 'gray', shade: '500' },
		{ name: 'red', shade: '500' },
		{ name: 'orange', shade: '500' },
		{ name: 'amber', shade: '500' },
		{ name: 'yellow', shade: '500' },
		{ name: 'green', shade: '500' },
		{ name: 'blue', shade: '500' },
		{ name: 'indigo', shade: '500' },
		{ name: 'purple', shade: '500' },
	]

	// Check if a color is selected
	const isColorSelected = (colorName: string, shade?: string) => {
		if (!parsedCurrent) return false
		if (parsedCurrent.colorName !== colorName) return false
		if (shade && parsedCurrent.shade !== shade) return false
		if (!shade && parsedCurrent.shade) return false
		return true
	}

	// Handle color selection
	const handleSelect = (colorName: string, shade?: string) => {
		onSelect(colorName, shade)
	}

	// Get all colors with shades
	const allColors = availableColors?.colors
		? availableColors.colors.map(color => ({
			name: color.name,
			shades: Object.keys(color.values).filter(s => s !== '').sort((a, b) => Number(a) - Number(b)), // Extract and sort shade keys
			isCustom: color.isCustom ?? false,
		}))
		: [
			...SPECIAL_COLORS.filter(c => c === 'white' || c === 'black').map(name => ({
				name,
				shades: [] as string[],
				isCustom: false,
			})),
			...DEFAULT_TAILWIND_COLORS.map(name => ({
				name,
				shades: [...STANDARD_SHADES],
				isCustom: false,
			})),
		]

	return (
		<div class="flex flex-col gap-3">
			<div class="text-xs font-medium text-white/50 uppercase tracking-wide">{title}</div>

			{/* Popular colors grid */}
			<div class="flex flex-wrap gap-2">
				{popularColors.map(({ name, shade }) => (
					<ColorSwatch
						key={`${name}-${shade || 'base'}`}
						colorName={name}
						shade={shade}
						isSelected={isColorSelected(name, shade)}
						onClick={() => handleSelect(name, shade)}
					/>
				))}
			</div>

			{/* Show more button */}
			<button
				type="button"
				onClick={() => setShowAllShades(!showAllShades)}
				class="text-xs text-white/50 hover:text-white cursor-pointer text-left font-medium"
			>
				{showAllShades ? 'Show less' : 'More colors...'}
			</button>

			{/* All colors with shades */}
			{showAllShades && (
				<div class="flex flex-col gap-3 max-h-48 overflow-y-auto pr-1">
					{allColors.filter(c => c.shades.length > 0).map(color => (
						<div key={color.name} class="flex flex-col gap-1.5">
							<div class="text-xs text-white/40 capitalize">{color.name}</div>
							<div class="flex flex-wrap gap-1.5">
								{color.shades.map(shade => (
									<ColorSwatch
										key={`${color.name}-${shade}`}
										colorName={color.name}
										shade={shade}
										isSelected={isColorSelected(color.name, shade)}
										onClick={() => handleSelect(color.name, shade)}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export function ColorToolbar({
	visible,
	rect,
	element,
	availableColors,
	currentClasses,
	onColorChange,
	onClose,
}: ColorToolbarProps) {
	// Handle color selection
	const handleColorSelect = useCallback(
		(type: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText', colorName: string, shade?: string) => {
			if (!element) return

			// Capture className and inline styles before DOM mutation for undo support
			const previousClassName = element.className
			const previousStyleCssText = element.style.cssText

			const result = applyColorChange(element, type, colorName, shade, availableColors)
			if (result && onColorChange) {
				onColorChange(type, result.oldClass, result.newClass, previousClassName, previousStyleCssText)
			}
		},
		[element, onColorChange, availableColors],
	)

	// Close on click outside
	useEffect(() => {
		if (!visible) return

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			// Don't close if clicking on CMS UI elements
			if (target.closest('[data-cms-ui]')) return
			onClose?.()
		}

		// Delay adding listener to avoid immediate close
		const timeout = setTimeout(() => {
			document.addEventListener('click', handleClickOutside)
		}, 100)

		return () => {
			clearTimeout(timeout)
			document.removeEventListener('click', handleClickOutside)
		}
	}, [visible, onClose])

	if (!visible || !rect) {
		return null
	}

	return (
		<div
			data-cms-ui
			onMouseDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
			class="right-8 top-8 bottom-8 fixed text-xs w-2xs"
			style={{
				zIndex: Z_INDEX.MODAL,
				fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
			}}
		>
			<div class="bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-cms-lg p-4 flex flex-col gap-4 h-full overflow-y-auto">
				{/* Header */}
				<div class="flex items-center justify-between">
					<span class="font-medium text-white">Element Colors</span>
					<button
						type="button"
						onClick={onClose}
						class="text-white/50 hover:text-white cursor-pointer p-1.5 hover:bg-white/10 rounded-full transition-colors"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* Background color section */}
				<ColorSection
					title="Background"
					type="bg"
					currentClass={currentClasses?.bg?.value}
					availableColors={availableColors}
					onSelect={(colorName, shade) => handleColorSelect('bg', colorName, shade)}
				/>

				{/* Divider */}
				<div class="h-px bg-white/10" />

				{/* Text color section */}
				<ColorSection
					title="Text"
					type="text"
					currentClass={currentClasses?.text?.value}
					availableColors={availableColors}
					onSelect={(colorName, shade) => handleColorSelect('text', colorName, shade)}
				/>

				{/* Divider */}
				<div class="h-px bg-white/10" />

				{/* Border color section */}
				<ColorSection
					title="Border"
					type="border"
					currentClass={currentClasses?.border?.value}
					availableColors={availableColors}
					onSelect={(colorName, shade) => handleColorSelect('border', colorName, shade)}
				/>

				{/* Divider */}
				<div class="h-px bg-white/10" />

				{/* Hover Background color section */}
				<ColorSection
					title="Hover Background"
					type="hoverBg"
					currentClass={currentClasses?.hoverBg?.value}
					availableColors={availableColors}
					onSelect={(colorName, shade) => handleColorSelect('hoverBg', colorName, shade)}
				/>

				{/* Divider */}
				<div class="h-px bg-white/10" />

				{/* Hover Text color section */}
				<ColorSection
					title="Hover Text"
					type="hoverText"
					currentClass={currentClasses?.hoverText?.value}
					availableColors={availableColors}
					onSelect={(colorName, shade) => handleColorSelect('hoverText', colorName, shade)}
				/>
			</div>
		</div>
	)
}
