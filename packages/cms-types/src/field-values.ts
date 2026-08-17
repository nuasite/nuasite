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
 * The value an editor pre-fills a newly created field with.
 *
 * Note which of these survive `omitEmptyOnCreate` in `cms-core`: `false`, `0`, `[]` and the
 * date string are written, `''` is not.
 */
export function defaultValueForNewEntry(field: WriteModelField, today: () => Date = () => new Date()): unknown {
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
		item[field.name] = defaultValueForNewEntry(field, today)
	}
	return item
}

/** A field carrying a declared required flag. `layout.hidden` is how `parseContentConfig` spells it. */
export interface RequiredGuardField {
	name: string
	required: boolean
	hidden?: boolean
	layout?: { hidden?: boolean }
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
 */
export function blankRequiredFields(fields: RequiredGuardField[], frontmatter: Record<string, unknown>): string[] {
	return fields
		.filter(field => field.required && !(field.hidden ?? field.layout?.hidden) && isBlankFieldValue(frontmatter[field.name]))
		.map(field => field.name)
}
