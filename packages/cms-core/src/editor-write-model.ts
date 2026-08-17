/**
 * What the editor actually writes — the single source of truth.
 *
 * Three sides have to agree about this and used to hold their own copy: the editor
 * that builds a new entry's frontmatter, the write guard that rejects a blank required
 * field before it reaches disk, and the content check that predicts whether a write
 * the editor is about to make will still parse against the collection schema.
 *
 * A check built on a second, drifted copy of these rules reports failures that cannot
 * happen and misses the ones that can, so it is the one thing here that must not be
 * reimplemented anywhere.
 */

import type { FieldType } from '@nuasite/cms-types'

/** The parts of a field this model reads — satisfied by both `FieldDefinition` and a mapped `ParsedField`. */
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
 * The value the editor pre-fills a newly created entry's field with.
 *
 * Mirrors `getDefaultForFieldType` in `@nuasite/cms`'s editor signals. Note which of
 * these survive `omitEmptyOnCreate` below: `false`, `0`, `[]` and the date string are
 * written, `''` is not.
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

/**
 * The frontmatter the editor holds when "create entry" opens, before the user types.
 *
 * `title` is excluded because the create form carries it in its own header field, and
 * hidden fields are excluded because the form cannot fill them in. Neither is missing from
 * the finished entry — see `applyCreateRouteFields`, which is what puts `title` back.
 */
export function newEntryFrontmatter(fields: WriteModelField[], today?: () => Date): Record<string, unknown> {
	const frontmatter: Record<string, unknown> = {}
	for (const field of fields) {
		if (field.name === 'title' || field.hidden) continue
		frontmatter[field.name] = defaultValueForNewEntry(field, today)
	}
	return frontmatter
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
 *   Across five production sites this was 13 of 14 build-breaking findings.
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

/** Whether the create route treats a collection's files as markdown entries or as plain data. */
export type CollectionKind = 'markdown' | 'data'

/**
 * The last step of a create: what the server adds before the file is written.
 *
 * A markdown entry gets the title from the form — which refuses to be blank — plus today's
 * date, and the form's own frontmatter wins over both (`handlers/api-routes.ts`). A data
 * entry is written verbatim, with the title already among its fields.
 *
 * Anything predicting a create has to apply this. Stopping at the editor's payload predicts
 * an entry with no title, and then reports a required `title` as broken on every project.
 */
export function applyCreateRouteFields(
	frontmatter: Record<string, unknown>,
	kind: CollectionKind,
	today: () => Date = () => new Date(),
): Record<string, unknown> {
	const title = 'Untitled'
	if (kind === 'data') return { title, ...frontmatter }
	return { title, date: today().toISOString().split('T')[0], ...frontmatter }
}

/**
 * What survives the create request.
 *
 * The editor drops empty strings and `undefined` rather than writing them, so a field
 * the user left alone reaches the schema as *absent*, not as `''`. Anything predicting
 * a create has to apply this — the two produce different validation errors, and only
 * one of them is real.
 */
export function omitEmptyOnCreate(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value !== undefined && value !== '') out[key] = value
	}
	return out
}

/** A field carrying a declared type/required flag, as `parseContentConfig` reports it. */
export interface RequiredGuardField {
	name: string
	required: boolean
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
 */
export function blankRequiredFields(fields: RequiredGuardField[], frontmatter: Record<string, unknown>): string[] {
	return fields
		.filter(field => field.required && !field.layout?.hidden && isBlankFieldValue(frontmatter[field.name]))
		.map(field => field.name)
}
