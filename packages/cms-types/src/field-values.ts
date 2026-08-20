/**
 * What an empty value of a field looks like, and when a field counts as unfilled.
 *
 * These rules decide what reaches disk, so every editor has to answer them the same way — and
 * for a while none of them did. `@nuasite/cms`'s in-page editor, `@nuasite/collections-admin`,
 * webmaster's own collections panel and the content check each had their own copy, and the
 * copies disagreed: appending `{}` to a repeater wrote frontmatter the schema rejects (13 of 14
 * build-breaking findings across five production sites), while the other copy seeded every key
 * with `''` and broke the fields that were happy absent.
 *
 * They live in `cms-types` because that is the one package all of those consumers already
 * depend on — `cms-core` cannot reach `cms-client` without inverting the layering, and a rule
 * that only some writers can import is a rule that drifts. Keep this file to pure functions
 * over a `FieldDefinition`-shaped value; anything that knows about routes, the filesystem or
 * the wire belongs in the package that owns them (see `editor-write-model.ts` in `cms-core`).
 *
 * Three questions are answered here, and the difference between the first two is the whole
 * reason both exist:
 *
 * - **What does a create form start a field at?** `blankFieldValue` — absence is allowed, so
 *   anything whose schema would refuse a placeholder is left unset and the key is omitted.
 * - **What does a key that must be present carry?** `seedValueForRequiredField` — omitting is
 *   not an option there, so a placeholder it is, and `0` beats a missing number.
 * - **What must never reach disk?** `withoutBlankArrayItems` — a blank *item* inside a list.
 */

import type { FieldType } from './index'

/** The parts of a field these rules read — satisfied by both `FieldDefinition` and a mapped `ParsedField`. */
export interface WriteModelField {
	name: string
	type?: FieldType
	/** Derived/computed field: the form offers no way to fill it in, so a create omits it. */
	hidden?: boolean
	defaultValue?: unknown
}

/**
 * No value at all — as opposed to an empty collection or a falsy scalar.
 *
 * `false` and `0` are values and pass. `[]` and `{}` are a deliberate "nothing here"
 * and pass too.
 */
export function isBlankFieldValue(value: unknown): boolean {
	return value === undefined || value === null || value === ''
}

/**
 * The value a key that **must be present** carries when nobody has filled it in.
 *
 * Used where omitting is not on the table: a required field of a repeater item, which reaches
 * disk the moment "+ Add" is clicked. A placeholder the schema might refuse is still better
 * than a missing required key, because the missing key is refused by every schema.
 *
 * This is deliberately *not* what a create form starts a field at — see `blankFieldValue`,
 * which may leave the key out precisely because a create is allowed to. Seeding a create with
 * this rule is what wrote `position: 0` into a collection whose schema asks for `>= 1`.
 *
 * Note which of these survive `omitEmptyOnCreate` in `cms-core`: `false`, `0`, `[]` and the
 * date string are written, `''` is not.
 */
export function seedValueForRequiredField(field: WriteModelField, today: () => Date = () => new Date()): unknown {
	if (field.defaultValue !== undefined) return field.defaultValue
	switch (field.type) {
		case 'boolean':
			return false
		case 'number':
			return 0
		case 'array':
			return []
		case 'date':
			return today().toISOString().split('T')[0]
		default:
			return ''
	}
}

/**
 * The value a create form starts a field at, where leaving the key out is allowed.
 *
 * Both create forms now ask this one function — the in-page editor through
 * `newEntryFrontmatter`, `collections-admin` and webmaster's panel through `draftForCreate`.
 * They used to answer separately and disagree on `number` and `date`, so a check that
 * predicted one of them was silent about the other.
 *
 * Everything whose schema commonly refuses a placeholder is left unset, so an untouched
 * optional field is *omitted* rather than written as `date: ''`, `order: 0` or `role: ''`.
 * A single rejected entry fails the whole site build, and a required field left unset is
 * caught by `blankRequiredFields` with a sentence naming it.
 *
 * `false`, `[]` and `{}` are real values, not placeholders: they say "nothing here" in a
 * shape every schema for that type accepts.
 */
export function blankFieldValue(field: WriteModelField): unknown {
	if (field.defaultValue !== undefined) return field.defaultValue
	switch (field.type) {
		case 'boolean':
			return false
		case 'array':
			return []
		case 'object':
			return {}
		case 'date':
		case 'datetime':
		case 'time':
		case 'month':
		case 'number':
		case 'year':
		case 'select':
		case 'reference':
			return undefined
		default:
			return ''
	}
}

/** An item field, which needs its `required` flag as well — that is what decides whether it is seeded. */
export interface RepeaterItemField extends WriteModelField {
	required: boolean
}

/**
 * The item "+ Add" appends to a repeater.
 *
 * Required fields are seeded with their type's blank; optional ones are left out entirely.
 * That split is the whole point, and both halves were bugs:
 *
 * - Appending `{}` (or an item missing a required key) writes frontmatter the schema rejects,
 *   and unlike a create there is no guard in front of it — the item reaches disk on the click.
 * - Seeding an *optional* field with `''` breaks schemas that would have been happy with the
 *   key absent — an optional `z.string().url()` or an optional array both refuse `''`. A key
 *   the schema declared optional is by definition safe to omit, so omitting is never wrong.
 *
 * Hidden fields are skipped for the same reason as everywhere else: nothing can fill them in.
 * A hidden *required* item field is therefore still missing, and `cms/empty-write` reports it.
 */
export function newRepeaterItem(fields: RepeaterItemField[], today?: () => Date): Record<string, unknown> {
	const item: Record<string, unknown> = {}
	for (const field of fields) {
		if (!field.required || field.hidden) continue
		item[field.name] = seedValueForRequiredField(field, today)
	}
	return item
}

/** A field carrying a declared required flag. `layout.*` is how `parseContentConfig` spells it. */
export interface RequiredGuardField {
	name: string
	required: boolean
	hidden?: boolean
	/** Set only where a derivation was *declared* in the content config — see `blankRequiredFields`. */
	derivedDeclared?: boolean
	layout?: { hidden?: boolean; derivedFrom?: string }
}

/**
 * Whether this field's value is computed from another field on every write.
 *
 * Only a *declared* derivation counts. `parseContentConfig` puts one in `layout.derivedFrom`,
 * which only ever comes from the config; the wire `FieldDefinition` flags it as
 * `derivedDeclared`, because there `derivedFrom` alone is ambiguous — `detectDerivedHrefFields`
 * also sets it, from a guess over at most three sampled values, and nothing recomputes that.
 */
function isDeclaredDerived(field: RequiredGuardField): boolean {
	return field.derivedDeclared === true || field.layout?.derivedFrom !== undefined
}

/**
 * Names of the schema-declared required fields left empty by `frontmatter`.
 *
 * Only top-level fields are checked. Nested object/array members are left alone: a
 * required key *inside* an object says nothing about whether that object was meant to
 * be filled in at all, and rejecting on it would block partial edits.
 *
 * `hidden` fields are skipped — the form offers no way to fill them in, so blocking on
 * one would make the entry uncreatable. A hidden required field is therefore *not*
 * protected by this guard, and a checker must not assume it is.
 *
 * Provenance matters and is easy to get wrong: this is only meaningful over `required` a
 * *schema* declared. `scanCollections` also reports a `required` flag, but it infers it as
 * "present in every entry scanned", so a one-entry collection marks everything that entry
 * happens to carry as required — enforcing that would make the collection impossible to
 * extend. `FieldDefinition.required` on a collection that reached `applyParsedFieldOverrides`
 * carries the schema's answer; anything else does not.
 *
 * A declared derived field is skipped whatever its `hidden` says. Its value is computed from
 * another field on every write, so it is never something a caller fills in, and demanding it
 * back would reject a write over a value only the CMS produces. Declaring a derivation also
 * implies hiding it, so it is usually invisible too — reporting `categoryHref` would name a
 * field the user cannot see, let alone fill. What they *can* act on is the source, and that
 * carries its own `required`: leave `category` empty and `category` is what gets reported.
 */
export function blankRequiredFields(fields: RequiredGuardField[], frontmatter: Record<string, unknown>): string[] {
	return fields
		.filter(field =>
			field.required
			&& !(field.hidden ?? field.layout?.hidden)
			&& !isDeclaredDerived(field)
			&& isBlankFieldValue(frontmatter[field.name])
		)
		.map(field => field.name)
}

/** A record written as frontmatter, as opposed to a `Date`, a class instance or a list. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

/** A list with its blank items dropped, applied to whatever the items themselves contain. */
function prunedValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(prunedValue).filter(item => !isBlankFieldValue(item))
	if (isPlainRecord(value)) return withoutBlankArrayItems(value)
	return value
}

/**
 * The same frontmatter with every blank *item* removed from every list, at any depth.
 *
 * A field can be absent; an item inside a list cannot. That asymmetry is what makes this
 * necessary: an editor that clears a field writes `undefined` and the key is simply omitted,
 * but the same `undefined` sitting in a list has nowhere to go — `JSON.stringify` turns it
 * into `null` on the way to the server, and `null` is then written out as a real list entry.
 * One unfilled row appended by "+ Add" is enough to fail `astro sync`, and Astro validates a
 * collection as a whole, so the entry that fails takes the entire site build with it.
 *
 * Applied server-side, in `handlers/entry-ops.ts`, so it holds for every editor that reaches
 * the sidecar — including versions of them older than this rule.
 *
 * Blank means `isBlankFieldValue`: `undefined`, `null`, `''`. `false`, `0`, `[]` and `{}` are
 * values a list may legitimately hold and are kept.
 */
export function withoutBlankArrayItems(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(frontmatter)) out[key] = prunedValue(value)
	return out
}
