import type { FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { withEntrySlug, withRenamedEntrySlug } from '../src/index'

const slugField = (extra: Partial<FieldDefinition> = {}): FieldDefinition[] => [{ name: 'slug', type: 'text', required: true, ...extra }]

describe('the frontmatter slug follows the file slug on create', () => {
	test('a blank declared slug is filled from the file name', () => {
		expect(withEntrySlug(slugField(), { title: 'Večírek ve VILE', slug: '' }, 'vecirek-ve-vile').slug).toBe('vecirek-ve-vile')
	})

	test('a hidden field is filled too — hidden is why the form could not', () => {
		// `draftForCreate` omits hidden keys entirely, so the key is absent rather than blank.
		expect(withEntrySlug(slugField({ hidden: true }), {}, 'event').slug).toBe('event')
	})

	test('the input is never mutated', () => {
		const frontmatter = { slug: '' }
		withEntrySlug(slugField(), frontmatter, 'event')
		expect(frontmatter.slug).toBe('')
	})

	// The server passes `ParsedField`s, whose `type` is `undefined` for a plain `z.string()`; the
	// create form passes scanned `FieldDefinition`s, whose `type` is *inferred from the values seen*
	// — `/o-nas` reads as `'url'`, a long one as `'textarea'`. Demanding `'text'` made the form
	// decline exactly where the server filled the field in, and report a required slug nobody could
	// then satisfy.
	test('every spelling of a string qualifies, not just `text`', () => {
		for (const type of ['text', 'textarea', 'url', 'select', undefined] as const) {
			expect(withEntrySlug(slugField({ type }), { slug: '' }, 'o-nas').slug).toBe('o-nas')
		}
	})

	test('it declines, returning the very same object, when it has no business writing', () => {
		const frontmatter = { slug: '' }
		// Nothing declared this field — inventing the key writes frontmatter the schema rejects.
		expect(withEntrySlug([], frontmatter, 'event')).toBe(frontmatter)
		// A slug that holds something which is not a line of text at all.
		expect(withEntrySlug(slugField({ type: 'number' }), frontmatter, 'event')).toBe(frontmatter)
		expect(withEntrySlug(slugField({ type: 'array' }), frontmatter, 'event')).toBe(frontmatter)
		expect(withEntrySlug(slugField({ type: 'image' }), frontmatter, 'event')).toBe(frontmatter)
		// No file slug yet (the form is still empty).
		expect(withEntrySlug(slugField(), frontmatter, '')).toBe(frontmatter)
		// `applyDerivedFields` owns a *declared* derivation and runs right after this.
		expect(withEntrySlug(slugField({ derivedDeclared: true, derivedFrom: 'title' }), frontmatter, 'event')).toBe(frontmatter)
	})

	test('a value already there is the author’s, and survives', () => {
		const frontmatter = { slug: 'published-address' }
		expect(withEntrySlug(slugField(), frontmatter, 'a-new-file-name')).toBe(frontmatter)
	})

	// The scanner marks any name ending in href/url/link/slug/path as derived when three sampled
	// values happen to match a sibling's — and then nothing ever recomputes it. Declining on that
	// guess would leave exactly the collections this rule exists for holding an empty slug.
	test('an inferred derivation is not a declared one, and does not stop the fill', () => {
		expect(withEntrySlug(slugField({ derivedFrom: 'title' }), { slug: '' }, 'event').slug).toBe('event')
	})
})

describe('the frontmatter slug follows the file slug on rename', () => {
	test('a copy that mirrors the old file name moves with the file', () => {
		expect(withRenamedEntrySlug(slugField(), { slug: 'vecirek-ve-vile' }, 'vecirek-ve-vile', 'vecirek-2026').slug).toBe('vecirek-2026')
	})

	test('a blank copy is filled — the entry predates the create rule', () => {
		expect(withRenamedEntrySlug(slugField(), { slug: '' }, 'old', 'new').slug).toBe('new')
		expect(withRenamedEntrySlug(slugField({ hidden: true }), {}, 'old', 'new').slug).toBe('new')
	})

	// The address the author pointed somewhere else already disagreed with the file name before
	// the rename. Moving the file is no reason to overwrite the answer they gave.
	test('a copy the author aimed elsewhere is left alone', () => {
		const frontmatter = { slug: 'hand-chosen' }
		expect(withRenamedEntrySlug(slugField(), frontmatter, 'old', 'new')).toBe(frontmatter)
	})

	test('it declines for the same reasons a create does, returning the very same object', () => {
		const frontmatter = { slug: 'old' }
		expect(withRenamedEntrySlug([], frontmatter, 'old', 'new')).toBe(frontmatter)
		expect(withRenamedEntrySlug(slugField({ type: 'number' }), frontmatter, 'old', 'new')).toBe(frontmatter)
		expect(withRenamedEntrySlug(slugField(), frontmatter, 'old', '')).toBe(frontmatter)
		expect(withRenamedEntrySlug(slugField({ derivedDeclared: true, derivedFrom: 'title' }), frontmatter, 'old', 'new')).toBe(frontmatter)
		// Already where it is going: no write to make.
		expect(withRenamedEntrySlug(slugField(), { slug: 'new' }, 'old', 'new')).toEqual({ slug: 'new' })
	})

	test('the input is never mutated', () => {
		const frontmatter = { slug: 'old' }
		withRenamedEntrySlug(slugField(), frontmatter, 'old', 'new')
		expect(frontmatter.slug).toBe('old')
	})
})
