import type { Attribute, AvailableColors, TailwindColor } from './types'

/**
 * Default Tailwind CSS v4 color names.
 */
export const DEFAULT_TAILWIND_COLORS = [
	'slate',
	'gray',
	'zinc',
	'neutral',
	'stone',
	'red',
	'orange',
	'amber',
	'yellow',
	'lime',
	'green',
	'emerald',
	'teal',
	'cyan',
	'sky',
	'blue',
	'indigo',
	'violet',
	'purple',
	'fuchsia',
	'pink',
	'rose',
] as const

/**
 * Standard Tailwind color shades.
 */
export const STANDARD_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const

/**
 * Special color values that don't have shades.
 */
export const SPECIAL_COLORS = ['transparent', 'current', 'inherit', 'white', 'black'] as const

/**
 * Map of Tailwind color names to their CSS color values for preview.
 * Uses the 500 shade as the representative color.
 * This is a fallback when availableColors is not loaded yet.
 */
export const COLOR_PREVIEW_MAP: Record<string, string> = {
	// Special colors
	transparent: 'transparent',
	current: 'currentColor',
	inherit: 'inherit',
	white: '#ffffff',
	black: '#000000',
	// Standard colors (500 shade)
	slate: '#64748b',
	gray: '#6b7280',
	zinc: '#71717a',
	neutral: '#737373',
	stone: '#78716c',
	red: '#ef4444',
	orange: '#f97316',
	amber: '#f59e0b',
	yellow: '#eab308',
	lime: '#84cc16',
	green: '#22c55e',
	emerald: '#10b981',
	teal: '#14b8a6',
	cyan: '#06b6d4',
	sky: '#0ea5e9',
	blue: '#3b82f6',
	indigo: '#6366f1',
	violet: '#8b5cf6',
	purple: '#a855f7',
	fuchsia: '#d946ef',
	pink: '#ec4899',
	rose: '#f43f5e',
	// Common custom colors
	primary: '#3b82f6',
	secondary: '#6b7280',
	accent: '#f59e0b',
}

/**
 * Map of shade numbers to their relative lightness.
 * Used to generate preview colors for different shades.
 */
export const SHADE_LIGHTNESS: Record<string, number> = {
	'50': 0.95,
	'100': 0.9,
	'200': 0.8,
	'300': 0.7,
	'400': 0.6,
	'500': 0.5,
	'600': 0.4,
	'700': 0.3,
	'800': 0.2,
	'900': 0.1,
	'950': 0.05,
}

/**
 * Non-color text-* utility classes that should NOT be treated as color classes.
 * These are Tailwind utilities like text alignment, sizing, wrapping, etc.
 */
const NON_COLOR_TEXT_CLASSES = new Set([
	// Text alignment
	'text-left',
	'text-center',
	'text-right',
	'text-justify',
	'text-start',
	'text-end',
	// Text wrapping
	'text-wrap',
	'text-nowrap',
	'text-balance',
	'text-pretty',
	// Text overflow
	'text-ellipsis',
	'text-clip',
	// Text transform (these don't start with text- but just in case)
])

/**
 * Regex patterns to match Tailwind color classes.
 */
const COLOR_CLASS_PATTERNS = {
	bg: /^bg-([a-z]+)(?:-(\d+))?$/,
	text: /^text-([a-z]+)(?:-(\d+))?$/,
	border: /^border-([a-z]+)(?:-(\d+))?$/,
	hoverBg: /^hover:bg-([a-z]+)(?:-(\d+))?$/,
	hoverText: /^hover:text-([a-z]+)(?:-(\d+))?$/,
}

/**
 * Check if a class is a text color class (not a non-color text utility).
 */
function isTextColorClass(className: string): boolean {
	if (NON_COLOR_TEXT_CLASSES.has(className)) {
		return false
	}
	return COLOR_CLASS_PATTERNS.text.test(className)
}

/**
 * Parse a color class into its components.
 */
export function parseColorClass(colorClass: string): {
	prefix: string
	colorName: string
	shade?: string
	isHover: boolean
} | undefined {
	// Exclude non-color text utility classes
	if (NON_COLOR_TEXT_CLASSES.has(colorClass)) {
		return undefined
	}

	const isHover = colorClass.startsWith('hover:')
	const classWithoutHover = isHover ? colorClass.slice(6) : colorClass

	// Also check hover variants of non-color text classes
	if (isHover && NON_COLOR_TEXT_CLASSES.has(`text-${classWithoutHover.slice(5)}`)) {
		return undefined
	}

	const match = classWithoutHover.match(/^(bg|text|border)-([a-z]+)(?:-(\d+))?$/)

	if (!match) return undefined

	return {
		prefix: isHover ? `hover:${match[1]}` : match[1]!,
		colorName: match[2]!,
		shade: match[3],
		isHover,
	}
}

/**
 * Build a color class from components.
 */
export function buildColorClass(
	prefix: string,
	colorName: string,
	shade?: string,
): string {
	if (shade) {
		return `${prefix}-${colorName}-${shade}`
	}
	return `${prefix}-${colorName}`
}

/**
 * Get the color type from a color class.
 */
export function getColorType(colorClass: string): keyof typeof COLOR_CLASS_PATTERNS | undefined {
	for (const [key, pattern] of Object.entries(COLOR_CLASS_PATTERNS)) {
		// For text type, use the helper to exclude non-color text utilities
		if (key === 'text' || key === 'hoverText') {
			if (key === 'text' && isTextColorClass(colorClass)) {
				return key as keyof typeof COLOR_CLASS_PATTERNS
			}
			if (key === 'hoverText' && colorClass.startsWith('hover:') && isTextColorClass(colorClass.slice(6))) {
				return key as keyof typeof COLOR_CLASS_PATTERNS
			}
		} else if (pattern.test(colorClass)) {
			return key as keyof typeof COLOR_CLASS_PATTERNS
		}
	}
	return undefined
}

/**
 * Check if a class is a color class.
 */
export function isColorClass(className: string): boolean {
	// Check text color separately to exclude non-color text utilities
	if (COLOR_CLASS_PATTERNS.text.test(className)) {
		return isTextColorClass(className)
	}
	if (COLOR_CLASS_PATTERNS.hoverText.test(className)) {
		return isTextColorClass(className.slice(6)) // Remove 'hover:' prefix
	}
	return Object.entries(COLOR_CLASS_PATTERNS)
		.filter(([key]) => key !== 'text' && key !== 'hoverText')
		.some(([, pattern]) => pattern.test(className))
}

/**
 * Get a preview CSS color for a Tailwind color.
 */
export function getColorPreview(colorName: string, shade?: string): string {
	// Special colors without shades
	if (SPECIAL_COLORS.includes(colorName as any)) {
		return COLOR_PREVIEW_MAP[colorName] || colorName
	}

	// Get base color
	const baseColor = COLOR_PREVIEW_MAP[colorName]
	if (!baseColor) {
		// Unknown color, return a placeholder
		return '#888888'
	}

	// If no shade specified, return the base (500) color
	if (!shade) {
		return baseColor
	}

	// For now, return the base color
	// A more sophisticated implementation would adjust lightness based on shade
	return baseColor
}

/**
 * Resolve a color to its CSS value using availableColors from the manifest.
 */
export function resolveColorValue(
	colorName: string,
	shade: string | undefined,
	availableColors: AvailableColors | undefined,
): string | undefined {
	// Special colors
	if (colorName === 'white') return '#ffffff'
	if (colorName === 'black') return '#000000'
	if (colorName === 'transparent') return 'transparent'
	if (colorName === 'current') return 'currentColor'
	if (colorName === 'inherit') return 'inherit'

	if (!availableColors) {
		// Fallback to preview map
		return COLOR_PREVIEW_MAP[colorName]
	}

	// Find the color in availableColors
	const color = availableColors.colors.find(c => c.name === colorName)
	if (!color) return undefined

	// Get the value for the shade (or empty string for colors without shades)
	const shadeKey = shade || '500'
	return color.values[shadeKey]
}

/**
 * Replace a color class in an element's class list.
 * Returns the old class that was replaced, or undefined if not found.
 */
export function replaceColorClass(
	element: HTMLElement,
	colorType: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText',
	newColorName: string,
	newShade?: string,
): { oldClass: string; newClass: string } | undefined {
	const classes = element.className.split(/\s+/).filter(Boolean)
	const pattern = COLOR_CLASS_PATTERNS[colorType]

	let oldClass: string | undefined
	const newClasses: string[] = []

	for (const cls of classes) {
		// For text types, use the helper to exclude non-color text utilities
		let isColorMatch: boolean
		if (colorType === 'text') {
			isColorMatch = isTextColorClass(cls)
		} else if (colorType === 'hoverText') {
			isColorMatch = cls.startsWith('hover:') && isTextColorClass(cls.slice(6))
		} else {
			isColorMatch = pattern.test(cls)
		}
		if (isColorMatch) {
			oldClass = cls
			// Build the new class with the same prefix
			const isHover = colorType.startsWith('hover')
			const prefix = isHover
				? colorType.replace('hover', 'hover:').toLowerCase().replace('hover:bg', 'hover:bg').replace('hover:text', 'hover:text')
				: colorType
			const newClass = buildColorClass(prefix, newColorName, newShade)
			newClasses.push(newClass)
		} else {
			newClasses.push(cls)
		}
	}

	if (!oldClass) {
		return undefined
	}

	const newClass = buildColorClass(
		colorType.startsWith('hover') ? `hover:${colorType.slice(5).toLowerCase()}` : colorType,
		newColorName,
		newShade,
	)

	element.className = newClasses.join(' ')

	return { oldClass, newClass }
}

/**
 * Get the current color classes from an element as Record<string, Attribute>.
 */
export function getElementColorClasses(element: HTMLElement): Record<string, Attribute> {
	const classes = element.className.split(/\s+/).filter(Boolean)
	const colorClasses: Record<string, Attribute> = {}

	for (const cls of classes) {
		for (const [key, pattern] of Object.entries(COLOR_CLASS_PATTERNS)) {
			// For text types, use the helper to exclude non-color text utilities
			let isColorMatch: boolean
			if (key === 'text') {
				isColorMatch = isTextColorClass(cls)
			} else if (key === 'hoverText') {
				isColorMatch = cls.startsWith('hover:') && isTextColorClass(cls.slice(6))
			} else {
				isColorMatch = pattern.test(cls)
			}
			if (isColorMatch) {
				if (!(key in colorClasses)) {
					colorClasses[key] = { value: cls }
				}
				break
			}
		}
	}

	return colorClasses
}

/**
 * Inject global hover preview styles once.
 * Uses CSS custom properties with !important to preview hover colors.
 */
let hoverStylesInjected = false
function ensureHoverStyles(): void {
	if (hoverStylesInjected) return
	hoverStylesInjected = true

	const style = document.createElement('style')
	style.textContent = `
		[data-cms-hover-bg]:hover {
			background-color: var(--cms-hover-bg) !important;
		}
		[data-cms-hover-text]:hover {
			color: var(--cms-hover-text) !important;
		}
	`
	document.head.appendChild(style)
}

/**
 * Apply a color change to an element.
 * Updates the DOM immediately with both class and inline style for preview.
 * The inline style ensures the color is visible even if Tailwind hasn't compiled the class.
 */
export function applyColorChange(
	element: HTMLElement,
	colorType: 'bg' | 'text' | 'border' | 'hoverBg' | 'hoverText',
	newColorName: string,
	newShade: string | undefined,
	availableColors: AvailableColors | undefined,
): { oldClass: string; newClass: string } | undefined {
	const classes = element.className.split(/\s+/).filter(Boolean)
	const pattern = COLOR_CLASS_PATTERNS[colorType]

	let oldClass: string | undefined
	const newClasses: string[] = []

	// Determine the new class prefix
	const prefix = colorType === 'hoverBg'
		? 'hover:bg'
		: colorType === 'hoverText'
		? 'hover:text'
		: colorType
	const newClass = buildColorClass(prefix, newColorName, newShade)

	for (const cls of classes) {
		// For text types, use the helper to exclude non-color text utilities
		let isColorMatch: boolean
		if (colorType === 'text') {
			isColorMatch = isTextColorClass(cls)
		} else if (colorType === 'hoverText') {
			isColorMatch = cls.startsWith('hover:') && isTextColorClass(cls.slice(6))
		} else {
			isColorMatch = pattern.test(cls)
		}
		if (isColorMatch) {
			oldClass = cls
			// Replace with new class
			newClasses.push(newClass)
		} else {
			newClasses.push(cls)
		}
	}

	// If no existing color class was found, add the new one
	if (!oldClass) {
		newClasses.push(newClass)
	}

	element.className = newClasses.join(' ')

	// Apply inline style for immediate visual feedback
	// This ensures the color is visible even if Tailwind hasn't compiled the new class
	const cssValue = resolveColorValue(newColorName, newShade, availableColors)
	if (cssValue) {
		// For hover states, use CSS custom properties with global :hover rules
		if (colorType === 'hoverBg') {
			ensureHoverStyles()
			element.dataset.cmsHoverBg = ''
			element.style.setProperty('--cms-hover-bg', cssValue)
		} else if (colorType === 'hoverText') {
			ensureHoverStyles()
			element.dataset.cmsHoverText = ''
			element.style.setProperty('--cms-hover-text', cssValue)
		} else {
			// Map color type to CSS property for non-hover states
			const styleProperty = colorType === 'bg'
				? 'backgroundColor'
				: colorType === 'text'
				? 'color'
				: colorType === 'border'
				? 'borderColor'
				: 'color'
			element.style[styleProperty] = cssValue
		}
	}

	return { oldClass: oldClass || '', newClass }
}

/**
 * Get popular colors for quick selection.
 * Returns a curated list of commonly used colors.
 */
export function getPopularColors(): Array<{ name: string; shade: string; preview: string }> {
	const popularColorNames = ['blue', 'green', 'red', 'purple', 'orange', 'slate', 'black', 'white']
	const popularShades = ['500', '600', '700']

	const colors: Array<{ name: string; shade: string; preview: string }> = []

	// Add special colors first
	colors.push({ name: 'white', shade: '', preview: '#ffffff' })
	colors.push({ name: 'black', shade: '', preview: '#000000' })

	// Add popular color/shade combinations
	for (const name of popularColorNames) {
		if (name === 'white' || name === 'black') continue
		for (const shade of popularShades) {
			colors.push({
				name,
				shade,
				preview: getColorPreview(name, shade),
			})
		}
	}

	return colors
}

/**
 * Get all available colors with their shades from manifest.
 */
export function getAllColorsWithShades(availableColors: AvailableColors | undefined): Array<{
	name: string
	shades: Array<{ shade: string; preview: string }>
	isSpecial: boolean
}> {
	if (!availableColors) {
		// Return default colors
		const result: Array<{
			name: string
			shades: Array<{ shade: string; preview: string }>
			isSpecial: boolean
		}> = []

		// Special colors
		for (const color of SPECIAL_COLORS) {
			if (color !== 'current' && color !== 'inherit' && color !== 'transparent') {
				result.push({
					name: color,
					shades: [{ shade: '', preview: getColorPreview(color) }],
					isSpecial: true,
				})
			}
		}

		// Standard colors
		for (const color of DEFAULT_TAILWIND_COLORS) {
			result.push({
				name: color,
				shades: STANDARD_SHADES.map(shade => ({
					shade,
					preview: getColorPreview(color, shade),
				})),
				isSpecial: false,
			})
		}

		return result
	}

	return availableColors.colors.map(color => {
		const shades = Object.keys(color.values)
		const isSpecial = SPECIAL_COLORS.includes(color.name as any)

		return {
			name: color.name,
			shades: shades.length > 0
				? shades.map(shade => ({
					shade,
					preview: color.values[shade] || getColorPreview(color.name, shade),
				}))
				: [{ shade: '', preview: color.values[''] || getColorPreview(color.name) }],
			isSpecial,
		}
	})
}
