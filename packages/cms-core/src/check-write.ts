/**
 * Predict the writes the editor is about to make, and whether the schema will take them.
 *
 * Everything else here validates content that already exists. This runs before the mistake:
 * it builds the exact frontmatter the CMS would write for an editorial action and parses it
 * against the live schema. A rejection is a build that will break the next time someone
 * performs that action — not a guess, since the write shape comes from
 * `editor-write-model.ts`, which the editor itself uses.
 *
 * Two actions are simulated:
 *
 * - **new entry** — `newEntryFrontmatter` then `omitEmptyOnCreate`, then the keys the create
 *   route itself injects (`applyCreateRouteFields`). Note what this means: a field left empty
 *   arrives *absent*, not as `''`, so the failure to look for is a missing required value.
 *   Where `blankRequiredFields` says the write guard in `handlers/entry-ops.ts` would reject
 *   the create before it reaches disk, there is no finding to make — with the exception of
 *   `hidden` fields, which that guard skips.
 * - **"+ Add" in a repeater** — an object-array field gains an item built by `newRepeaterItem`,
 *   which seeds the keys the config declares required and omits the rest. What survives is a
 *   required key the config does not know about: `addArrayItem` seeds from the same config the
 *   editor renders from, so neither can supply a key neither can see.
 */

import type { CheckFinding } from './check'
import { collectionKind, isPlainObject, type LoadedCollection, type LoadedCollections, type LoadedEntry } from './check-entries'
import type { ParsedConfig, ParsedField } from './content-config-ast'
import {
	applyCreateRouteFields,
	blankRequiredFields,
	newEntryFrontmatter,
	newRepeaterItem,
	omitEmptyOnCreate,
	type WriteModelField,
} from './editor-write-model'
import { describeIssue, type LiveIssue, type LiveSchema, type LiveSchemas, schemaFor } from './schema-port'
import { firstAcceptedEntry } from './schema-probe'

export interface WriteCheckInput {
	config: ParsedConfig
	collections: LoadedCollections
	schemas: LiveSchemas
	/** Injected so a date-defaulted field does not make the report depend on the day it ran. */
	today?: () => Date
}

/** These findings are about the schema, not about any one entry — `check.ts` names the same file for its config findings. */
const CONFIG_FILE = 'src/content.config.ts'

/** `parseContentConfig` reports `hidden` under `layout`; the write model wants it at the top level. */
const toWriteModelField = (field: ParsedField): WriteModelField => ({ name: field.name, type: field.type, hidden: field.layout?.hidden })

/** What a simulated write got back: the schema's verdict, or the error it threw instead of returning one. */
type WriteVerdict = { issues: LiveIssue[] } | { threw: string }

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function parseWrite(schema: LiveSchema, value: unknown): Promise<WriteVerdict> {
	try {
		const result = await schema.safeParse(value)
		return { issues: result.success ? [] : result.issues }
	} catch (error) {
		// A refinement that dereferences a field this simulation deliberately omits throws
		// rather than returning issues. One project doing that must not cost the whole report.
		return { threw: errorText(error) }
	}
}

/** Which editorial action a rejection came from — the two have different remedies, so the hint has to know. */
type WriteAction = 'create' | 'add'

/**
 * The value the simulated write carries at `path`, if it carries one.
 *
 * The remedy hinges entirely on this. A key the write omits is fixed by making the schema
 * accept its absence; a key the write fills with a value the schema refuses cannot be, and
 * suggesting `.optional()` there would send the reader down a dead end. Reading the record we
 * actually parsed is what tells the two apart — the issue's own code cannot, since a rejected
 * `''` and a missing key both arrive as `invalid_type`.
 */
function valueAt(record: unknown, path: (string | number)[]): { present: false } | { present: true; value: unknown } {
	let current: unknown = record
	for (const segment of path) {
		if (Array.isArray(current)) {
			const index = typeof segment === 'number' ? segment : Number(segment)
			if (!Number.isInteger(index) || index < 0 || index >= current.length) return { present: false }
			current = current[index]
			continue
		}
		if (!isPlainObject(current) || !Object.hasOwn(current, String(segment))) return { present: false }
		current = current[String(segment)]
	}
	return current === undefined ? { present: false } : { present: true, value: current }
}

/**
 * What to change, given which action wrote the value and whether it wrote one at all.
 *
 * `.nullable()` is called out by name in both absent cases because it is the wrong answer that
 * looks right: it accepts `null`, the editor writes no key at all, and the check keeps failing.
 */
function hintFor(action: WriteAction, found: ReturnType<typeof valueAt>): string {
	if (action === 'create') {
		if (!found.present) {
			return 'The create form leaves an untouched field out of the write entirely. `.optional()` or `.default(…)` accepts a missing key; `.nullable()` does not — it accepts `null`, not absence.'
		}
		return `The create form starts this field at ${
			JSON.stringify(found.value)
		} and nothing makes the editor change it before saving. Either the schema accepts that value, or mark the field \`hidden\` so the write omits it and let \`.default(…)\` supply one.`
	}
	if (!found.present) {
		return 'The appended item does not carry this key — "+ Add" seeds only the item fields the config declares required. Declaring it required there is what makes the editor seed it; if it is not required, `.optional()` or `.default(…)` says so to the schema, and `.nullable()` does not — it accepts `null`, not absence.'
	}
	return `The appended item carries ${
		JSON.stringify(found.value)
	} for this key, and it is written the moment "+ Add" is clicked. \`.default(…)\` on the inner field is the way out: the parser then reads the field as optional, so the item leaves the key out and the schema supplies the value itself.`
}

/** One rejected write, phrased as the editorial action that causes it. `action` reads as the subject of the sentence. */
function rejectionFinding(action: string, issue: LiveIssue, kind: WriteAction, written: Record<string, unknown>): CheckFinding {
	const { field, message } = describeIssue(issue)
	const finding: CheckFinding = {
		severity: 'error',
		code: 'cms/empty-write',
		file: CONFIG_FILE,
		message: `${action} produces a write the schema rejects. ${message}`,
	}
	if (field !== undefined) finding.field = field
	finding.hint = hintFor(kind, valueAt(written, issue.path))
	return finding
}

/** A throw is a verdict too: `astro sync` runs the same schema over the same record and dies the same way. */
const throwFinding = (action: string, threw: string): CheckFinding => ({
	severity: 'error',
	code: 'cms/empty-write',
	file: CONFIG_FILE,
	message: `${action} produces a write the schema throws on: ${threw}`,
	hint:
		'A schema that throws instead of returning an issue is usually a refinement reading a field this write does not carry. Guard it against a missing value — `astro sync` runs the same schema over the same record.',
})

/**
 * The item "+ Add" appends to a repeater.
 *
 * Where the schema declares the item's fields, both the editor and `addArrayItem` build it with
 * `newRepeaterItem` — required keys seeded, optional ones omitted — so there is one shape to
 * predict and it comes from the same function the editors call.
 *
 * Where the schema declares nothing, the editors have nothing to build from and fall back to
 * what they can see: `collections-admin` appends an object with no keys, and the in-page editor
 * copies the first item's keys with every value set to `''`, inventing `{ name: '' }` when there
 * is no item to copy (`ArrayOfObjectsField.handleAddItem` in `@nuasite/cms`). "+ Add" is an
 * update, not a create, so `omitEmptyOnCreate` never runs and those `''` really reach disk —
 * which is the failure `{}` alone cannot predict.
 */
function blankItemsFor(field: ParsedField, current: unknown[], today?: () => Date): unknown[] {
	const itemFields = field.fields ?? []
	if (itemFields.length > 0) {
		return [newRepeaterItem(itemFields.map(item => ({ ...toWriteModelField(item), required: item.required })), today)]
	}
	if (current.length === 0) return [{}, { name: '' }]
	const first = current[0]
	// A non-object first item means the in-page repeater is not what renders this field; fall
	// back to the shape the other editor writes rather than inventing a third one.
	const template = isPlainObject(first) ? Object.fromEntries(Object.keys(first).map(key => [key, ''])) : {}
	return [{}, template]
}

export async function checkEditorWrites(input: WriteCheckInput): Promise<CheckFinding[]> {
	const findings: CheckFinding[] = []
	const seen = new Set<string>()

	/** `key` identifies the collection and the action; a union schema can report one path twice. */
	const report = (key: string, finding: CheckFinding): void => {
		const identity = `${key} ${finding.field ?? ''}`
		if (seen.has(identity)) return
		seen.add(identity)
		findings.push(finding)
	}

	// Sequential on purpose: schemas resolve at different speeds and the report has to read the same every run.
	for (const [name, collection] of input.config) {
		const schema = schemaFor(input.schemas, name)
		if (!schema) continue

		const createKey = `${name} create`

		// A schema the config AST could not read leaves the collection with no fields, so the
		// simulated create would pre-fill nothing and suppress nothing — every required key the
		// live schema declares would light up on a project that is fine. Say so instead.
		if (collection.fields.length === 0) {
			report(createKey, {
				severity: 'warning',
				code: 'cms/empty-write-unchecked',
				file: CONFIG_FILE,
				field: name,
				message:
					`Could not check what creating a new entry in "${name}" writes: its schema is not readable from the content config, so there are no fields to predict the write from.`,
				hint:
					'Write the field types inline in the content config rather than importing the shape from another module — the prediction reads the config source, and a schema assembled elsewhere leaves it nothing to read.',
			})
			continue
		}

		const loaded: LoadedCollection | undefined = input.collections.get(name)
		const entries = loaded?.entries ?? []
		const kind = loaded ? collectionKind(loaded, collection.loaderPattern) : 'markdown'

		// The route's own keys go on last, because it spreads the form's frontmatter over them.
		const created = applyCreateRouteFields(
			omitEmptyOnCreate(newEntryFrontmatter(collection.fields.map(toWriteModelField), input.today)),
			kind,
			input.today,
		)
		// What the write guard in `handlers/entry-ops.ts` rejects never reaches disk, so it is
		// nothing to report. The guard runs inside `createEntry`, i.e. on this same record — and
		// it skips `hidden` fields, which is why `blankRequiredFields` never lists one and why a
		// hidden required field survives to below.
		const guarded = new Set(blankRequiredFields(collection.fields, created))

		const createAction = `Creating a new entry in "${name}"`
		const createVerdict = await parseWrite(schema, created)
		if ('threw' in createVerdict) {
			report(createKey, throwFinding(createAction, createVerdict.threw))
		} else {
			for (const issue of createVerdict.issues) {
				const top = issue.path[0]
				if (typeof top === 'string' && guarded.has(top)) continue
				report(createKey, rejectionFinding(createAction, issue, 'create', created))
			}
		}

		const repeaters = collection.fields.filter(field => field.type === 'array' && field.itemType === 'object')
		if (repeaters.length === 0) continue

		// The record the editor is really sitting on when "+ Add" is clicked. Shared with the shape
		// rules so both mean the same thing by it.
		const seed = await firstAcceptedEntry(schema, entries)

		for (const field of repeaters) {
			const key = `${name} add:${field.name}`
			if (!seed) {
				// A simulation that could not run must never read as a pass.
				const hasEntries = entries.some(entry => entry.frontmatter !== undefined)
				const reason = hasEntries
					? 'no existing entry passes the schema, so there is no valid record to add an item to'
					: 'the collection has no entry to add an item to'
				report(key, {
					severity: 'warning',
					code: 'cms/empty-write-unchecked',
					file: CONFIG_FILE,
					field: field.name,
					message: `Could not check what "+ Add" on "${name}.${field.name}" writes: ${reason}.`,
					hint: hasEntries
						? `Fix the \`entry/schema-rejected\` findings in "${name}" and run this again — the prediction needs one entry the schema accepts.`
						: `Add one entry to "${name}" and run this again.`,
				})
				continue
			}

			const current = seed[field.name]
			const existing: unknown[] = Array.isArray(current) ? current : []
			const action = `Clicking "+ Add" on "${name}.${field.name}"`
			// Both shapes are the same user action, so the dedup key is too: where they fail
			// identically the report says it once — in the words of the keyless item, which is
			// simulated first — and a failure only one of them causes still names "+ Add".
			for (const item of blankItemsFor(field, existing, input.today)) {
				const written = { ...seed, [field.name]: [...existing, item] }
				const verdict = await parseWrite(schema, written)
				if ('threw' in verdict) {
					report(key, throwFinding(action, verdict.threw))
					continue
				}
				for (const issue of verdict.issues) report(key, rejectionFinding(action, issue, 'add', written))
			}
		}
	}

	return findings
}
