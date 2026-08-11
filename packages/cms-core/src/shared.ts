import { type CollectionDefinition, type DerivedTransform, type PathnameSpec, slugify } from '@nuasite/cms-types'

/**
 * Coerce a frontmatter value into a URL path segment. Strings pass through;
 * numbers and booleans are stringified (YAML auto-coerces `year: 2024` → number,
 * `draft: true` → boolean); dates use their ISO calendar day (`2024-01-15`), which
 * is what YAML produces a `Date` from. Anything else — `null`/`undefined` (missing)
 * or objects/arrays (not addressable as a single segment) — yields `undefined`,
 * which voids the whole rule so callers fall through to other pathname sources.
 */
function pathSegmentValue(raw: unknown): string | undefined {
	if (typeof raw === 'string') return raw
	if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
	if (raw instanceof Date) return raw.toISOString().slice(0, 10)
	return undefined
}

/**
 * Compose a collection entry's page URL from a declarative {@link PathnameSpec}
 * and the entry's frontmatter `data`.
 *
 * Each segment resolves to either a fixed `literal` or the value of `data[field]`
 * (optionally remapped through the segment's `map`). Field values are coerced via
 * {@link pathSegmentValue} — strings, numbers, booleans, and dates all resolve.
 * Resolved segments are joined with `/`, prefixed with a single leading `/`,
 * collapsed of duplicate slashes, and stripped of any trailing slash. If any
 * `{ field }` segment's value is missing or not coercible (null/object/array) the
 * whole rule yields `undefined`, so callers fall through to their existing
 * pathname sources.
 */
export function computePathnameFromSpec(spec: PathnameSpec, data: Record<string, unknown>): string | undefined {
	const segments: string[] = []
	for (const seg of spec) {
		if ('literal' in seg) {
			segments.push(seg.literal)
			continue
		}
		const value = pathSegmentValue(data[seg.field])
		if (value === undefined) return undefined
		segments.push(
			seg.map && Object.hasOwn(seg.map, value) ? seg.map[value]! : value,
		)
	}
	const path = ('/' + segments.join('/')).replace(/\/{2,}/g, '/').replace(/\/+$/, '')
	return path === '' ? '/' : path
}

/**
 * Resolve a collection entry's declarative `cms.pathname` to a page URL — the
 * single source of spec-driven pathname resolution shared by the dev middleware
 * and the build-time manifest writer, so the two never drift.
 *
 * A declared `pathname` spec is the highest-priority source for an entry's URL
 * (it wins over the rendered-route pathname); this helper returns the spec-derived
 * URL, or `undefined` when no spec is declared or the spec doesn't resolve for
 * this entry, in which case callers fall back to their own route-derived sources.
 */
export function resolvePathnameFromSpec(
	def: Pick<CollectionDefinition, 'pathname'>,
	data: Record<string, unknown> | undefined,
): string | undefined {
	// parseCmsPathname never yields an empty array (it returns undefined instead),
	// so a present `pathname` is always a usable spec.
	if (!def.pathname) return undefined
	return computePathnameFromSpec(def.pathname, data ?? {})
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

/** Runtime guard: a non-null, non-array object usable as a string-keyed record. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Re-exported from `@nuasite/cms-types` so the server and every client slugify identically —
 * a host deriving a slug locally is predicting this write. See `cms-types/src/slug.ts`.
 */
export { slugify }

/** A field's derived-value declaration, the subset of `FieldDefinition` the recompute reads. */
export interface DerivedFieldSpec {
	name: string
	derivedFrom?: string
	derivedTransform?: DerivedTransform
}

/**
 * Apply a derived field's named transform to its source value.
 *
 * `slug` reuses `slugify` deliberately, and `slugify` **keeps `/`** — it is written to name
 * files on disk, where a nested entry path has to survive. So `transform: 'slug'` on a value
 * that already contains a slash keeps it (`"news/2024"` → `"news/2024"`). That is a conscious
 * reuse of the existing function, not a bug: the transform is documented as "the `slugifyHref`
 * fold without the leading slash", and every other separator still collapses to `-`.
 */
export function applyDerivedTransform(value: string, transform: DerivedTransform | undefined): string {
	switch (transform) {
		case 'copy':
			return value
		case 'slug':
			return slugify(value)
		// `slugifyHref` is the default so a declared `derivedFrom: 'category'` produces exactly
		// what `detectDerivedHrefFields` used to infer — migrating an inferred field to a
		// declared one must not rewrite any data.
		default:
			return slugifyHref(value)
	}
}

/**
 * Values every derived field in `fields` should hold given `data`, keyed by field name.
 *
 * The single definition of "recompute derived fields", shared by every write path in
 * `cms-core`. A source field that is missing or not a string yields no entry at all — the
 * existing value is left alone rather than blanked, because "no source" is not "empty
 * result". `hidden` is deliberately not consulted: an author who sets `hidden: false` on a
 * declared derived field still gets it computed, they only also get to see it.
 */
export function computeDerivedFieldUpdates(
	fields: readonly DerivedFieldSpec[],
	data: Record<string, unknown>,
): Record<string, unknown> {
	const updates: Record<string, unknown> = {}
	for (const field of fields) {
		if (!field.derivedFrom) continue
		const source = data[field.derivedFrom]
		if (typeof source !== 'string') continue
		updates[field.name] = applyDerivedTransform(source, field.derivedTransform)
	}
	return updates
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
