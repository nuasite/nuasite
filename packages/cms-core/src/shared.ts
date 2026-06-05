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

/** Runtime guard: a non-null, non-array object usable as a string-keyed record. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
 * Escape HTML special characters to prevent injection.
 * Covers &, <, >, ", and ' — the full set needed for both text content and attribute values.
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/**
 * Compute a POSIX-style relative import path from one root-relative file to another.
 * Both paths are forward-slash POSIX paths relative to the project root. Ensures
 * the result starts with `./` or `../`.
 */
export function relativeImportPath(fromFile: string, toFile: string): string {
	const fromSegments = fromFile.split('/').slice(0, -1)
	const toSegments = toFile.split('/')

	let common = 0
	while (common < fromSegments.length && common < toSegments.length - 1 && fromSegments[common] === toSegments[common]) {
		common++
	}

	const up = fromSegments.slice(common).map(() => '..')
	const down = toSegments.slice(common)
	const joined = [...up, ...down].join('/')
	return joined.startsWith('.') ? joined : `./${joined}`
}
