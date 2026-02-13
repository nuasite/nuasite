import type { Attribute, BackgroundImageMetadata } from './types'

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
 * Non-color utility suffixes that should not be matched as custom colors.
 * These follow the pattern `prefix-word-number` but are not colors.
 */
const NON_COLOR_SUFFIXES = ['opacity'] as const

/**
 * Build a regex pattern for matching color classes.
 * Matches:
 * - Default colors with optional shades: bg-blue-500, bg-white
 * - Custom theme colors with shades: bg-primary-500
 * - Arbitrary hex values: bg-[#41b883], bg-[#fff]
 * - Arbitrary rgb/hsl values: bg-[rgb(255,0,0)], bg-[hsl(0,100%,50%)]
 * Excludes non-color utilities like opacity.
 */
function buildColorPattern(prefix: string): RegExp {
	const colorNames = [...DEFAULT_TAILWIND_COLORS, ...SPECIAL_COLORS].join('|')
	const excluded = NON_COLOR_SUFFIXES.join('|')
	// Arbitrary value patterns for colors
	const arbitraryHex = '\\[#[0-9a-fA-F]{3,8}\\]'
	const arbitraryFunc = '\\[(?:rgba?|hsla?)\\([^\\]]+\\)\\]'
	// Match: prefix-(colorName[-shade]?) OR prefix-(customColor-shade) OR prefix-[arbitrary] but NOT prefix-(excluded-number)
	return new RegExp(`^${prefix}-((?:${colorNames})(?:-(\\d+))?|(?!(?:${excluded})-)(\\w+)-(\\d+)|${arbitraryHex}|${arbitraryFunc})$`)
}

/**
 * Build a regex pattern for matching opacity classes.
 */
function buildOpacityPattern(prefix: string): RegExp {
	return new RegExp(`^${prefix}-opacity-(\\d+)$`)
}

/**
 * Regex patterns to match Tailwind color classes.
 */
export const COLOR_CLASS_PATTERNS = {
	bg: buildColorPattern('bg'),
	text: buildColorPattern('text'),
	border: buildColorPattern('border'),
	hoverBg: buildColorPattern('hover:bg'),
	hoverText: buildColorPattern('hover:text'),
	hoverBorder: buildColorPattern('hover:border'),
}

/**
 * Regex patterns to match Tailwind opacity classes.
 */
export const OPACITY_CLASS_PATTERNS = {
	bgOpacity: buildOpacityPattern('bg'),
	textOpacity: buildOpacityPattern('text'),
	borderOpacity: buildOpacityPattern('border'),
}

/**
 * Regex patterns to match Tailwind gradient color classes.
 */
export const GRADIENT_CLASS_PATTERNS = {
	from: buildColorPattern('from'),
	via: buildColorPattern('via'),
	to: buildColorPattern('to'),
	hoverFrom: buildColorPattern('hover:from'),
	hoverVia: buildColorPattern('hover:via'),
	hoverTo: buildColorPattern('hover:to'),
}

/** Flat key names for color class categories */
const COLOR_FLAT_KEYS: Record<string, string> = {
	bg: 'bg',
	text: 'text',
	border: 'border',
	hoverBg: 'hoverBg',
	hoverText: 'hoverText',
	hoverBorder: 'hoverBorder',
}

const GRADIENT_FLAT_KEYS: Record<string, string> = {
	from: 'gradientFrom',
	via: 'gradientVia',
	to: 'gradientTo',
	hoverFrom: 'hoverGradientFrom',
	hoverVia: 'hoverGradientVia',
	hoverTo: 'hoverGradientTo',
}

/**
 * Extract color classes from an element's class attribute.
 * Returns a flat Record<string, Attribute> with keys like bg, text, gradientFrom, bgOpacity, etc.
 */
export function extractColorClasses(classAttr: string | null | undefined): Record<string, Attribute> | undefined {
	if (!classAttr) return undefined

	const classes = classAttr.split(/\s+/).filter(Boolean)
	const result: Record<string, Attribute> = {}

	for (const cls of classes) {
		let matched = false

		// Check color patterns
		for (const [key, pattern] of Object.entries(COLOR_CLASS_PATTERNS)) {
			if (pattern.test(cls)) {
				const flatKey = COLOR_FLAT_KEYS[key]
				if (flatKey && !(flatKey in result)) {
					result[flatKey] = { value: cls }
				}
				matched = true
				break
			}
		}

		// Check gradient patterns
		if (!matched) {
			for (const [key, pattern] of Object.entries(GRADIENT_CLASS_PATTERNS)) {
				if (pattern.test(cls)) {
					const flatKey = GRADIENT_FLAT_KEYS[key]
					if (flatKey && !(flatKey in result)) {
						result[flatKey] = { value: cls }
					}
					matched = true
					break
				}
			}
		}

		// Check opacity patterns
		if (!matched) {
			for (const [key, pattern] of Object.entries(OPACITY_CLASS_PATTERNS)) {
				if (pattern.test(cls)) {
					if (!(key in result)) {
						result[key] = { value: cls }
					}
					break
				}
			}
		}
	}

	return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Regex patterns for matching text style classes on elements.
 */
export const TEXT_STYLE_CLASS_PATTERNS: Record<string, RegExp> = {
	fontWeight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
	fontStyle: /^(italic|not-italic)$/,
	textDecoration: /^(underline|overline|line-through|no-underline)$/,
	fontSize: /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
}

/**
 * Extract text style classes from an element's class attribute.
 * Returns a Record<string, Attribute> with keys: fontWeight, fontStyle, textDecoration, fontSize.
 */
export function extractTextStyleClasses(classAttr: string | null | undefined): Record<string, Attribute> | undefined {
	if (!classAttr) return undefined

	const classes = classAttr.split(/\s+/).filter(Boolean)
	const result: Record<string, Attribute> = {}

	for (const cls of classes) {
		for (const [key, pattern] of Object.entries(TEXT_STYLE_CLASS_PATTERNS)) {
			if (pattern.test(cls) && !(key in result)) {
				result[key] = { value: cls }
				break
			}
		}
	}

	return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Check if a class is a color class (including gradient colors).
 */
export function isColorClass(className: string): boolean {
	return Object.values(COLOR_CLASS_PATTERNS).some(pattern => pattern.test(className))
		|| Object.values(GRADIENT_CLASS_PATTERNS).some(pattern => pattern.test(className))
}

/**
 * Generate a new class string with a color class replaced.
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
 * Returns the flat key name (e.g., 'bg', 'gradientFrom', 'bgOpacity').
 */
export function getColorType(colorClass: string): string | undefined {
	for (const [key, pattern] of Object.entries(COLOR_CLASS_PATTERNS)) {
		if (pattern.test(colorClass)) {
			return COLOR_FLAT_KEYS[key]
		}
	}
	for (const [key, pattern] of Object.entries(GRADIENT_CLASS_PATTERNS)) {
		if (pattern.test(colorClass)) {
			return GRADIENT_FLAT_KEYS[key]
		}
	}
	for (const [key, pattern] of Object.entries(OPACITY_CLASS_PATTERNS)) {
		if (pattern.test(colorClass)) {
			return key
		}
	}
	return undefined
}

/**
 * Parse a color class into its components.
 */
export function parseColorClass(colorClass: string): {
	prefix: string
	colorName: string
	shade?: string
	isHover: boolean
	isArbitrary?: boolean
} | undefined {
	// Verify this is actually a color class using the comprehensive patterns
	const isColor = Object.values(COLOR_CLASS_PATTERNS).some(p => p.test(colorClass))
		|| Object.values(GRADIENT_CLASS_PATTERNS).some(p => p.test(colorClass))
	if (!isColor) return undefined

	const isHover = colorClass.startsWith('hover:')
	const classWithoutHover = isHover ? colorClass.slice(6) : colorClass

	// Try matching standard color classes (default colors, custom theme colors, and gradients)
	const standardMatch = classWithoutHover.match(/^(bg|text|border|from|via|to)-([a-z]+)(?:-(\d+))?$/)
	if (standardMatch) {
		return {
			prefix: isHover ? `hover:${standardMatch[1]}` : standardMatch[1]!,
			colorName: standardMatch[2]!,
			shade: standardMatch[3],
			isHover,
		}
	}

	// Try matching arbitrary value classes like bg-[#41b883] or from-[#41b883]
	const arbitraryMatch = classWithoutHover.match(/^(bg|text|border|from|via|to)-(\[.+\])$/)
	if (arbitraryMatch) {
		return {
			prefix: isHover ? `hover:${arbitraryMatch[1]}` : arbitraryMatch[1]!,
			colorName: arbitraryMatch[2]!,
			shade: undefined,
			isHover,
			isArbitrary: true,
		}
	}

	return undefined
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

// ============================================================================
// Background Image Class Extraction
// ============================================================================

/** Regex to match bg-[url('...')] classes (single quotes, double quotes, or no quotes) */
const BG_IMAGE_CLASS_PATTERN = /^bg-\[url\(['"]?([^'")\]]+)['"]?\)\]$/

/** Regex to match bg-size utility classes */
const BG_SIZE_PATTERN = /^bg-(auto|cover|contain)$/

/** Regex to match bg-position utility classes */
const BG_POSITION_PATTERN = /^bg-(center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right)$/

/** Regex to match bg-repeat utility classes */
const BG_REPEAT_PATTERN = /^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/

/**
 * Extract background image classes from an element's class attribute.
 * Only returns metadata if a bg-[url()] class is found.
 * Standalone bg-size/position/repeat without a bg image are ignored.
 */
export function extractBackgroundImageClasses(classAttr: string | null | undefined): BackgroundImageMetadata | undefined {
	if (!classAttr) return undefined

	const classes = classAttr.split(/\s+/).filter(Boolean)

	let bgImageClass: string | undefined
	let imageUrl: string | undefined
	let bgSize: string | undefined
	let bgPosition: string | undefined
	let bgRepeat: string | undefined

	for (const cls of classes) {
		const imgMatch = cls.match(BG_IMAGE_CLASS_PATTERN)
		if (imgMatch) {
			bgImageClass = cls
			imageUrl = imgMatch[1]!
			continue
		}

		if (BG_SIZE_PATTERN.test(cls)) {
			bgSize = cls
			continue
		}

		if (BG_POSITION_PATTERN.test(cls)) {
			bgPosition = cls
			continue
		}

		if (BG_REPEAT_PATTERN.test(cls)) {
			bgRepeat = cls
		}
	}

	// Only return metadata if a bg-[url()] class was found
	if (!bgImageClass || !imageUrl) return undefined

	return {
		bgImageClass,
		imageUrl,
		bgSize,
		bgPosition,
		bgRepeat,
	}
}
