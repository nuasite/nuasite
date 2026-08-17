import {
	checkFieldShapes,
	type LiveSchema,
	type LiveSchemas,
	type LoadedCollections,
	type LoadedEntry,
	type ParsedConfig,
	type ParsedField,
	type ShapeCheckInput,
} from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A field's opinion: the message it would report for this value, or `null` if it is happy. */
type FieldRule = (value: unknown, present: boolean) => string | null

/**
 * A hand-written stand-in for a compiled zod object.
 *
 * Deliberately fake: this file pins down what the probes conclude from a schema's answers, not
 * what zod produces. Running the real thing is the CLI's job, covered there.
 */
const objectSchema = (rules: Record<string, FieldRule>): LiveSchema => ({
	safeParse: async value => {
		const record = isRecord(value) ? value : {}
		const issues = Object.entries(rules)
			.map(([key, rule]) => ({ key, message: rule(record[key], Object.hasOwn(record, key)) }))
			.filter((issue): issue is { key: string; message: string } => issue.message !== null)
			.map(issue => ({ path: [issue.key], message: issue.message }))
		return issues.length === 0 ? { success: true } : { success: false, issues }
	},
})

const requiredString: FieldRule = (value, present) => {
	if (!present) return 'Required'
	return typeof value === 'string' ? null : 'Expected string'
}
const optionalString: FieldRule = (value, present) => {
	if (!present) return null
	return typeof value === 'string' ? null : 'Expected string'
}
const optionalNumber: FieldRule = (value, present) => {
	if (!present) return null
	return typeof value === 'number' ? null : 'Expected number'
}
/** Accepts a well-formed URL string, which is the point: a text input can serve this field. */
const optionalUrl: FieldRule = (value, present) => {
	if (!present) return null
	if (typeof value !== 'string') return 'Expected string'
	return value.startsWith('https://') ? null : 'Invalid url'
}
/** A `passthrough()`/`catchall()` key: the schema has no opinion about it whatsoever. */
const anything: FieldRule = () => null

const fieldOf = (name: string, extra: Partial<ParsedField> = {}): ParsedField => ({ name, required: true, ...extra })

const entryOf = (file: string, frontmatter: Record<string, unknown>): LoadedEntry => ({
	file,
	stem: file.replace(/^.*\//, '').replace(/\.md$/, ''),
	frontmatter,
})

interface CollectionSpec {
	fields: ParsedField[]
	entries?: LoadedEntry[]
}

const inputOf = (collections: Record<string, CollectionSpec>, schemas: LiveSchemas): ShapeCheckInput => {
	const config: ParsedConfig = new Map()
	const loaded: LoadedCollections = new Map()
	for (const [name, spec] of Object.entries(collections)) {
		config.set(name, { name, fields: spec.fields, loaderBase: `./src/content/${name}` })
		loaded.set(name, { name, base: `src/content/${name}`, exists: true, entries: spec.entries ?? [] })
	}
	return { config, collections: loaded, schemas }
}

const codes = async (input: ShapeCheckInput): Promise<string[]> => (await checkFieldShapes(input)).map(finding => finding.code)

/** Every case here seeds from an entry the schema accepts — without one the probes have no baseline. */
const seeded = (frontmatter: Record<string, unknown> = { title: 'Ada' }): LoadedEntry[] => [entryOf('src/content/people/ada.md', frontmatter)]

describe('cms/required-drift', () => {
	// The editor takes `required` from the parser and refuses to save a blank one. When the schema
	// is happy without the key, that refusal blocks an edit the build would have taken.
	test('a field the parser calls required and the schema does not is reported', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('nickname')], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, nickname: optionalString }) },
		)

		expect(await checkFieldShapes(input)).toEqual([{
			severity: 'warning',
			code: 'cms/required-drift',
			file: 'src/content.config.ts',
			field: 'people.nickname',
			message: 'The editor treats "people.nickname" as required and refuses to save it blank, but the schema accepts an entry without it.',
			hint:
				'Either the schema should require it, or the config should show the parser that it is optional. Wrapping a field schema in a helper call (`field.image(z.string().optional())`) or reaching it through an import hides the `.optional()` from the parser, which then reads the field as required — put the wrapper outside, as `field.image(z.string()).optional()`.',
		}])
	})

	// The parser marks `.nullable()` optional while the schema still wants the key. That direction
	// has a consequence `cms/empty-write` states precisely, and two codes for one defect read as two.
	test('the opposite drift is left to cms/empty-write', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('nickname', { required: false })], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, nickname: requiredString }) },
		)

		expect(await codes(input)).toEqual([])
	})

	// `blankRequiredFields` skips hidden fields, so the guard never enforces one and there is no
	// over-enforcement to report. The same field is untyped and undata'd here, which is what
	// `cms/field-degraded` looks for — a hidden field is not rendered either, so neither fires.
	test('a hidden field is not reported by either rule, since the editor neither enforces nor renders it', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('order', { layout: { hidden: true } })], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, order: optionalNumber }) },
		)

		expect(await codes(input)).toEqual([])
	})

	test('a field both sides call required is not reported', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title')], entries: seeded() } },
			{ people: objectSchema({ title: requiredString }) },
		)

		expect(await codes(input)).toEqual([])
	})

	// A `passthrough()` object accepts the record with any undeclared key removed, so "accepts
	// missing" alone would put every field the schema never declared on the report.
	test('a key the schema has no opinion about is not reported, though it does accept its absence', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('extra')], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, extra: anything }) },
		)

		expect(await codes(input)).toEqual([])
	})
})

describe('cms/field-degraded', () => {
	// No type from the parser and no value to infer one from means the scanner falls back to
	// `'text'` — and a text input on this field writes a string the build refuses.
	test('an untyped field the schema will not take text in is reported', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('order', { required: false })], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, order: optionalNumber }) },
		)

		expect(await checkFieldShapes(input)).toEqual([{
			severity: 'error',
			code: 'cms/field-degraded',
			file: 'src/content.config.ts',
			field: 'people.order',
			message:
				'The editor will render "people.order" as a plain text input — the parser pinned no type and no entry supplies one — and the schema rejects text there.',
			hint:
				"Write the field's type chain inline in the content config (`n.number()`, `n.date()`, `n.enum([…])`). A type reached through an import, a helper with arguments, or a modifier applied after the object is built is invisible to the parser, which then leaves the editor guessing.",
		}])
	})

	// One entry carrying a value is all the scanner needs to type the field, so the editor never
	// falls back and there is nothing degraded about it.
	test('an untyped field some entry already carries is typed by inference, not reported', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('order', { required: false })], entries: seeded({ title: 'Ada', order: 3 }) } },
			{ people: objectSchema({ title: requiredString, order: optionalNumber }) },
		)

		expect(await codes(input)).toEqual([])
	})

	// The guard that keeps this rule off constrained strings: `z.string().url()` refuses most text
	// and is still perfectly usable through a text input.
	test('a field that takes some text is not reported, though it refuses most of it', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('website', { required: false })], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, website: optionalUrl }) },
		)

		expect(await codes(input)).toEqual([])
	})

	test('a field the parser did type is not reported', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('order', { type: 'number', required: false })], entries: seeded() } },
			{ people: objectSchema({ title: requiredString, order: optionalNumber }) },
		)

		expect(await codes(input)).toEqual([])
	})
})

describe('checkFieldShapes', () => {
	// Both rules compare the schema's answers about a record it accepts. Without one there is no
	// baseline, and `cms/empty-write-unchecked` already says the collection has no usable entry.
	test('a collection with no accepted entry is left alone', async () => {
		const input = inputOf(
			{ people: { fields: [fieldOf('title'), fieldOf('nickname')], entries: seeded({}) } },
			{ people: objectSchema({ title: requiredString, nickname: optionalString }) },
		)

		expect(await codes(input)).toEqual([])
	})

	test('a collection with no live schema is skipped', async () => {
		const input = inputOf({ people: { fields: [fieldOf('nickname')], entries: seeded() } }, {})

		expect(await codes(input)).toEqual([])
	})

	// A schema that throws answers "I don't know", and a rule with no evidence reports nothing —
	// one project-side refinement must not take the report down or invent a finding.
	test('a schema that throws on a probe yields no findings and no rejection', async () => {
		const throwOnMutation: LiveSchema = {
			safeParse: async value => {
				if (!isRecord(value) || value.title !== 'Ada') throw new TypeError('undefined is not an object')
				return { success: true }
			},
		}
		const input = inputOf({ people: { fields: [fieldOf('nickname')], entries: seeded() } }, { people: throwOnMutation })

		expect(await codes(input)).toEqual([])
	})
})
