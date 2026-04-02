/**
 * Slugify text for URL paths.
 * Lowercases, strips non-word characters, collapses whitespace/underscores to hyphens.
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s\-/]/g, '')
		.replace(/[\s_]+/g, '-')
		.replace(/^[-/]+|[-/]+$/g, '')
}

/**
 * Slugify with diacritics normalization for href paths.
 * "Lidé" → "lide", "Aktuálně z nezisku" → "aktualne-z-nezisku"
 */
export function slugifyHref(text: string): string {
	return '/' + text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_]+/g, '-')
		.replace(/^-+|-+$/g, '')
}
