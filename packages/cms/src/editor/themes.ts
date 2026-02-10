import type { CmsConfig, CmsThemeConfig, CmsThemePreset } from './types'

/**
 * Theme presets for CMS UI
 */
export const THEME_PRESETS: Record<CmsThemePreset, CmsThemeConfig> = {
	soft: {
		primary: '#DFFF40',
		secondary: '#1A1A1A',
		background: '#E8E8E8',
		card: '#FFFFFF',
		borderRadius: 'rounded',
		shadowStyle: 'soft',
	},
	brutalist: {
		primary: '#005AE0',
		secondary: '#005AE0',
		background: '#FFFFFF',
		card: '#FFFFFF',
		borderRadius: 'sharp',
		shadowStyle: 'brutalist',
	},
	minimal: {
		primary: '#1A1A1A',
		secondary: '#666666',
		background: '#FAFAFA',
		card: '#FFFFFF',
		borderRadius: 'soft',
		shadowStyle: 'none',
	},
}

/**
 * Resolved theme with all values computed from preset + overrides
 */
export interface ResolvedTheme {
	// Colors
	primary: string
	primaryHover: string
	primaryText: string
	secondary: string
	secondaryHover: string
	background: string
	card: string
	text: string
	textMuted: string
	border: string

	// Radii
	radiusSm: string
	radiusMd: string
	radiusLg: string
	radiusXl: string
	radiusPill: string

	// Shadows
	shadowSm: string
	shadowMd: string
	shadowLg: string

	// Preset info
	preset: CmsThemePreset
}

/**
 * Darken a hex color by a percentage
 */
function darkenColor(hex: string, percent: number): string {
	const num = Number.parseInt(hex.replace('#', ''), 16)
	const amt = Math.round(2.55 * percent)
	const R = Math.max(0, (num >> 16) - amt)
	const G = Math.max(0, ((num >> 8) & 0x00ff) - amt)
	const B = Math.max(0, (num & 0x0000ff) - amt)
	return `#${((1 << 24) | (R << 16) | (G << 8) | B).toString(16).slice(1)}`
}

/**
 * Get contrasting text color for a background
 */
function getContrastText(hex: string): string {
	const num = Number.parseInt(hex.replace('#', ''), 16)
	const r = num >> 16
	const g = (num >> 8) & 0x00ff
	const b = num & 0x0000ff
	// Using relative luminance formula
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
	return luminance > 0.5 ? '#1A1A1A' : '#FFFFFF'
}

/**
 * Get border radius values based on style preset
 */
function getRadii(style: 'sharp' | 'soft' | 'rounded'): Pick<ResolvedTheme, 'radiusSm' | 'radiusMd' | 'radiusLg' | 'radiusXl' | 'radiusPill'> {
	switch (style) {
		case 'sharp':
			return {
				radiusSm: '0px',
				radiusMd: '0px',
				radiusLg: '0px',
				radiusXl: '0px',
				radiusPill: '0px',
			}
		case 'soft':
			return {
				radiusSm: '4px',
				radiusMd: '8px',
				radiusLg: '12px',
				radiusXl: '16px',
				radiusPill: '9999px',
			}
		default:
			return {
				radiusSm: '8px',
				radiusMd: '16px',
				radiusLg: '24px',
				radiusXl: '32px',
				radiusPill: '9999px',
			}
	}
}

/**
 * Get shadow values based on style preset
 */
function getShadows(style: 'none' | 'soft' | 'brutalist'): Pick<ResolvedTheme, 'shadowSm' | 'shadowMd' | 'shadowLg'> {
	switch (style) {
		case 'none':
			return {
				shadowSm: 'none',
				shadowMd: 'none',
				shadowLg: 'none',
			}
		case 'brutalist':
			return {
				shadowSm: '4px 4px 0px 0px rgba(0, 0, 0, 1)',
				shadowMd: '6px 6px 0px 0px rgba(0, 0, 0, 1)',
				shadowLg: '8px 8px 0px 0px rgba(0, 0, 0, 1)',
			}
		default:
			return {
				shadowSm: '0 2px 8px rgba(0,0,0,0.04)',
				shadowMd: '0 4px 16px rgba(0,0,0,0.06)',
				shadowLg: '0 10px 40px rgba(0,0,0,0.08)',
			}
	}
}

/**
 * Resolve theme from config (preset + overrides)
 */
export function resolveTheme(config: CmsConfig): ResolvedTheme {
	const presetName = config.themePreset || 'soft'
	const preset = THEME_PRESETS[presetName]
	const overrides = config.theme || {}

	// Merge preset with overrides
	const primary = overrides.primary || preset.primary || '#DFFF40'
	const secondary = overrides.secondary || preset.secondary || '#9BB5FC'
	const background = overrides.background || preset.background || '#E6E6E6'
	const card = overrides.card || preset.card || '#FFFFFF'
	const borderRadius = overrides.borderRadius || preset.borderRadius || 'rounded'
	const shadowStyle = overrides.shadowStyle || preset.shadowStyle || 'soft'

	return {
		primary,
		primaryHover: darkenColor(primary, 5),
		primaryText: getContrastText(primary),
		secondary,
		secondaryHover: darkenColor(secondary, 10),
		background,
		card,
		text: '#1A1A1A',
		textMuted: '#666666',
		border: 'rgba(0, 0, 0, 0.1)',
		...getRadii(borderRadius),
		...getShadows(shadowStyle),
		preset: presetName,
	}
}

/**
 * Generate CSS variable overrides from resolved theme
 */
export function generateCSSVariables(theme: ResolvedTheme): string {
	return `
		--color-cms-bg: ${theme.background};
		--color-cms-card: ${theme.card};
		--color-cms-primary: ${theme.primary};
		--color-cms-primary-hover: ${theme.primaryHover};
		--color-cms-primary-text: ${theme.primaryText};
		--color-cms-secondary: ${theme.secondary};
		--color-cms-secondary-hover: ${theme.secondaryHover};
		--color-cms-dark: #1A1A1A;
		--color-cms-dark-hover: #333333;
		--color-cms-text: ${theme.text};
		--color-cms-text-muted: ${theme.textMuted};
		--color-cms-border: ${theme.border};
		--radius-cms-sm: ${theme.radiusSm};
		--radius-cms-md: ${theme.radiusMd};
		--radius-cms-lg: ${theme.radiusLg};
		--radius-cms-xl: ${theme.radiusXl};
		--radius-cms-pill: ${theme.radiusPill};
		--shadow-cms-sm: ${theme.shadowSm};
		--shadow-cms-md: ${theme.shadowMd};
		--shadow-cms-lg: ${theme.shadowLg};
		--shadow-brutalist-sm: ${theme.shadowMd};
		--shadow-brutalist-md: ${theme.shadowLg};
		--color-blue-bold: ${theme.secondary};
	`.trim()
}
