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
 * - **"+ Add" in a repeater** — an object-array field gains a blank item. Nothing guards
 *   this path (`addArrayItem` does not consult the required-field check), so a required
 *   key inside the item is a live break.
 */

import type { CheckFinding } from './check'
import { collectionKind, isPlainObject, type LoadedCollection, type LoadedCollections, type LoadedEntry } from './check-entries'
import type { ParsedConfig, ParsedField } from './content-config-ast'
import { applyCreateRouteFields, blankRequiredFields, newEntryFrontmatter, omitEmptyOnCreate, type WriteModelField } from './editor-write-model'
import { describeIssue, type LiveIssue, type LiveSchema, type LiveSchemas, schemaFor } from './schema-port'

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

/** One rejected write, phrased as the editorial action that causes it. `action` reads as the subject of the sentence. */
function rejectionFinding(action: string, issue: LiveIssue): CheckFinding {
	const { field, message } = describeIssue(issue)
	const finding: CheckFinding = {
		severity: 'error',
		code: 'cms/empty-write',
		file: CONFIG_FILE,
		message: `${action} produces a write the schema rejects. ${message}`,
	}
	if (field !== undefined) finding.field = field
	return finding
}

/** A throw is a verdict too: `astro sync` runs the same schema over the same record and dies the same way. */
const throwFinding = (action: string, threw: string): CheckFinding => ({
	severity: 'error',
	code: 'cms/empty-write',
	file: CONFIG_FILE,
	message: `${action} produces a write the schema throws on: ${threw}`,
})

/**
 * The blank item each editor appends to a repeater — two different writes, both real.
 *
 * `collections-admin` appends `blankValue('object')`, an object with no keys. The in-page
 * editor copies the first item's keys with every value set to `''`, and invents `{ name: '' }`
 * when there is no item to copy (`ArrayOfObjectsField.handleAddItem` in `@nuasite/cms`).
 * "+ Add" is an update, not a create, so `omitEmptyOnCreate` never runs and those `''` really
 * reach disk — which is the failure `{}` alone cannot predict.
 */
function blankItemsFor(current: unknown[]): unknown[] {
	if (current.length === 0) return [{}, { name: '' }]
	const first = current[0]
	// A non-object first item means the in-page repeater is not what renders this field; fall
	// back to the shape the other editor writes rather than inventing a third one.
	const template = isPlainObject(first) ? Object.fromEntries(Object.keys(first).map(key => [key, ''])) : {}
	return [{}, template]
}

/**
 * The first entry the schema already accepts — the record the editor is really sitting on
 * when "+ Add" is clicked.
 *
 * It has to be an accepted one: seeding from a record the schema already rejects would blame
 * the added item for the entry's own pre-existing problems, which `check-live.ts` reports. An
 * entry the schema throws on is not accepted either, and `check-live.ts` reports that too.
 */
async function firstAcceptedFrontmatter(schema: LiveSchema, entries: LoadedEntry[]): Promise<Record<string, unknown> | undefined> {
	for (const entry of entries) {
		if (!entry.frontmatter) continue
		const verdict = await parseWrite(schema, entry.frontmatter)
		if ('issues' in verdict && verdict.issues.length === 0) return entry.frontmatter
	}
	return undefined
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
				report(createKey, rejectionFinding(createAction, issue))
			}
		}

		const repeaters = collection.fields.filter(field => field.type === 'array' && field.itemType === 'object')
		if (repeaters.length === 0) continue

		const seed = await firstAcceptedFrontmatter(schema, entries)

		for (const field of repeaters) {
			const key = `${name} add:${field.name}`
			if (!seed) {
				// A simulation that could not run must never read as a pass.
				const reason = entries.some(entry => entry.frontmatter !== undefined)
					? 'no existing entry passes the schema, so there is no valid record to add an item to'
					: 'the collection has no entry to add an item to'
				report(key, {
					severity: 'warning',
					code: 'cms/empty-write-unchecked',
					file: CONFIG_FILE,
					field: field.name,
					message: `Could not check what "+ Add" on "${name}.${field.name}" writes: ${reason}.`,
				})
				continue
			}

			const current = seed[field.name]
			const existing: unknown[] = Array.isArray(current) ? current : []
			const action = `Clicking "+ Add" on "${name}.${field.name}"`
			// Both shapes are the same user action, so the dedup key is too: where they fail
			// identically the report says it once — in the words of the keyless item, which is
			// simulated first — and a failure only one of them causes still names "+ Add".
			for (const item of blankItemsFor(existing)) {
				const verdict = await parseWrite(schema, { ...seed, [field.name]: [...existing, item] })
				if ('threw' in verdict) {
					report(key, throwFinding(action, verdict.threw))
					continue
				}
				for (const issue of verdict.issues) report(key, rejectionFinding(action, issue))
			}
		}
	}

	return findings
}
