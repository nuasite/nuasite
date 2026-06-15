/**
 * Pure draft model + field coercion for the entry editor (cms-headless F3.2).
 *
 * The sidecar speaks two slightly different frontmatter shapes:
 *  - `GET …/entries/:slug` returns `frontmatter: Record<string, { value: string; line: number }>`,
 *    where `value` is already stringified (objects/arrays are JSON).
 *  - `PATCH …` accepts `frontmatter?: Record<string, unknown>` of *native* values (merged), and a
 *    `409` `serverFrontmatter` is likewise native (not stringified).
 *
 * The editor works on a single native draft (`EntryDraft`): `frontmatter` is a
 * `Record<string, unknown>` of native JS values keyed by field name, plus the
 * markdown `body`. This module converts to/from the wire and coerces raw input
 * (form strings) into the native value a `FieldType` expects. Keeping it pure
 * (no React/DOM) makes the mapping unit-testable.
 */

import type { CollectionEntry, FieldDefinition, FieldType } from '@nuasite/cms-types'

/** The editor's in-memory state: native frontmatter values + the markdown body. */
export interface EntryDraft {
	frontmatter: Record<string, unknown>
	body: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse one stringified frontmatter `value` (from `GET …/entries/:slug`) into the
 * native value a field of `type` expects. Structural types (object/array) and
 * unknowns fall back to a best-effort `JSON.parse`; scalars are coerced per type.
 */
export function parseWireValue(type: FieldType, raw: string): unknown {
	switch (type) {
		case 'boolean':
			return raw === 'true' || raw === '1' || raw.toLowerCase() === 'yes'
		case 'number':
		case 'year':
		case 'month': {
			const n = Number(raw)
			return raw.trim() === '' || Number.isNaN(n) ? raw : n
		}
		case 'date':
		case 'datetime':
		case 'time':
			// The sidecar JSON-stringifies non-string frontmatter, so a YAML `Date` arrives
			// double-quoted (e.g. `"2026-06-01T12:00:00.000Z"`). Unwrap it to a plain string;
			// a value already stored as a string (e.g. `2026-06-01`) passes through unchanged.
			return parseJsonLoose(raw)
		case 'array':
		case 'object':
			return parseJsonLoose(raw)
		default:
			return raw
	}
}

/** `JSON.parse` for structural values, falling back to the raw string when invalid. */
function parseJsonLoose(raw: string): unknown {
	const trimmed = raw.trim()
	if (trimmed === '') return undefined
	if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) return raw
	try {
		return JSON.parse(trimmed)
	} catch {
		return raw
	}
}

/**
 * Build a native draft from a loaded entry, driven by the collection's fields.
 * Frontmatter keys present on the entry but absent from the inferred schema are
 * preserved verbatim (as raw strings) so a save never silently drops them.
 */
export function draftFromEntry(entry: CollectionEntry, fields: FieldDefinition[]): EntryDraft {
	const byName = new Map(fields.map(f => [f.name, f] as const))
	const frontmatter: Record<string, unknown> = {}
	for (const [key, cell] of Object.entries(entry.frontmatter)) {
		const field = byName.get(key)
		frontmatter[key] = field ? parseWireValue(field.type, cell.value) : cell.value
	}
	return { frontmatter, body: entry.body }
}

/**
 * Build a fresh draft for a create form from the collection's fields, seeding
 * each field with its `defaultValue` (when present) or a type-appropriate blank.
 */
export function draftForCreate(fields: FieldDefinition[]): EntryDraft {
	const frontmatter: Record<string, unknown> = {}
	for (const field of fields) {
		if (field.hidden) continue
		if (field.defaultValue !== undefined) {
			frontmatter[field.name] = field.defaultValue
			continue
		}
		frontmatter[field.name] = blankValue(field.type)
	}
	return { frontmatter, body: '' }
}

/** A type-appropriate empty value used to seed create forms. */
export function blankValue(type: FieldType): unknown {
	switch (type) {
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
			// Seed temporal fields empty (not ''), so an untouched optional date is omitted on
			// create instead of writing `date: ''` (which `z.coerce.date()` rejects as invalid).
			return undefined
		default:
			return ''
	}
}

/**
 * Adopt a server-provided native frontmatter map (from a `409` `serverFrontmatter`)
 * into a draft, re-coercing per field where a definition exists.
 */
export function draftFromServerFrontmatter(
	serverFrontmatter: Record<string, unknown>,
	serverBody: string | undefined,
	fields: FieldDefinition[],
): EntryDraft {
	const byName = new Map(fields.map(f => [f.name, f] as const))
	const frontmatter: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(serverFrontmatter)) {
		const field = byName.get(key)
		// Server values are already native; only re-coerce when the value arrived as
		// a string for a numeric/boolean field (e.g. YAML quirks).
		frontmatter[key] = field && typeof value === 'string' ? parseWireValue(field.type, value) : value
	}
	return { frontmatter, body: serverBody ?? '' }
}

/**
 * Coerce a raw form-control string into the native value a field expects. Used by
 * the widgets, whose `<input>` values are always strings.
 */
export function coerceInput(type: FieldType, raw: string): unknown {
	switch (type) {
		case 'boolean':
			return raw === 'true'
		case 'number': {
			if (raw.trim() === '') return undefined
			const n = Number(raw)
			return Number.isNaN(n) ? raw : n
		}
		case 'year':
		case 'month': {
			if (raw.trim() === '') return undefined
			const n = Number(raw)
			return Number.isNaN(n) ? raw : n
		}
		case 'date':
		case 'datetime':
		case 'time':
			// Empty → undefined so a cleared optional date is omitted rather than written as
			// `''` (which `z.coerce.date()` turns into an Invalid Date and rejects).
			return raw.trim() === '' ? undefined : raw
		default:
			return raw
	}
}

/** Render a native value back to a string for a text/number/date/select control. */
export function valueToInput(value: unknown): string {
	if (value === undefined || value === null) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	return JSON.stringify(value)
}

/**
 * Render a stored temporal value for a native date/time `<input>`, which only accept a
 * strict format (`yyyy-MM-dd`, `yyyy-MM-ddTHH:mm`, `HH:mm`, `yyyy-MM`). Accepts a `Date`,
 * an ISO-ish string (with or without a time/zone), a plain `yyyy-MM-dd`, or a `HH:mm` time.
 * Returns '' when the value is empty or unparseable so the control renders blank — never
 * the raw out-of-format value, which the browser would silently reject (showing an empty
 * field that then overwrites the stored value with '' on save).
 */
export function valueToDateInput(value: unknown, type: FieldType): string {
	if (value === undefined || value === null || value === '') return ''

	// Prefer slicing a canonical ISO string directly: parsing a date-only or UTC-midnight
	// value into a local `Date` can roll the day back across timezones.
	if (typeof value === 'string') {
		const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
		if (iso) {
			const [, y, mo, d, h, mi] = iso
			switch (type) {
				case 'datetime':
					return `${y}-${mo}-${d}T${h ?? '00'}:${mi ?? '00'}`
				case 'time':
					return h ? `${h}:${mi}` : ''
				case 'month':
					return `${y}-${mo}`
				default:
					return `${y}-${mo}-${d}`
			}
		}
		if (type === 'time') {
			const t = value.trim().match(/^(\d{2}):(\d{2})/)
			if (t) return `${t[1]}:${t[2]}`
		}
	}

	const date = value instanceof Date ? value : new Date(String(value))
	if (Number.isNaN(date.getTime())) return ''
	const pad = (n: number) => String(n).padStart(2, '0')
	const y = date.getFullYear()
	const mo = pad(date.getMonth() + 1)
	const d = pad(date.getDate())
	const h = pad(date.getHours())
	const mi = pad(date.getMinutes())
	switch (type) {
		case 'datetime':
			return `${y}-${mo}-${d}T${h}:${mi}`
		case 'time':
			return `${h}:${mi}`
		case 'month':
			return `${y}-${mo}`
		default:
			return `${y}-${mo}-${d}`
	}
}

/** Read a value as a boolean for toggle widgets, tolerating string encodings. */
export function valueToBoolean(value: unknown): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'string') return value === 'true' || value === '1' || value.toLowerCase() === 'yes'
	return Boolean(value)
}

/** Read a value as an array of items for repeater widgets. */
export function valueToArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

/** Read a value as an object for nested-group widgets. */
export function valueToObject(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

/** Immutably set a top-level frontmatter key in a draft. */
export function setDraftField(draft: EntryDraft, name: string, value: unknown): EntryDraft {
	return { ...draft, frontmatter: { ...draft.frontmatter, [name]: value } }
}
