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

/**
 * Derive the pathname a newly created collection entry will resolve to, from
 * the pathnames of existing sibling entries. Entries can resolve their own
 * pathname from a per-entry declared URL field (see `declaredSitePathFromData`
 * in the source-finder package), so entries in the same collection can live
 * under different prefixes -- e.g. a collection served under a dynamic
 * `[topic]/[slug]` route. Only reuse a sibling's prefix when every entry that
 * has a pathname agrees on the same one; otherwise there's no way to know
 * which prefix the new entry belongs under, and guessing wrong would send the
 * user to an unrelated page.
 */
export function resolveCreateRedirectUrl(entries: Array<{ pathname?: string }>, slug: string): string | undefined {
	const prefixes = new Set(
		entries
			.map((e) => e.pathname)
			.filter((p): p is string => !!p)
			.map((p) => p.slice(0, p.lastIndexOf('/') + 1))
			.filter((prefix) => prefix.length > 0),
	)
	return prefixes.size === 1 ? `${[...prefixes][0]}${slug}` : undefined
}
