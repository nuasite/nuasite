import type { FieldDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { withEntrySlug } from '../src/index'

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

	test('it declines, returning the very same object, when it has no business writing', () => {
		const frontmatter = { slug: '' }
		// Nothing declared this field — inventing the key writes frontmatter the schema rejects.
		expect(withEntrySlug([], frontmatter, 'event')).toBe(frontmatter)
		// Not text.
		expect(withEntrySlug(slugField({ type: 'number' }), frontmatter, 'event')).toBe(frontmatter)
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
