import fs from 'node:fs/promises'
import path from 'node:path'
import type { AvailableColors, ColorClasses, TailwindColor } from './types'

/**
 * Default Tailwind CSS v4 color names.
 * These are available by default in Tailwind v4.
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
 * Build a regex pattern for matching color classes.
 * Matches either:
 * - Known default/special colors (e.g., bg-red, text-white)
 * - Any color name followed by a shade number (e.g., bg-primary-500)
 */
function buildColorPattern(prefix: string): RegExp {
	const colorNames = [...DEFAULT_TAILWIND_COLORS, ...SPECIAL_COLORS].join('|')
	// Match either: known-color (with optional shade) OR any-name-with-shade (to support custom colors)
	return new RegExp(`^${prefix}-((?:${colorNames})(?:-(\\d+))?|([a-z]+)-(\\d+))$`)
}

/**
 * Regex patterns to match Tailwind color classes.
 * These patterns are specific to color utilities and won't match other utilities
 * like text-lg, text-center, bg-fixed, etc.
 */
const COLOR_CLASS_PATTERNS = {
	// Matches: bg-red-500, bg-primary-500, bg-white, bg-transparent
	bg: buildColorPattern('bg'),
	// Matches: text-red-500, text-primary-500, text-white (NOT text-lg, text-center)
	text: buildColorPattern('text'),
	// Matches: border-red-500, border-primary-500
	border: buildColorPattern('border'),
	// Matches: hover:bg-red-500
	hoverBg: buildColorPattern('hover:bg'),
	// Matches: hover:text-red-500
	hoverText: buildColorPattern('hover:text'),
}

/**
 * Parse Tailwind v4 CSS config to extract available colors.
 * Tailwind v4 uses CSS-based configuration with @theme directive.
 *
 * Example CSS:
 * ```css
 * @theme {
 *   --color-primary-50: #eff6ff;
 *   --color-primary-500: #3b82f6;
 *   --color-accent: #f59e0b;
 * }
 * ```
 */
export async function parseTailwindConfig(projectRoot: string = process.cwd()): Promise<AvailableColors> {
	// Tailwind v4 CSS files to search
	const cssFiles = [
		'src/styles/global.css',
		'src/styles/tailwind.css',
		'src/styles/app.css',
		'src/app.css',
		'src/global.css',
		'src/index.css',
		'app/globals.css',
		'styles/globals.css',
	]

	let customColors: TailwindColor[] = []

	for (const cssFile of cssFiles) {
		const fullPath = path.join(projectRoot, cssFile)
		try {
			const content = await fs.readFile(fullPath, 'utf-8')
			customColors = extractColorsFromCss(content)
			if (customColors.length > 0) {
				break
			}
		} catch {
			// File doesn't exist, continue
		}
	}

	// Build default colors list
	const defaultColors: TailwindColor[] = DEFAULT_TAILWIND_COLORS.map(name => ({
		name,
		shades: [...STANDARD_SHADES],
		isCustom: false,
	}))

	// Add special colors (no shades)
	const specialColors: TailwindColor[] = SPECIAL_COLORS.map(name => ({
		name,
		shades: [],
		isCustom: false,
	}))

	return {
		colors: [...specialColors, ...defaultColors, ...customColors],
		defaultColors: [...SPECIAL_COLORS, ...DEFAULT_TAILWIND_COLORS],
		customColors: customColors.map(c => c.name),
	}
}

/**
 * Extract custom colors from Tailwind v4 CSS @theme block.
 *
 * Looks for patterns like:
 * - --color-primary-50: #value;
 * - --color-primary: #value;
 * - --color-accent-500: oklch(...);
 */
function extractColorsFromCss(content: string): TailwindColor[] {
	const colors = new Map<string, Set<string>>()

	// Find @theme blocks
	const themeBlockPattern = /@theme\s*\{([^}]+)\}/gs
	let themeMatch

	while ((themeMatch = themeBlockPattern.exec(content)) !== null) {
		const themeContent = themeMatch[1]
		if (!themeContent) continue

		// Find all --color-* definitions
		// Pattern: --color-{name}-{shade}: value; or --color-{name}: value;
		const colorVarPattern = /--color-([a-z]+)(?:-(\d+))?:/gi
		let colorMatch

		while ((colorMatch = colorVarPattern.exec(themeContent)) !== null) {
			const colorName = colorMatch[1]?.toLowerCase()
			const shade = colorMatch[2]

			if (!colorName) continue

			// Skip if it's a default color
			if (DEFAULT_TAILWIND_COLORS.includes(colorName as any)) {
				continue
			}

			if (!colors.has(colorName)) {
				colors.set(colorName, new Set())
			}

			if (shade) {
				colors.get(colorName)!.add(shade)
			}
		}
	}

	// Also check for inline @theme definitions (Tailwind v4 can be inline too)
	// Pattern: @theme inline { ... }
	const inlineThemePattern = /@theme\s+inline\s*\{([^}]+)\}/gs
	let inlineMatch

	while ((inlineMatch = inlineThemePattern.exec(content)) !== null) {
		const themeContent = inlineMatch[1]
		if (!themeContent) continue

		const colorVarPattern = /--color-([a-z]+)(?:-(\d+))?:/gi
		let colorMatch

		while ((colorMatch = colorVarPattern.exec(themeContent)) !== null) {
			const colorName = colorMatch[1]?.toLowerCase()
			const shade = colorMatch[2]

			if (!colorName) continue

			if (DEFAULT_TAILWIND_COLORS.includes(colorName as any)) {
				continue
			}

			if (!colors.has(colorName)) {
				colors.set(colorName, new Set())
			}

			if (shade) {
				colors.get(colorName)!.add(shade)
			}
		}
	}

	// Convert to TailwindColor array
	const result: TailwindColor[] = []
	for (const [name, shades] of colors) {
		const sortedShades = Array.from(shades).sort((a, b) => parseInt(a) - parseInt(b))
		result.push({
			name,
			shades: sortedShades.length > 0 ? sortedShades : [],
			isCustom: true,
		})
	}

	return result
}

/**
 * Extract color classes from an element's class attribute.
 */
export function extractColorClasses(classAttr: string | null): ColorClasses | undefined {
	if (!classAttr) return undefined

	const classes = classAttr.split(/\s+/).filter(Boolean)
	const colorClasses: ColorClasses = {}
	const allColorClasses: string[] = []

	for (const cls of classes) {
		// Check each pattern
		for (const [key, pattern] of Object.entries(COLOR_CLASS_PATTERNS)) {
			const match = cls.match(pattern)
			if (match) {
				allColorClasses.push(cls)
				// Assign to appropriate field
				if (!(key in colorClasses)) {
					(colorClasses as any)[key] = cls
				}
				break
			}
		}
	}

	if (allColorClasses.length === 0) {
		return undefined
	}

	colorClasses.allColorClasses = allColorClasses
	return colorClasses
}

/**
 * Check if a class is a color class.
 */
export function isColorClass(className: string): boolean {
	return Object.values(COLOR_CLASS_PATTERNS).some(pattern => pattern.test(className))
}

/**
 * Generate a new class string with a color class replaced.
 * @param currentClasses - Current class attribute value
 * @param oldColorClass - The color class to replace (e.g., 'bg-blue-500')
 * @param newColorClass - The new color class (e.g., 'bg-red-500')
 * @returns New class string with the replacement
 */
export function replaceColorClass(
	currentClasses: string,
	oldColorClass: string,
	newColorClass: string,
): string {
	const classes = currentClasses.split(/\s+/).filter(Boolean)
	const newClasses = classes.map(cls => cls === oldColorClass ? newColorClass : cls)
	return newClasses.join(' ')
}

/**
 * Get the color type from a color class.
 * @param colorClass - e.g., 'bg-blue-500', 'text-white', 'hover:bg-red-600'
 * @returns The type: 'bg', 'text', 'border', 'hoverBg', 'hoverText', or undefined
 */
export function getColorType(colorClass: string): keyof ColorClasses | undefined {
	for (const [key, pattern] of Object.entries(COLOR_CLASS_PATTERNS)) {
		if (pattern.test(colorClass)) {
			return key as keyof ColorClasses
		}
	}
	return undefined
}

/**
 * Parse a color class into its components.
 * @param colorClass - e.g., 'bg-blue-500', 'text-white', 'hover:bg-red-600'
 * @returns Object with prefix, colorName, and shade (if any)
 */
export function parseColorClass(colorClass: string): {
	prefix: string
	colorName: string
	shade?: string
	isHover: boolean
} | undefined {
	// Handle hover prefix
	const isHover = colorClass.startsWith('hover:')
	const classWithoutHover = isHover ? colorClass.slice(6) : colorClass

	// Match prefix-color-shade or prefix-color
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
