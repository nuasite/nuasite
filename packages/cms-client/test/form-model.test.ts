import type { CollectionEntry, FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import {
	blankValue,
	coerceInput,
	draftForCreate,
	draftFromEntry,
	draftFromServerFrontmatter,
	missingRequiredFields,
	missingRequiredMessage,
	parseWireValue,
	setDraftField,
	valueToArray,
	valueToBoolean,
	valueToDateInput,
	valueToInput,
	valueToObject,
} from '../src/form-model'

describe('parseWireValue (stringified GET frontmatter → native)', () => {
	test('boolean truthy encodings', () => {
		expect(parseWireValue('boolean', 'true')).toBe(true)
		expect(parseWireValue('boolean', '1')).toBe(true)
		expect(parseWireValue('boolean', 'yes')).toBe(true)
		expect(parseWireValue('boolean', 'false')).toBe(false)
		expect(parseWireValue('boolean', '')).toBe(false)
	})

	test('number coerces, falls back to raw on NaN', () => {
		expect(parseWireValue('number', '42')).toBe(42)
		expect(parseWireValue('number', '3.5')).toBe(3.5)
		expect(parseWireValue('number', 'not-a-number')).toBe('not-a-number')
	})

	test('year/month coerce to numbers', () => {
		expect(parseWireValue('year', '2026')).toBe(2026)
		expect(parseWireValue('month', '6')).toBe(6)
	})

	test('array/object JSON-parse, fall back to raw when invalid', () => {
		expect(parseWireValue('array', '["a","b"]')).toEqual(['a', 'b'])
		expect(parseWireValue('object', '{"k":1}')).toEqual({ k: 1 })
		expect(parseWireValue('array', 'plain text')).toBe('plain text')
	})

	test('text-like types pass through verbatim', () => {
		expect(parseWireValue('text', 'hello')).toBe('hello')
		expect(parseWireValue('url', 'https://x.test')).toBe('https://x.test')
	})
})

describe('draftFromEntry', () => {
	const fields: FieldDefinition[] = [
		{ name: 'title', type: 'text', required: true },
		{ name: 'draft', type: 'boolean', required: false, role: 'publish-toggle' },
		{ name: 'order', type: 'number', required: false },
		{ name: 'tags', type: 'array', required: false, itemType: 'text' },
	]

	const entry: CollectionEntry = {
		collectionName: 'blog',
		collectionSlug: 'hello',
		sourcePath: 'src/content/blog/hello.md',
		frontmatter: {
			title: { value: 'Hello', line: 0 },
			draft: { value: 'true', line: 0 },
			order: { value: '3', line: 0 },
			tags: { value: '["a","b"]', line: 0 },
			legacy: { value: 'kept', line: 0 },
		},
		body: '# Body',
		bodyStartLine: 0,
	}

	test('coerces per field type and keeps the body', () => {
		const draft = draftFromEntry(entry, fields)
		expect(draft.frontmatter.title).toBe('Hello')
		expect(draft.frontmatter.draft).toBe(true)
		expect(draft.frontmatter.order).toBe(3)
		expect(draft.frontmatter.tags).toEqual(['a', 'b'])
		expect(draft.body).toBe('# Body')
	})

	test('preserves frontmatter keys absent from the schema (no silent drop)', () => {
		const draft = draftFromEntry(entry, fields)
		expect(draft.frontmatter.legacy).toBe('kept')
	})
})

describe('draftForCreate / blankValue', () => {
	test('seeds defaults and type-appropriate blanks, skipping hidden fields', () => {
		const fields: FieldDefinition[] = [
			{ name: 'title', type: 'text', required: true },
			{ name: 'count', type: 'number', required: false, defaultValue: 7 },
			{ name: 'flag', type: 'boolean', required: false },
			{ name: 'items', type: 'array', required: false },
			{ name: 'meta', type: 'object', required: false },
			{ name: 'derived', type: 'text', required: false, hidden: true },
		]
		const draft = draftForCreate(fields)
		expect(draft.frontmatter.title).toBe('')
		expect(draft.frontmatter.count).toBe(7)
		expect(draft.frontmatter.flag).toBe(false)
		expect(draft.frontmatter.items).toEqual([])
		expect(draft.frontmatter.meta).toEqual({})
		expect('derived' in draft.frontmatter).toBe(false)
		expect(draft.body).toBe('')
	})

	test('blankValue by type', () => {
		expect(blankValue('boolean')).toBe(false)
		expect(blankValue('array')).toEqual([])
		expect(blankValue('object')).toEqual({})
		expect(blankValue('text')).toBe('')
		expect(blankValue('number')).toBeUndefined()
		expect(blankValue('year')).toBeUndefined()
		expect(blankValue('select')).toBeUndefined()
		expect(blankValue('reference')).toBeUndefined()
	})

	test('coerceInput maps a cleared select/reference to undefined', () => {
		expect(coerceInput('select', '')).toBeUndefined()
		expect(coerceInput('select', 'expert')).toBe('expert')
		expect(coerceInput('reference', '')).toBeUndefined()
		expect(coerceInput('reference', 'some-slug')).toBe('some-slug')
	})

	// An untouched optional number used to be seeded with '', which the collection schema
	// rejects — one such entry fails `astro sync` and with it the whole site build.
	test('omits untouched optional numeric fields instead of writing an empty string', () => {
		const fields: FieldDefinition[] = [
			{ name: 'title', type: 'text', required: true },
			{ name: 'order', type: 'number', required: false },
			{ name: 'founded', type: 'year', required: false },
			{ name: 'role', type: 'select', required: false, options: ['expert', 'author'] },
			{ name: 'author', type: 'reference', required: false, collection: 'people' },
		]
		const draft = draftForCreate(fields)
		expect(draft.frontmatter.order).toBeUndefined()
		expect(draft.frontmatter.founded).toBeUndefined()
		expect(draft.frontmatter.role).toBeUndefined()
		expect(draft.frontmatter.author).toBeUndefined()
		expect(JSON.parse(JSON.stringify(draft.frontmatter))).toEqual({ title: '' })
	})
})

describe('draftFromServerFrontmatter (409 adoption)', () => {
	test('adopts native server values + body', () => {
		const fields: FieldDefinition[] = [
			{ name: 'title', type: 'text', required: true },
			{ name: 'order', type: 'number', required: false },
		]
		const draft = draftFromServerFrontmatter({ title: 'Server', order: 9 }, 'server body', fields)
		expect(draft.frontmatter.title).toBe('Server')
		expect(draft.frontmatter.order).toBe(9)
		expect(draft.body).toBe('server body')
	})

	test('re-coerces stringy numeric server values; tolerates missing body', () => {
		const fields: FieldDefinition[] = [{ name: 'order', type: 'number', required: false }]
		const draft = draftFromServerFrontmatter({ order: '5' }, undefined, fields)
		expect(draft.frontmatter.order).toBe(5)
		expect(draft.body).toBe('')
	})
})

describe('coerceInput (form string → native)', () => {
	test('boolean from string', () => {
		expect(coerceInput('boolean', 'true')).toBe(true)
		expect(coerceInput('boolean', 'false')).toBe(false)
	})
	test('number empty → undefined, valid → number, invalid → raw', () => {
		expect(coerceInput('number', '')).toBeUndefined()
		expect(coerceInput('number', '12')).toBe(12)
		expect(coerceInput('number', 'x')).toBe('x')
	})
	test('text passthrough', () => {
		expect(coerceInput('text', 'abc')).toBe('abc')
	})
})

describe('value readers', () => {
	test('valueToInput', () => {
		expect(valueToInput(undefined)).toBe('')
		expect(valueToInput(null)).toBe('')
		expect(valueToInput('s')).toBe('s')
		expect(valueToInput(5)).toBe('5')
		expect(valueToInput(true)).toBe('true')
		expect(valueToInput({ a: 1 })).toBe('{"a":1}')
	})
	test('valueToBoolean', () => {
		expect(valueToBoolean(true)).toBe(true)
		expect(valueToBoolean('yes')).toBe(true)
		expect(valueToBoolean('false')).toBe(false)
		expect(valueToBoolean(0)).toBe(false)
	})
	test('valueToArray / valueToObject', () => {
		expect(valueToArray(['a'])).toEqual(['a'])
		expect(valueToArray('not-array')).toEqual([])
		expect(valueToObject({ k: 1 })).toEqual({ k: 1 })
		expect(valueToObject(['a'])).toEqual({})
		expect(valueToObject(null)).toEqual({})
	})
})

describe('temporal fields (date/datetime/time/month)', () => {
	test('parseWireValue unwraps a JSON-stringified Date and passes plain strings through', () => {
		// The sidecar JSON-stringifies a YAML Date → double-quoted ISO string.
		expect(parseWireValue('date', '"2026-06-01T12:00:00.000Z"')).toBe('2026-06-01T12:00:00.000Z')
		expect(parseWireValue('datetime', '"2026-06-01T12:00:00.000Z"')).toBe('2026-06-01T12:00:00.000Z')
		// Already a plain string in YAML → unchanged.
		expect(parseWireValue('date', '2026-06-01')).toBe('2026-06-01')
		expect(parseWireValue('date', '')).toBeUndefined()
	})

	test('coerceInput maps empty temporal input to undefined, keeps a real value', () => {
		expect(coerceInput('date', '')).toBeUndefined()
		expect(coerceInput('datetime', '')).toBeUndefined()
		expect(coerceInput('time', '')).toBeUndefined()
		expect(coerceInput('date', '2026-06-01')).toBe('2026-06-01')
	})

	test('blankValue seeds temporal fields empty so an untouched optional date is omitted', () => {
		expect(blankValue('date')).toBeUndefined()
		expect(blankValue('datetime')).toBeUndefined()
		expect(blankValue('time')).toBeUndefined()
		expect(blankValue('month')).toBeUndefined()
	})

	test('valueToDateInput formats stored values for the native control', () => {
		// Full ISO datetime (the shape aktuality store) → date-only for <input type="date">.
		expect(valueToDateInput('2026-06-01T12:00:00.000Z', 'date')).toBe('2026-06-01')
		expect(valueToDateInput('2026-06-01T12:00:00', 'datetime')).toBe('2026-06-01T12:00')
		expect(valueToDateInput('2026-06-01T12:00:00', 'month')).toBe('2026-06')
		// Plain date string passes straight through.
		expect(valueToDateInput('2026-06-01', 'date')).toBe('2026-06-01')
		// Date object.
		expect(valueToDateInput(new Date('2026-06-01T12:00:00'), 'date')).toBe('2026-06-01')
		// Time-only.
		expect(valueToDateInput('08:35', 'time')).toBe('08:35')
		expect(valueToDateInput('2026-06-01T08:35:00', 'time')).toBe('08:35')
		// Empty / unparseable → '' (so the control blanks instead of rejecting).
		expect(valueToDateInput('', 'date')).toBe('')
		expect(valueToDateInput(undefined, 'date')).toBe('')
		expect(valueToDateInput('not a date', 'date')).toBe('')
	})
})

describe('setDraftField', () => {
	test('immutably sets a top-level key', () => {
		const draft = { frontmatter: { a: 1 }, body: 'b' }
		const next = setDraftField(draft, 'a', 2)
		expect(next.frontmatter.a).toBe(2)
		expect(draft.frontmatter.a).toBe(1)
		expect(next).not.toBe(draft)
	})
})

describe('missingRequiredFields', () => {
	const field = (name: string, over: Partial<FieldDefinition> = {}): FieldDefinition => ({ name, type: 'text', required: true, ...over })

	test('an untouched required select is the case this exists for', () => {
		expect(missingRequiredFields([field('topic', { type: 'select', options: ['aktualne'] })], { topic: '' })).toEqual(['topic'])
	})

	test('a missing key counts the same as an empty one', () => {
		expect(missingRequiredFields([field('topic')], {})).toEqual(['topic'])
		expect(missingRequiredFields([field('topic')], { topic: null })).toEqual(['topic'])
	})

	test('optional fields are never reported', () => {
		expect(missingRequiredFields([field('perex', { required: false })], { perex: '' })).toEqual([])
	})

	test('hidden fields are skipped — the form gives no way to fill them', () => {
		expect(missingRequiredFields([field('authorSlug', { hidden: true })], { authorSlug: '' })).toEqual([])
	})

	test('falsy values are values: false and 0 pass', () => {
		expect(missingRequiredFields([field('draft', { type: 'boolean' })], { draft: false })).toEqual([])
		expect(missingRequiredFields([field('order', { type: 'number' })], { order: 0 })).toEqual([])
	})

	test('an empty collection is a deliberate "nothing here", not a missing value', () => {
		expect(missingRequiredFields([field('tags', { type: 'array' })], { tags: [] })).toEqual([])
		expect(missingRequiredFields([field('meta', { type: 'object' })], { meta: {} })).toEqual([])
	})

	test('reports every empty field, in schema order', () => {
		const fields = [field('title'), field('topic'), field('perex', { required: false })]
		expect(missingRequiredFields(fields, { title: '', topic: '', perex: '' })).toEqual(['title', 'topic'])
	})

	// A derivation declared in the content config is recomputed by cms-core on every write,
	// ahead of its own required check. Demanding it here would refuse a save the server would
	// have taken — over a value the form never asks for.
	test('a declared derived field is skipped even when visible — the server computes it', () => {
		const fields = [field('topicHref', { derivedFrom: 'topic', derivedDeclared: true, hidden: false })]
		expect(missingRequiredFields(fields, { topic: 'Lidé', topicHref: '' })).toEqual([])
	})

	// The other half, and the one that matters: `detectDerivedHrefFields` guesses a derivation
	// from at most three sampled values and nothing ever recomputes it. Skipping on `derivedFrom`
	// alone would quietly stop validating a genuinely required field over that coincidence.
	test('a merely inferred derived field is still reported — nothing recomputes it', () => {
		const fields = [field('authorHref', { derivedFrom: 'author' })]
		expect(missingRequiredFields(fields, { author: 'Jana Nováková', authorHref: '' })).toEqual(['authorHref'])
	})

	test('a declared derived field that is hidden stays skipped, and an optional one is never reported either', () => {
		expect(missingRequiredFields([field('categoryHref', { derivedFrom: 'category', derivedDeclared: true, hidden: true })], {})).toEqual([])
		expect(missingRequiredFields([field('categorySlug', { derivedFrom: 'category', derivedDeclared: true, required: false })], {})).toEqual([])
	})

	test('the marker exempts only the field carrying it — its source is reported as usual', () => {
		const fields = [field('topic'), field('topicHref', { derivedFrom: 'topic', derivedDeclared: true, hidden: false })]
		expect(missingRequiredFields(fields, { topic: '', topicHref: '' })).toEqual(['topic'])
	})
})

describe('missingRequiredMessage', () => {
	test('names a single field', () => {
		expect(missingRequiredMessage(['topic'])).toBe('“topic” is required.')
	})

	test('lists several', () => {
		expect(missingRequiredMessage(['title', 'topic'])).toBe('Required fields are empty: title, topic.')
	})
})
