/**
 * Slug derivation — the one rule the server and every client have to agree on.
 *
 * `slugify` names the file a new entry is written to. The sidecar re-slugifies whatever it
 * receives, so a host that derives a slug locally is *predicting* that write: an inline
 * duplicate check, a "saved as" preview or the slug a create form navigates to are all wrong
 * the moment the two implementations disagree. They have disagreed before — webmaster carried
 * its own copy that folded diacritics while `cms-core` dropped them, so a Czech title became
 * `vedra-jako-zdravotn-i-sociln-problm` on one side and `vedra-jako-zdravotni-i-socialni-problem`
 * on the other.
 *
 * It lives in `cms-types` for the same reason `field-values.ts` does: `cms-core` (the server)
 * and `cms-client` (every UI) are siblings, and this is the only package both already depend on.
 * A rule that only one side can import is a rule that drifts.
 */

/**
 * Slugify text for URL paths.
 *
 * Folds diacritics, lowercases, strips non-word characters, collapses whitespace/underscores
 * to hyphens. Keeps `/`, so a nested entry path survives.
 *
 * The fold matters because this names a file: `[^\w\s\-/]` alone deletes diacritics rather than
 * folding them. Idempotent, so the server re-slugifying a client's output is a no-op.
 */
export function slugify(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim()
		.replace(/[^\w\s\-/]/g, '')
		.replace(/[\s_]+/g, '-')
		.replace(/^[-/]+|[-/]+$/g, '')
}

/**
 * The first `slug-N` not already taken, for a UI offering a non-colliding alternative.
 *
 * Suffixes from 2 (`rozhovor` → `rozhovor-2`), matching what a reader expects of a "second one".
 * The caller passes the slugs it knows about; this makes no claim about what is on disk, so a
 * create/rename still has to handle the server refusing a collision it raced with.
 */
export function nextFreeSlug(slug: string, existingSlugs: ReadonlySet<string>): string {
	let suffix = 2
	while (existingSlugs.has(`${slug}-${suffix}`)) suffix += 1
	return `${slug}-${suffix}`
}
