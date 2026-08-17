/**
 * Where the config parser's picture of a field and the live schema's picture disagree.
 *
 * The editor is built from the parser's picture: what it renders, and what it refuses to save,
 * both come from `parseContentConfig`. The build judges by the live schema. Wherever those two
 * disagree the editor is wrong about the project in a way neither side can notice on its own —
 * the config looks fine, the content parses, and the editor still does the wrong thing.
 *
 * Two disagreements are reported here. Both are held to the same standard as the rest of
 * `check.ts`: the evidence comes from asking the schema (see `schema-probe.ts`), never from
 * assuming the parser's silence means anything.
 *
 * Both are limited to top-level fields, because that is the limit of what they can honestly
 * claim. The write guard in `handlers/entry-ops.ts` stops at the top level and the editor's
 * type fallback is decided per top-level field, so a nested finding would name a consequence
 * that does not follow.
 */

import type { CheckFinding } from './check'
import type { LoadedCollections, LoadedEntry } from './check-entries'
import type { ParsedConfig, ParsedField } from './content-config-ast'
import { type LiveSchemas, schemaFor } from './schema-port'
import { acceptsMissing, firstAcceptedEntry, governsPath, pointAt, rejectsValueAt } from './schema-probe'

export interface ShapeCheckInput {
	config: ParsedConfig
	collections: LoadedCollections
	schemas: LiveSchemas
}

/** These findings are about the schema, not about any one entry — `check.ts` names the same file for its config findings. */
const CONFIG_FILE = 'src/content.config.ts'

/**
 * Strings diverse enough that anything still refusing all of them refuses text as a kind.
 *
 * One string proves nothing: `z.string().url()` refuses `'nua'` and is perfectly usable through
 * a text input, so reporting on a single rejection would fire on every constrained string field
 * in the project. A number, a date, a boolean and an enum refuse the whole set.
 */
const TEXT_PROBES = ['', 'nua', 'https://nua.test/probe', '2024-01-02', '123']

/** Whether any entry gives the collection scanner a value to infer this field's type from. */
const anyEntryHasValue = (entries: LoadedEntry[], field: string): boolean =>
	entries.some(entry => entry.frontmatter !== undefined && entry.frontmatter[field] !== undefined)

/**
 * The editor forces a field the build does not need.
 *
 * `blankRequiredFields` refuses to save an entry whose required field is blank, and it takes
 * `required` from the parser. When the schema accepts the record without that key, the editor is
 * blocking an edit the build would have taken.
 *
 * Only this direction is reported. The opposite one — parser says optional, schema insists — has
 * a consequence that `cms/empty-write` states precisely (the create it breaks), and saying it
 * twice under two codes makes one defect look like two.
 */
async function requiredDrift(name: string, field: ParsedField, seed: Record<string, unknown>, schemas: LiveSchemas): Promise<CheckFinding | null> {
	const schema = schemaFor(schemas, name)
	// `blankRequiredFields` skips hidden fields, so an over-strict parser costs nothing there.
	if (!schema || !field.required || field.layout?.hidden) return null

	const point = pointAt(seed, field.name)
	if (!await acceptsMissing(schema, point)) return null
	// Without this, a `passthrough()` object — which accepts the record with any key removed —
	// would put every field it never declared on the report.
	if (!await governsPath(schema, point)) return null

	return {
		severity: 'warning',
		code: 'cms/required-drift',
		file: CONFIG_FILE,
		field: `${name}.${field.name}`,
		message: `The editor treats "${name}.${field.name}" as required and refuses to save it blank, but the schema accepts an entry without it.`,
		hint:
			'Either the schema should require it, or the config should show the parser that it is optional. A field schema reached through an import or an alias hides its `.optional()`/`.default()` from the parser, which then reads the field as required — write the chain inline instead.',
	}
}

/**
 * The editor will render a plain text input for a field that cannot hold text.
 *
 * When the parser pins no type, the collection scanner falls back to whatever it can infer from
 * existing values — and to `'text'` when there are none (`parsedFieldToFieldDefinition`). A text
 * input on a number, a date or an enum writes a string the build refuses, so the first editor to
 * fill that field breaks it.
 *
 * The three guards are what keep this off projects that are fine: a hidden field is never
 * rendered at all (`field-utils.ts`, `entry-create.tsx`, `entry-editor.tsx` all drop it), a field
 * some entry already carries is typed by inference and never falls back, and a schema that takes
 * any of `TEXT_PROBES` is one a text input can serve.
 */
async function degradedField(name: string, field: ParsedField, seed: Record<string, unknown>, input: ShapeCheckInput): Promise<CheckFinding | null> {
	const schema = schemaFor(input.schemas, name)
	if (!schema || field.type !== undefined || field.layout?.hidden) return null
	if (anyEntryHasValue(input.collections.get(name)?.entries ?? [], field.name)) return null

	const point = pointAt(seed, field.name)
	for (const text of TEXT_PROBES) {
		if (!await rejectsValueAt(schema, point, text)) return null
	}

	return {
		severity: 'error',
		code: 'cms/field-degraded',
		file: CONFIG_FILE,
		field: `${name}.${field.name}`,
		message:
			`The editor will render "${name}.${field.name}" as a plain text input — the parser pinned no type and no entry supplies one — and the schema rejects text there.`,
		hint:
			"Write the field's type chain inline in the content config (`n.number()`, `n.date()`, `n.enum([…])`). A type reached through an import, a helper with arguments, or a modifier applied after the object is built is invisible to the parser, which then leaves the editor guessing.",
	}
}

export async function checkFieldShapes(input: ShapeCheckInput): Promise<CheckFinding[]> {
	const findings: CheckFinding[] = []

	// Sequential on purpose: probes resolve at different speeds and the report has to read the same every run.
	for (const [name, collection] of input.config) {
		const schema = schemaFor(input.schemas, name)
		if (!schema || collection.fields.length === 0) continue

		// No accepted entry, no evidence. `cms/empty-write-unchecked` already says so for this
		// collection, and repeating it once per field would bury the findings that mean something.
		const seed = await firstAcceptedEntry(schema, input.collections.get(name)?.entries ?? [])
		if (!seed) continue

		for (const field of collection.fields) {
			const drift = await requiredDrift(name, field, seed, input.schemas)
			if (drift) findings.push(drift)
			const degraded = await degradedField(name, field, seed, input)
			if (degraded) findings.push(degraded)
		}
	}

	return findings
}
