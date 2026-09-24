/**
 * What the editor actually writes when it creates an entry — the create-route half.
 *
 * The value rules underneath (what a blank field holds, which keys a repeater item carries,
 * which required fields count as unfilled) live in `@nuasite/cms-types` so that every editor
 * can reach them: `collections-admin` and webmaster's own collections panel depend on
 * `cms-client`, which is a sibling of this package, not a consumer. They are re-exported here
 * because the create pipeline reads as one thing.
 *
 * What stays is what only makes sense next to the create route: the form's starting
 * frontmatter, the empty filter the request applies, and the keys the route injects.
 *
 * A check built on a second, drifted copy of any of this reports failures that cannot happen
 * and misses the ones that can — which is why none of it may be reimplemented anywhere.
 */

import { blankFieldValue, type WriteModelField } from '@nuasite/cms-types'
import { isPlainRecord } from './shared'

export {
	blankFieldValue,
	blankRequiredFields,
	ENTRY_SLUG_FIELD,
	isBlankFieldValue,
	newRepeaterItem,
	type RepeaterItemField,
	type RequiredGuardField,
	seedValueForRequiredField,
	type SlugMirrorField,
	withEntrySlug,
	withoutBlankArrayItems,
	withRenamedEntrySlug,
	type WriteModelField,
} from '@nuasite/cms-types'

/**
 * The frontmatter the editor holds when "create entry" opens, before the user types.
 *
 * `title` is excluded because the create form carries it in its own header field, and
 * hidden fields are excluded because the form cannot fill them in. Neither is missing from
 * the finished entry — see `applyCreateRouteFields`, which is what puts `title` back.
 *
 * The values come from `blankFieldValue`, the same function `draftForCreate` in `cms-client`
 * asks. The two used to seed differently, so this — and the check built on it — described a
 * write only one of the two editors ever made.
 */
export function newEntryFrontmatter(fields: WriteModelField[]): Record<string, unknown> {
	const frontmatter: Record<string, unknown> = {}
	for (const field of fields) {
		if (field.name === 'title' || field.hidden) continue
		frontmatter[field.name] = blankFieldValue(field)
	}
	return frontmatter
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

/** A field as `normalizeCreateWrite` reads it — satisfied by `ParsedField`. */
export interface CreateWriteField {
	name: string
	required: boolean
	fields?: CreateWriteField[]
}

/**
 * What the create route writes of the frontmatter it receives, whichever editor sent it.
 *
 * Every create form seeds from `blankFieldValue`, so an untouched text field arrives as `''` and
 * an untouched object as `{}`, and not every editor filters them out (`omitEmptyOnCreate` is the
 * in-page editor's). An untouched optional object written as `{}` is rejected by a schema that
 * requires any of its members, and Astro then fails the build for the whole collection.
 *
 * So `''` and `undefined` are dropped at every depth, and an object left with nothing in it is
 * dropped too — unless the schema requires it, in which case it stays `{}` for
 * `blankRequiredFields` to refuse by name. Applied in `createEntry`, and by the content check,
 * which predicts the same write.
 */
export function normalizeCreateWrite(fields: CreateWriteField[], frontmatter: Record<string, unknown>): Record<string, unknown> {
	const byName = new Map(fields.map(field => [field.name, field]))
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === '') continue
		const field = byName.get(key)
		if (!isPlainRecord(value)) {
			out[key] = value
			continue
		}
		const members = normalizeCreateWrite(field?.fields ?? [], value)
		if (Object.keys(members).length === 0 && !field?.required) continue
		out[key] = members
	}
	return out
}
