import type { CollectionEntry, FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import {
	blankValue,
	coerceInput,
	draftForCreate,
	draftFromEntry,
	draftFromServerFrontmatter,
	parseWireValue,
	setDraftField,
	valueToArray,
	valueToBoolean,
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
		expect(blankValue('number')).toBe('')
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

describe('setDraftField', () => {
	test('immutably sets a top-level key', () => {
		const draft = { frontmatter: { a: 1 }, body: 'b' }
		const next = setDraftField(draft, 'a', 2)
		expect(next.frontmatter.a).toBe(2)
		expect(draft.frontmatter.a).toBe(1)
		expect(next).not.toBe(draft)
	})
})
