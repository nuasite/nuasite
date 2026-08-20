import {
	checkEditorWrites,
	type LiveIssue,
	type LiveSchema,
	type LiveSchemas,
	type LoadedCollections,
	type LoadedEntry,
	type ParsedConfig,
	type ParsedField,
	type WriteCheckInput,
} from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A hand-written stand-in for a compiled zod schema.
 *
 * Deliberately fake: this file pins down which writes the checker predicts and which verdicts
 * it suppresses, not what zod produces. Running the real thing is the CLI's job, covered there.
 */
const schemaOf = (rule: (value: unknown) => LiveIssue[]): LiveSchema => ({
	safeParse: async value => {
		const issues = rule(value)
		return issues.length === 0 ? { success: true } : { success: false, issues }
	},
})

const accepts = (): LiveSchema => schemaOf(() => [])

/** A schema that throws instead of returning a verdict — what a refinement dereferencing an absent field does. */
const throwsWhen = (predicate: (value: unknown) => boolean): LiveSchema => ({
	safeParse: async value => {
		if (predicate(value)) throw new TypeError('undefined is not an object')
		return { success: true }
	},
})

const itemCount = (value: unknown): number => (isRecord(value) && Array.isArray(value.stats) ? value.stats.length : 0)

/** Rejects a record missing any of `keys`, the way a required zod field does. */
const requires = (...keys: string[]): LiveSchema =>
	schemaOf(value => keys.filter(key => !isRecord(value) || value[key] === undefined).map(key => ({ path: [key], message: 'Required' })))

/** Judges every item of `field` the way a zod object inside a repeater does. */
const itemsJudgedBy = (field: string, rule: (item: unknown) => Array<{ key: string; message: string }>): LiveSchema =>
	schemaOf(value => {
		const raw = isRecord(value) ? value[field] : undefined
		const items: unknown[] = Array.isArray(raw) ? raw : []
		return items.flatMap((item, index) => rule(item).map(({ key, message }) => ({ path: [field, index, key], message })))
	})

/** Rejects every item of `field` that has no `key`, the way a required key inside a repeater item does. */
const requiresInItems = (field: string, key: string): LiveSchema =>
	itemsJudgedBy(field, item => (isRecord(item) && item[key] !== undefined ? [] : [{ key, message: 'Required' }]))

const fieldOf = (name: string, extra: Partial<ParsedField> = {}): ParsedField => ({ name, required: true, ...extra })

const repeaterField = (name: string): ParsedField => fieldOf(name, { type: 'array', itemType: 'object', required: false })

const entryOf = (file: string, frontmatter: Record<string, unknown>): LoadedEntry => ({
	file,
	stem: file.replace(/^.*\//, '').replace(/\.md$/, ''),
	frontmatter,
})

interface CollectionSpec {
	fields: ParsedField[]
	entries?: LoadedEntry[]
}

const inputOf = (collections: Record<string, CollectionSpec>, schemas: LiveSchemas, today?: () => Date): WriteCheckInput => {
	const config: ParsedConfig = new Map()
	const loaded: LoadedCollections = new Map()
	for (const [name, spec] of Object.entries(collections)) {
		config.set(name, { name, fields: spec.fields, loaderBase: `./src/content/${name}` })
		loaded.set(name, { name, base: `src/content/${name}`, exists: true, entries: spec.entries ?? [] })
	}
	return { config, collections: loaded, schemas, today }
}

/**
 * The remedies the findings carry, pinned by name.
 *
 * Which one a finding gets is the load-bearing part: `.optional()` fixes a key the write omits
 * and does nothing for a key it fills with a rejected value, so a hint attached to the wrong
 * case sends the reader down a dead end more confidently than no hint at all.
 */
const ABSENT_ON_CREATE =
	'The create form leaves an untouched field out of the write entirely. `.optional()` or `.default(…)` accepts a missing key; `.nullable()` does not — it accepts `null`, not absence.'
const ABSENT_ON_ADD =
	'The appended item does not carry this key — "+ Add" seeds only the item fields the config declares required. Declaring it required there is what makes the editor seed it; if it is not required, `.optional()` or `.default(…)` says so to the schema, and `.nullable()` does not — it accepts `null`, not absence.'
const THROWN =
	'A schema that throws instead of returning an issue is usually a refinement reading a field this write does not carry. Guard it against a missing value — `astro sync` runs the same schema over the same record.'

// Every other rule here judges content that already exists. This one runs before the mistake:
// it predicts the editor's next write and asks the real schema whether it would take it.
describe('checkEditorWrites', () => {
	test('"+ Add" on a repeater whose items need a key is an error, appended after the seed\'s items', async () => {
		const input = inputOf(
			{
				people: {
					fields: [fieldOf('name'), repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { name: 'Ada', stats: [{ label: 'Age' }] })],
				},
			},
			{ people: requiresInItems('stats', 'label') },
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'error',
			code: 'cms/empty-write',
			file: 'src/content.config.ts',
			field: 'stats.1.label',
			message: 'Clicking "+ Add" on "people.stats" produces a write the schema rejects. stats.1.label: Required',
			hint: ABSENT_ON_ADD,
		}])
	})

	/**
	 * A list of scalars was invisible to this rule until it broke a production site.
	 *
	 * `z.array(reference('tags'))` parses to a `reference` with `isArray` — no `type`, no
	 * `itemType` — so a filter keyed on `type === 'array' && itemType === 'object'` skipped it
	 * entirely, and "+ Add" on a tags list went unpredicted.
	 */
	test('"+ Add" on a list of references is simulated, and the blank item it appends is dropped before the write', async () => {
		const input = inputOf(
			{
				articles: {
					fields: [fieldOf('title'), fieldOf('tags', { required: false, reference: { target: 'tags', isArray: true } })],
					entries: [entryOf('src/content/articles/ada.md', { title: 'Ada', tags: ['komentar'] })],
				},
			},
			{
				articles: schemaOf(value => {
					const tags: unknown[] = isRecord(value) && Array.isArray(value.tags) ? value.tags : []
					return tags.flatMap((tag, index) =>
						typeof tag === 'string' ? [] : [{ path: ['tags', index], message: `Invalid input: expected string, received ${String(tag)}` }]
					)
				}),
			},
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// The other half: the simulation really runs, rather than passing because it skipped the field.
	// A boolean item is not blank, so it survives to the schema and a rejection is reported.
	test('"+ Add" on a list whose item value the schema refuses is an error', async () => {
		const input = inputOf(
			{
				articles: {
					fields: [fieldOf('title'), fieldOf('flags', { required: false, type: 'array', itemType: 'boolean' })],
					entries: [entryOf('src/content/articles/ada.md', { title: 'Ada', flags: [true] })],
				},
			},
			{
				articles: schemaOf(value => {
					const flags: unknown[] = isRecord(value) && Array.isArray(value.flags) ? value.flags : []
					return flags.flatMap((flag, index) => (flag === false ? [{ path: ['flags', index], message: 'Invalid input: expected true' }] : []))
				}),
			},
		)

		expect((await checkEditorWrites(input)).map(finding => finding.message)).toEqual([
			'Clicking "+ Add" on "articles.flags" produces a write the schema rejects. flags.1: Invalid input: expected true',
		])
	})

	// The write guard in `handlers/entry-ops.ts` rejects this create before it reaches disk,
	// so there is no build to break and nothing worth reporting.
	test('a new-entry rejection the write guard would already block is suppressed', async () => {
		const input = inputOf({ people: { fields: [fieldOf('name')] } }, { people: requires('name') })

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// …but that guard skips hidden fields, so nothing stops this one from reaching disk. The field
	// is typed on purpose: an untyped one defaults to '' and is dropped anyway, which would let
	// the simulation forget `hidden` entirely and still look right.
	test('the same rejection on a hidden required field is reported', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('order', { type: 'number', layout: { hidden: true } })] } },
			{ people: requires('order') },
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'error',
			code: 'cms/empty-write',
			file: 'src/content.config.ts',
			field: 'order',
			message: 'Creating a new entry in "people" produces a write the schema rejects. order: Required',
			hint: ABSENT_ON_CREATE,
		}])
	})

	// The other half of the hint's job. A boolean pre-fills with `false`, which survives the empty
	// filter, so the key is present and `.optional()` is the wrong answer — the remedy has to be
	// the other one. A number no longer qualifies: `blankFieldValue` leaves it unset precisely so
	// that a schema asking for `>= 1` is not handed a `0`.
	test('a rejected value the create form does write gets the remedy for a present key, not for a missing one', async () => {
		const input = inputOf(
			{ team: { fields: [fieldOf('published', { type: 'boolean', required: false })] } },
			{
				team: schemaOf(value => isRecord(value) && value.published === false ? [{ path: ['published'], message: 'Invalid input: expected true' }] : []),
			},
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'error',
			code: 'cms/empty-write',
			file: 'src/content.config.ts',
			field: 'published',
			message: 'Creating a new entry in "team" produces a write the schema rejects. published: Invalid input: expected true',
			hint:
				'The create form starts this field at false and nothing makes the editor change it before saving. Either the schema accepts that value, or mark the field `hidden` so the write omits it and let `.default(…)` supply one.',
		}])
	})

	// The counterpart, and the reason the create rule differs from the repeater's: a number the
	// user never touched must arrive absent, so a schema with a floor never sees a seeded `0`.
	test('a number the create form leaves alone is omitted, not written as 0', async () => {
		const input = inputOf(
			{ team: { fields: [fieldOf('order', { type: 'number', required: false })] } },
			{
				team: schemaOf(value =>
					isRecord(value) && typeof value.order === 'number' && value.order < 1
						? [{ path: ['order'], message: 'Too small: expected number to be >=1' }]
						: []
				),
			},
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// A field the user never touched arrives absent, not as ''. The two produce different
	// verdicts and only the absent one is real — this is the whole reason the create is
	// simulated through the write model instead of being read off the form.
	test('an untouched optional field reaches the schema absent, not as an empty string', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('website', { type: 'url', required: false })] } },
			{ people: schemaOf(value => (isRecord(value) && value.website === '' ? [{ path: ['website'], message: 'Invalid url' }] : [])) },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// The create route writes `{ title, date, ...frontmatter }` for a markdown collection, so an
	// auto-managed hidden date is filled in by the server and is not the editor's problem.
	test('a hidden date the create route injects is not reported for a markdown collection', async () => {
		const input = inputOf(
			{
				people: {
					fields: [fieldOf('date', { type: 'date', layout: { hidden: true } })],
					entries: [entryOf('src/content/people/ada.md', { date: '2020-01-02' })],
				},
			},
			{ people: requires('date') },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// …but the data branch of that route writes the frontmatter verbatim, so there the same
	// hidden field really is missing.
	test('the same hidden date is reported for a data collection, which the route leaves alone', async () => {
		const input = inputOf(
			{
				settings: {
					fields: [fieldOf('date', { type: 'date', layout: { hidden: true } })],
					entries: [entryOf('src/content/settings/site.json', { date: '2020-01-02' })],
				},
			},
			{ settings: requires('date') },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.field)).toEqual(['date'])
	})

	// The title comes from the create form's own header, so the schema never sees it missing —
	// even for a collection whose config declares no title field to suppress the finding by.
	test('the title the create route injects is not reported as missing', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('name', { required: false })] } },
			{ people: requires('title') },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// `check.ts` and the CLI both call this outside any try: one project-side refinement that
	// dereferences a field the simulated create omits would otherwise lose the whole report.
	test('a schema that throws on the simulated create becomes a finding, not an unhandled rejection', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('slug', { required: false })] } },
			{ people: throwsWhen(value => !isRecord(value) || value.slug === undefined) },
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'error',
			code: 'cms/empty-write',
			file: 'src/content.config.ts',
			message: 'Creating a new entry in "people" produces a write the schema throws on: undefined is not an object',
			hint: THROWN,
		}])
	})

	test('a schema that throws on the simulated "+ Add" becomes a finding', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ label: 'Age' }] })],
				},
			},
			{ people: throwsWhen(value => itemCount(value) > 1) },
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'error',
			code: 'cms/empty-write',
			file: 'src/content.config.ts',
			message: 'Clicking "+ Add" on "people.stats" produces a write the schema throws on: undefined is not an object',
			hint: THROWN,
		}])
	})

	test('an entry the schema throws on is not taken as a seed, and does not take the run down', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ label: 'Age' }] })],
				},
			},
			{ people: throwsWhen(value => itemCount(value) > 0) },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.code)).toEqual(['cms/empty-write-unchecked'])
	})

	// The original production bug: an optional field the editor filled with '' took the build down.
	// `{}` cannot predict it — only the item template the in-page editor copies from the first item can.
	test('"+ Add" is also simulated as the in-page editor writes it: the first item\'s keys, blanked', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ order: 1 }] })],
				},
			},
			// `order` is optional, so a keyless item is fine — but '' is not a number.
			{
				people: itemsJudgedBy(
					'stats',
					item => (isRecord(item) && item.order === '' ? [{ key: 'order', message: 'Expected number, received string' }] : []),
				),
			},
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'error',
			code: 'cms/empty-write',
			file: 'src/content.config.ts',
			field: 'stats.1.order',
			message: 'Clicking "+ Add" on "people.stats" produces a write the schema rejects. stats.1.order: Expected number, received string',
			// Deliberately not ABSENT_ON_ADD: the write carries `''` here, so `.optional()` would
			// change nothing. This contrast is what the hint exists to draw.
			hint:
				'The appended item carries "" for this key, and it is written the moment "+ Add" is clicked. `.default(…)` on the inner field is the way out: the parser then reads the field as optional, so the item leaves the key out and the schema supplies the value itself.',
		}])
	})

	// With no item to copy keys from, the in-page editor invents `{ name: '' }`.
	test('"+ Add" on an empty repeater is simulated with the editor\'s invented item', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: [] })],
				},
			},
			{ people: itemsJudgedBy('stats', item => (isRecord(item) && 'name' in item ? [{ key: 'name', message: 'Unrecognized key' }] : [])) },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.field)).toEqual(['stats.0.name'])
	})

	// Both shapes are one user action, so one finding — worded by the keyless item, which is
	// simulated first. Pinned because the two messages differ and either could win.
	test('both "+ Add" shapes failing on the same path is reported once, in the first shape\'s words', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ label: 'Age' }] })],
				},
			},
			// A non-empty label rejects the keyless item and the blanked template alike.
			{
				people: itemsJudgedBy('stats', item => {
					if (!isRecord(item) || item.label === undefined) return [{ key: 'label', message: 'Required' }]
					return item.label === '' ? [{ key: 'label', message: 'String must contain at least 1 character' }] : []
				}),
			},
		)

		expect((await checkEditorWrites(input)).map(finding => finding.message)).toEqual([
			'Clicking "+ Add" on "people.stats" produces a write the schema rejects. stats.1.label: Required',
		])
	})

	// The in-page editor copies the first item's keys — of which there are none here. Inventing
	// `{ name: '' }` for a non-empty array would predict a write neither editor makes.
	test('a first item with no keys yields no invented item', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: [{}] })],
				},
			},
			{ people: itemsJudgedBy('stats', item => (isRecord(item) && 'name' in item ? [{ key: 'name', message: 'Unrecognized key' }] : [])) },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// The in-page repeater is not what renders an array of scalars, so its item template says
	// nothing about this field. Repeating the other editor's write is the honest stand-in.
	test('a first item that is not an object yields no invented item either', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { stats: ['Age'] })],
				},
			},
			{ people: itemsJudgedBy('stats', item => (isRecord(item) && 'name' in item ? [{ key: 'name', message: 'Unrecognized key' }] : [])) },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// `z.array(z.string())` parses to an array with no item type at all — the same shape a repeater
	// whose item schema could not be read leaves behind. It renders as a row of text inputs, so
	// guessing an object item there reports a write no editor makes.
	test('a list of plain strings is not predicted as a list of objects', async () => {
		const input = inputOf(
			{
				people: {
					fields: [fieldOf('linked', { required: false, type: 'array' })],
					entries: [entryOf('src/content/people/ada.md', { linked: ['ada-on-tour'] })],
				},
			},
			{
				people: schemaOf(value => {
					const linked: unknown[] = isRecord(value) && Array.isArray(value.linked) ? value.linked : []
					return linked.flatMap((item, index) =>
						typeof item === 'string' ? [] : [{ path: ['linked', index], message: 'Invalid input: expected string, received object' }]
					)
				}),
			},
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// A simulation that did not run must never look like a pass.
	test('a repeater with no schema-accepted entry to seed from is reported as unchecked', async () => {
		const input = inputOf(
			{
				people: {
					fields: [repeaterField('stats')],
					// The only entry on disk is already broken, so it cannot stand in for a real edit.
					entries: [entryOf('src/content/people/ada.md', { stats: [{}] })],
				},
			},
			{ people: requiresInItems('stats', 'label') },
		)

		expect(await checkEditorWrites(input)).toEqual([{
			severity: 'warning',
			code: 'cms/empty-write-unchecked',
			file: 'src/content.config.ts',
			field: 'stats',
			message:
				'Could not check what "+ Add" on "people.stats" writes: no existing entry passes the schema, so there is no valid record to add an item to.',
			// An unchecked finding's remedy is to unblock the check, not to change the schema.
			hint: 'Fix the `entry/schema-rejected` findings in "people" and run this again — the prediction needs one entry the schema accepts.',
		}])
	})

	test('an empty collection says so rather than reporting nothing', async () => {
		const input = inputOf({ people: { fields: [repeaterField('stats')] } }, { people: requiresInItems('stats', 'label') })

		const findings = await checkEditorWrites(input)
		expect(findings).toHaveLength(1)
		expect(findings[0]!.code).toBe('cms/empty-write-unchecked')
		expect(findings[0]!.message).toContain('the collection has no entry to add an item to')
	})

	// Nothing is pre-filled and nothing is suppressed when the AST read no fields, so simulating
	// would report every required key on a project that is fine.
	test('a collection whose schema the config parse could not read is reported as unchecked, not simulated', async () => {
		const input = inputOf({ people: { fields: [] } }, { people: requires('name', 'slug') })

		const findings = await checkEditorWrites(input)
		expect(findings).toEqual([{
			severity: 'warning',
			code: 'cms/empty-write-unchecked',
			file: 'src/content.config.ts',
			field: 'people',
			message:
				'Could not check what creating a new entry in "people" writes: its schema is not readable from the content config, so there are no fields to predict the write from.',
			hint:
				'Write the field types inline in the content config rather than importing the shape from another module — the prediction reads the config source, and a schema assembled elsewhere leaves it nothing to read.',
		}])
	})

	test('a collection whose writes the schema takes reports nothing', async () => {
		const input = inputOf(
			{
				people: {
					fields: [fieldOf('name'), repeaterField('stats')],
					entries: [entryOf('src/content/people/ada.md', { name: 'Ada', stats: [] })],
				},
			},
			{ people: accepts() },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	test('a collection with no live schema is skipped', async () => {
		const input = inputOf(
			{
				people: { fields: [fieldOf('slug', { layout: { hidden: true } })] },
				articles: { fields: [fieldOf('slug', { layout: { hidden: true } })] },
			},
			{ articles: requires('slug') },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.message)).toEqual([
			'Creating a new entry in "articles" produces a write the schema rejects. slug: Required',
		])
	})

	// The `date` the create *route* injects is the day the check runs, and a report that changes
	// with the calendar cannot be trusted in CI. The form itself no longer defaults a `date`
	// field — see the next test.
	test("the injected today is what the create route's date reaches the schema as", async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title')] } },
			{ people: schemaOf(value => [{ path: ['date'], message: `received ${isRecord(value) ? String(value.date) : '?'}` }]) },
			() => new Date('2020-01-02T03:04:05Z'),
		)

		expect((await checkEditorWrites(input))[0]!.message).toContain('received 2020-01-02')
	})

	// A date the form invented is content the user never chose — an optional `expiresAt` seeded
	// with today is wrong in a way no schema can catch. The key is left out instead.
	test('a date field the create form leaves alone is omitted, not filled with today', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('expiresAt', { type: 'date', required: false })] } },
			{
				people: schemaOf(value =>
					isRecord(value) && value.expiresAt !== undefined
						? [{ path: ['expiresAt'], message: `received ${String(value.expiresAt)}` }]
						: []
				),
			},
			() => new Date('2020-01-02T03:04:05Z'),
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	test('one path reported twice by the same action yields one finding', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('slug', { layout: { hidden: true } })] } },
			{
				people: schemaOf(() => [
					{ path: ['slug'], message: 'Required' },
					{ path: ['slug'], message: 'Invalid input' },
				]),
			},
		)

		expect((await checkEditorWrites(input)).map(finding => finding.message)).toEqual([
			'Creating a new entry in "people" produces a write the schema rejects. slug: Required',
		])
	})

	test('the same field path in two collections is not deduplicated away', async () => {
		const input = inputOf(
			{
				people: { fields: [fieldOf('slug', { layout: { hidden: true } })] },
				articles: { fields: [fieldOf('slug', { layout: { hidden: true } })] },
			},
			{ people: requires('slug'), articles: requires('slug') },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.message)).toEqual([
			'Creating a new entry in "people" produces a write the schema rejects. slug: Required',
			'Creating a new entry in "articles" produces a write the schema rejects. slug: Required',
		])
	})

	test('an issue about the record itself carries no field', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('name', { required: false })] } },
			{ people: schemaOf(() => [{ path: [], message: 'Either name or slug is required' }]) },
		)

		const findings = await checkEditorWrites(input)
		expect(findings[0]!.field).toBeUndefined()
		expect(findings[0]!.message).toBe('Creating a new entry in "people" produces a write the schema rejects. Either name or slug is required')
	})
})

// Once the schema declares the item's fields, "+ Add" builds the item from them rather than
// guessing — the same `newRepeaterItem` the editors call, so prediction and reality cannot drift.
describe('checkEditorWrites — seeded repeater items', () => {
	const itemField = (name: string, extra: Partial<ParsedField> = {}): ParsedField => ({ name, required: true, ...extra })

	const declaredRepeater = (name: string, fields: ParsedField[]): ParsedField =>
		fieldOf(name, { type: 'array', itemType: 'object', required: false, fields })

	test('a required item key the schema declares is seeded, so nothing is reported', async () => {
		const input = inputOf(
			{
				people: {
					fields: [fieldOf('name'), declaredRepeater('stats', [itemField('label')])],
					entries: [entryOf('src/content/people/ada.md', { name: 'Ada', stats: [{ label: 'Age' }] })],
				},
			},
			{ people: requiresInItems('stats', 'label') },
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// The counterpart, and the reason optional keys are left out: seeding one with '' breaks
	// schemas that were happy with it absent. An optional array is the case seen in production.
	test('an optional item key is left out rather than seeded with an empty string', async () => {
		const input = inputOf(
			{
				people: {
					fields: [declaredRepeater('links', [itemField('title'), itemField('links', { type: 'array', required: false })])],
					entries: [entryOf('src/content/people/ada.md', { links: [{ title: 'One' }] })],
				},
			},
			{
				people: itemsJudgedBy('links', item => {
					if (!isRecord(item)) return []
					// Exactly what zod says when the blanked-key template writes '' into an array field.
					return item.links === undefined || Array.isArray(item.links) ? [] : [{ key: 'links', message: 'Expected array, received string' }]
				}),
			},
		)

		expect(await checkEditorWrites(input)).toEqual([])
	})

	// What survives the fix: neither the editor nor `addArrayItem` can seed a key the config does
	// not declare, because both read the same config. That is the finding worth keeping.
	test('a required item key the config does not declare is still reported', async () => {
		const input = inputOf(
			{
				people: {
					fields: [declaredRepeater('stats', [itemField('label')])],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ label: 'Age', value: '1' }] })],
				},
			},
			{ people: requiresInItems('stats', 'value') },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.field)).toEqual(['stats.1.value'])
	})

	// A hidden item field is skipped by `newRepeaterItem` for the same reason as everywhere else,
	// so a hidden *required* one stays missing and has to keep being reported.
	test('a hidden required item key is not seeded, and is reported', async () => {
		const input = inputOf(
			{
				people: {
					fields: [declaredRepeater('stats', [itemField('label'), itemField('order', { layout: { hidden: true } })])],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ label: 'Age', order: 1 }] })],
				},
			},
			{ people: requiresInItems('stats', 'order') },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.field)).toEqual(['stats.1.order'])
	})

	// Only one shape is predicted now, so a schema that refuses the seeded item says so once.
	test('the seeded item is the only shape predicted', async () => {
		const input = inputOf(
			{
				people: {
					fields: [declaredRepeater('stats', [itemField('label')])],
					entries: [entryOf('src/content/people/ada.md', { stats: [{ label: 'Age' }] })],
				},
			},
			// Seeded as '', which a min-length rule still refuses — a real failure, reported once.
			{ people: itemsJudgedBy('stats', item => (isRecord(item) && item.label === '' ? [{ key: 'label', message: 'Too small' }] : [])) },
		)

		expect((await checkEditorWrites(input)).map(finding => finding.message)).toEqual([
			'Clicking "+ Add" on "people.stats" produces a write the schema rejects. stats.1.label: Too small',
		])
	})
})
