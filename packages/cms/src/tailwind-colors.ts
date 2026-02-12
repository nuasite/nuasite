import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_TAILWIND_COLORS, SPECIAL_COLORS } from './color-patterns'
import { getProjectRoot } from './config'
import type { AvailableColors, AvailableTextStyles, TailwindColor, TextStyleValue } from './types'

// Re-export all shared detection logic from color-patterns
export {
	buildColorClass,
	COLOR_CLASS_PATTERNS,
	DEFAULT_TAILWIND_COLORS,
	extractColorClasses,
	extractTextStyleClasses,
	getColorType,
	GRADIENT_CLASS_PATTERNS,
	isColorClass,
	OPACITY_CLASS_PATTERNS,
	parseColorClass,
	replaceColorClass,
	SPECIAL_COLORS,
	STANDARD_SHADES,
	TEXT_STYLE_CLASS_PATTERNS,
} from './color-patterns'

/**
 * Complete Tailwind v4 default color palette with all shade values.
 */
const DEFAULT_COLOR_VALUES: Record<string, Record<string, string>> = {
	slate: {
		'50': '#f8fafc',
		'100': '#f1f5f9',
		'200': '#e2e8f0',
		'300': '#cbd5e1',
		'400': '#94a3b8',
		'500': '#64748b',
		'600': '#475569',
		'700': '#334155',
		'800': '#1e293b',
		'900': '#0f172a',
		'950': '#020617',
	},
	gray: {
		'50': '#f9fafb',
		'100': '#f3f4f6',
		'200': '#e5e7eb',
		'300': '#d1d5db',
		'400': '#9ca3af',
		'500': '#6b7280',
		'600': '#4b5563',
		'700': '#374151',
		'800': '#1f2937',
		'900': '#111827',
		'950': '#030712',
	},
	zinc: {
		'50': '#fafafa',
		'100': '#f4f4f5',
		'200': '#e4e4e7',
		'300': '#d4d4d8',
		'400': '#a1a1aa',
		'500': '#71717a',
		'600': '#52525b',
		'700': '#3f3f46',
		'800': '#27272a',
		'900': '#18181b',
		'950': '#09090b',
	},
	neutral: {
		'50': '#fafafa',
		'100': '#f5f5f5',
		'200': '#e5e5e5',
		'300': '#d4d4d4',
		'400': '#a3a3a3',
		'500': '#737373',
		'600': '#525252',
		'700': '#404040',
		'800': '#262626',
		'900': '#171717',
		'950': '#0a0a0a',
	},
	stone: {
		'50': '#fafaf9',
		'100': '#f5f5f4',
		'200': '#e7e5e4',
		'300': '#d6d3d1',
		'400': '#a8a29e',
		'500': '#78716c',
		'600': '#57534e',
		'700': '#44403c',
		'800': '#292524',
		'900': '#1c1917',
		'950': '#0c0a09',
	},
	red: {
		'50': '#fef2f2',
		'100': '#fee2e2',
		'200': '#fecaca',
		'300': '#fca5a5',
		'400': '#f87171',
		'500': '#ef4444',
		'600': '#dc2626',
		'700': '#b91c1c',
		'800': '#991b1b',
		'900': '#7f1d1d',
		'950': '#450a0a',
	},
	orange: {
		'50': '#fff7ed',
		'100': '#ffedd5',
		'200': '#fed7aa',
		'300': '#fdba74',
		'400': '#fb923c',
		'500': '#f97316',
		'600': '#ea580c',
		'700': '#c2410c',
		'800': '#9a3412',
		'900': '#7c2d12',
		'950': '#431407',
	},
	amber: {
		'50': '#fffbeb',
		'100': '#fef3c7',
		'200': '#fde68a',
		'300': '#fcd34d',
		'400': '#fbbf24',
		'500': '#f59e0b',
		'600': '#d97706',
		'700': '#b45309',
		'800': '#92400e',
		'900': '#78350f',
		'950': '#451a03',
	},
	yellow: {
		'50': '#fefce8',
		'100': '#fef9c3',
		'200': '#fef08a',
		'300': '#fde047',
		'400': '#facc15',
		'500': '#eab308',
		'600': '#ca8a04',
		'700': '#a16207',
		'800': '#854d0e',
		'900': '#713f12',
		'950': '#422006',
	},
	lime: {
		'50': '#f7fee7',
		'100': '#ecfccb',
		'200': '#d9f99d',
		'300': '#bef264',
		'400': '#a3e635',
		'500': '#84cc16',
		'600': '#65a30d',
		'700': '#4d7c0f',
		'800': '#3f6212',
		'900': '#365314',
		'950': '#1a2e05',
	},
	green: {
		'50': '#f0fdf4',
		'100': '#dcfce7',
		'200': '#bbf7d0',
		'300': '#86efac',
		'400': '#4ade80',
		'500': '#22c55e',
		'600': '#16a34a',
		'700': '#15803d',
		'800': '#166534',
		'900': '#14532d',
		'950': '#052e16',
	},
	emerald: {
		'50': '#ecfdf5',
		'100': '#d1fae5',
		'200': '#a7f3d0',
		'300': '#6ee7b7',
		'400': '#34d399',
		'500': '#10b981',
		'600': '#059669',
		'700': '#047857',
		'800': '#065f46',
		'900': '#064e3b',
		'950': '#022c22',
	},
	teal: {
		'50': '#f0fdfa',
		'100': '#ccfbf1',
		'200': '#99f6e4',
		'300': '#5eead4',
		'400': '#2dd4bf',
		'500': '#14b8a6',
		'600': '#0d9488',
		'700': '#0f766e',
		'800': '#115e59',
		'900': '#134e4a',
		'950': '#042f2e',
	},
	cyan: {
		'50': '#ecfeff',
		'100': '#cffafe',
		'200': '#a5f3fc',
		'300': '#67e8f9',
		'400': '#22d3ee',
		'500': '#06b6d4',
		'600': '#0891b2',
		'700': '#0e7490',
		'800': '#155e75',
		'900': '#164e63',
		'950': '#083344',
	},
	sky: {
		'50': '#f0f9ff',
		'100': '#e0f2fe',
		'200': '#bae6fd',
		'300': '#7dd3fc',
		'400': '#38bdf8',
		'500': '#0ea5e9',
		'600': '#0284c7',
		'700': '#0369a1',
		'800': '#075985',
		'900': '#0c4a6e',
		'950': '#082f49',
	},
	blue: {
		'50': '#eff6ff',
		'100': '#dbeafe',
		'200': '#bfdbfe',
		'300': '#93c5fd',
		'400': '#60a5fa',
		'500': '#3b82f6',
		'600': '#2563eb',
		'700': '#1d4ed8',
		'800': '#1e40af',
		'900': '#1e3a8a',
		'950': '#172554',
	},
	indigo: {
		'50': '#eef2ff',
		'100': '#e0e7ff',
		'200': '#c7d2fe',
		'300': '#a5b4fc',
		'400': '#818cf8',
		'500': '#6366f1',
		'600': '#4f46e5',
		'700': '#4338ca',
		'800': '#3730a3',
		'900': '#312e81',
		'950': '#1e1b4b',
	},
	violet: {
		'50': '#f5f3ff',
		'100': '#ede9fe',
		'200': '#ddd6fe',
		'300': '#c4b5fd',
		'400': '#a78bfa',
		'500': '#8b5cf6',
		'600': '#7c3aed',
		'700': '#6d28d9',
		'800': '#5b21b6',
		'900': '#4c1d95',
		'950': '#2e1065',
	},
	purple: {
		'50': '#faf5ff',
		'100': '#f3e8ff',
		'200': '#e9d5ff',
		'300': '#d8b4fe',
		'400': '#c084fc',
		'500': '#a855f7',
		'600': '#9333ea',
		'700': '#7e22ce',
		'800': '#6b21a8',
		'900': '#581c87',
		'950': '#3b0764',
	},
	fuchsia: {
		'50': '#fdf4ff',
		'100': '#fae8ff',
		'200': '#f5d0fe',
		'300': '#f0abfc',
		'400': '#e879f9',
		'500': '#d946ef',
		'600': '#c026d3',
		'700': '#a21caf',
		'800': '#86198f',
		'900': '#701a75',
		'950': '#4a044e',
	},
	pink: {
		'50': '#fdf2f8',
		'100': '#fce7f3',
		'200': '#fbcfe8',
		'300': '#f9a8d4',
		'400': '#f472b6',
		'500': '#ec4899',
		'600': '#db2777',
		'700': '#be185d',
		'800': '#9d174d',
		'900': '#831843',
		'950': '#500724',
	},
	rose: {
		'50': '#fff1f2',
		'100': '#ffe4e6',
		'200': '#fecdd3',
		'300': '#fda4af',
		'400': '#fb7185',
		'500': '#f43f5e',
		'600': '#e11d48',
		'700': '#be123c',
		'800': '#9f1239',
		'900': '#881337',
		'950': '#4c0519',
	},
}

/**
 * Special color values.
 */
const SPECIAL_COLOR_VALUES: Record<string, string> = {
	transparent: 'transparent',
	current: 'currentColor',
	inherit: 'inherit',
	white: '#ffffff',
	black: '#000000',
}

/**
 * Default Tailwind v4 font weight values.
 */
const DEFAULT_FONT_WEIGHTS: TextStyleValue[] = [
	{ class: 'font-thin', label: 'Thin', css: { fontWeight: '100' } },
	{ class: 'font-extralight', label: 'Extra Light', css: { fontWeight: '200' } },
	{ class: 'font-light', label: 'Light', css: { fontWeight: '300' } },
	{ class: 'font-normal', label: 'Normal', css: { fontWeight: '400' } },
	{ class: 'font-medium', label: 'Medium', css: { fontWeight: '500' } },
	{ class: 'font-semibold', label: 'Semibold', css: { fontWeight: '600' } },
	{ class: 'font-bold', label: 'Bold', css: { fontWeight: '700' } },
	{ class: 'font-extrabold', label: 'Extra Bold', css: { fontWeight: '800' } },
	{ class: 'font-black', label: 'Black', css: { fontWeight: '900' } },
]

/**
 * Default Tailwind v4 font size values.
 */
const DEFAULT_FONT_SIZES: TextStyleValue[] = [
	{ class: 'text-xs', label: 'XS', css: { fontSize: '0.75rem', lineHeight: '1rem' } },
	{ class: 'text-sm', label: 'SM', css: { fontSize: '0.875rem', lineHeight: '1.25rem' } },
	{ class: 'text-base', label: 'Base', css: { fontSize: '1rem', lineHeight: '1.5rem' } },
	{ class: 'text-lg', label: 'LG', css: { fontSize: '1.125rem', lineHeight: '1.75rem' } },
	{ class: 'text-xl', label: 'XL', css: { fontSize: '1.25rem', lineHeight: '1.75rem' } },
	{ class: 'text-2xl', label: '2XL', css: { fontSize: '1.5rem', lineHeight: '2rem' } },
	{ class: 'text-3xl', label: '3XL', css: { fontSize: '1.875rem', lineHeight: '2.25rem' } },
	{ class: 'text-4xl', label: '4XL', css: { fontSize: '2.25rem', lineHeight: '2.5rem' } },
	{ class: 'text-5xl', label: '5XL', css: { fontSize: '3rem', lineHeight: '1' } },
	{ class: 'text-6xl', label: '6XL', css: { fontSize: '3.75rem', lineHeight: '1' } },
	{ class: 'text-7xl', label: '7XL', css: { fontSize: '4.5rem', lineHeight: '1' } },
	{ class: 'text-8xl', label: '8XL', css: { fontSize: '6rem', lineHeight: '1' } },
	{ class: 'text-9xl', label: '9XL', css: { fontSize: '8rem', lineHeight: '1' } },
]

/**
 * Default text decoration values.
 */
const DEFAULT_TEXT_DECORATIONS: TextStyleValue[] = [
	{ class: 'no-underline', label: 'None', css: { textDecoration: 'none' } },
	{ class: 'underline', label: 'Underline', css: { textDecoration: 'underline' } },
	{ class: 'overline', label: 'Overline', css: { textDecoration: 'overline' } },
	{ class: 'line-through', label: 'Strikethrough', css: { textDecoration: 'line-through' } },
]

/**
 * Default font style values.
 */
const DEFAULT_FONT_STYLES: TextStyleValue[] = [
	{ class: 'not-italic', label: 'Normal', css: { fontStyle: 'normal' } },
	{ class: 'italic', label: 'Italic', css: { fontStyle: 'italic' } },
]

/**
 * Parse Tailwind v4 CSS config to extract available colors with their values.
 */
export async function parseTailwindConfig(projectRoot: string = getProjectRoot()): Promise<AvailableColors> {
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

	// Build default colors with values
	const defaultColors: TailwindColor[] = DEFAULT_TAILWIND_COLORS.map(name => ({
		name,
		values: DEFAULT_COLOR_VALUES[name] || {},
		isCustom: false,
	}))

	// Add special colors
	const specialColors: TailwindColor[] = SPECIAL_COLORS.map(name => ({
		name,
		values: { '': SPECIAL_COLOR_VALUES[name] || name },
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
 * Extracts both color names and their actual CSS values.
 */
function extractColorsFromCss(content: string): TailwindColor[] {
	const colors = new Map<string, Record<string, string>>()

	// Find @theme blocks (including inline)
	const themeBlockPattern = /@theme(?:\s+inline)?\s*\{([^}]+)\}/gs
	let themeMatch: RegExpExecArray | null

	while ((themeMatch = themeBlockPattern.exec(content)) !== null) {
		const themeContent = themeMatch[1]
		if (!themeContent) continue

		// Find all --color-* definitions with their values
		// Pattern: --color-{name}-{shade}: value; or --color-{name}: value;
		const colorVarPattern = /--color-([a-z]+)(?:-(\d+))?:\s*([^;]+);/gi
		let colorMatch: RegExpExecArray | null

		while ((colorMatch = colorVarPattern.exec(themeContent)) !== null) {
			const colorName = colorMatch[1]?.toLowerCase()
			const shade = colorMatch[2] || ''
			const value = colorMatch[3]?.trim()

			if (!colorName || !value) continue

			// Skip if it's a default color (we already have values for those)
			if ((DEFAULT_TAILWIND_COLORS as readonly string[]).includes(colorName)) {
				continue
			}

			if (!colors.has(colorName)) {
				colors.set(colorName, {})
			}

			colors.get(colorName)![shade] = value
		}
	}

	// Convert to TailwindColor array
	const result: TailwindColor[] = []
	for (const [name, values] of colors) {
		result.push({
			name,
			values,
			isCustom: true,
		})
	}

	return result
}

/**
 * Parse Tailwind v4 CSS config to extract available text styles.
 */
export async function parseTextStyles(projectRoot: string = getProjectRoot()): Promise<AvailableTextStyles> {
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

	let customTextStyles: Partial<AvailableTextStyles> = {}

	for (const cssFile of cssFiles) {
		const fullPath = path.join(projectRoot, cssFile)
		try {
			const content = await fs.readFile(fullPath, 'utf-8')
			customTextStyles = extractTextStylesFromCss(content)
			// If we found any custom styles, use this file
			if (Object.values(customTextStyles).some(arr => arr && arr.length > 0)) {
				break
			}
		} catch {
			// File doesn't exist, continue
		}
	}

	// Merge custom styles with defaults (custom overrides default)
	return {
		fontWeight: mergeTextStyles(DEFAULT_FONT_WEIGHTS, customTextStyles.fontWeight),
		fontSize: mergeTextStyles(DEFAULT_FONT_SIZES, customTextStyles.fontSize),
		textDecoration: mergeTextStyles(DEFAULT_TEXT_DECORATIONS, customTextStyles.textDecoration),
		fontStyle: mergeTextStyles(DEFAULT_FONT_STYLES, customTextStyles.fontStyle),
	}
}

/**
 * Merge custom text styles with defaults.
 * Custom styles with matching class names override defaults.
 */
function mergeTextStyles(defaults: TextStyleValue[], custom?: TextStyleValue[]): TextStyleValue[] {
	if (!custom || custom.length === 0) {
		return defaults
	}

	const customByClass = new Map(custom.map(s => [s.class, s]))
	const result: TextStyleValue[] = []

	// Update defaults with custom overrides
	for (const def of defaults) {
		const customStyle = customByClass.get(def.class)
		if (customStyle) {
			result.push(customStyle)
			customByClass.delete(def.class)
		} else {
			result.push(def)
		}
	}

	// Add any remaining custom styles that weren't overrides
	for (const style of customByClass.values()) {
		result.push(style)
	}

	return result
}

/**
 * Extract custom text styles from Tailwind v4 CSS @theme block.
 */
function extractTextStylesFromCss(content: string): Partial<AvailableTextStyles> {
	const fontWeights: TextStyleValue[] = []
	const fontSizes: TextStyleValue[] = []

	// Find @theme blocks (including inline)
	const themeBlockPattern = /@theme(?:\s+inline)?\s*\{([^}]+)\}/gs
	let themeMatch: RegExpExecArray | null

	while ((themeMatch = themeBlockPattern.exec(content)) !== null) {
		const themeContent = themeMatch[1]
		if (!themeContent) continue

		// Extract font-weight overrides: --font-weight-{name}: value;
		const fontWeightPattern = /--font-weight-([a-z]+):\s*([^;]+);/gi
		let weightMatch: RegExpExecArray | null
		while ((weightMatch = fontWeightPattern.exec(themeContent)) !== null) {
			const name = weightMatch[1]?.toLowerCase()
			const value = weightMatch[2]?.trim()
			if (!name || !value) continue

			fontWeights.push({
				class: `font-${name}`,
				label: name.charAt(0).toUpperCase() + name.slice(1),
				css: { fontWeight: value },
			})
		}

		// Extract font-size overrides: --font-size-{name}: value;
		// Also look for corresponding line-height: --line-height-{name}: value;
		const fontSizePattern = /--font-size-([a-z0-9]+):\s*([^;]+);/gi
		let sizeMatch: RegExpExecArray | null
		while ((sizeMatch = fontSizePattern.exec(themeContent)) !== null) {
			const name = sizeMatch[1]?.toLowerCase()
			const value = sizeMatch[2]?.trim()
			if (!name || !value) continue

			// Try to find matching line-height
			const lineHeightPattern = new RegExp(`--line-height-${name}:\\s*([^;]+);`, 'i')
			const lineHeightMatch = themeContent.match(lineHeightPattern)
			const lineHeight = lineHeightMatch?.[1]?.trim()

			const css: Record<string, string> = { fontSize: value }
			if (lineHeight) {
				css.lineHeight = lineHeight
			}

			fontSizes.push({
				class: `text-${name}`,
				label: name.toUpperCase(),
				css,
			})
		}
	}

	return {
		fontWeight: fontWeights.length > 0 ? fontWeights : undefined,
		fontSize: fontSizes.length > 0 ? fontSizes : undefined,
	}
}
