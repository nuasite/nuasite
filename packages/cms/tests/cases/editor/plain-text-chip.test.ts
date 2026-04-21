import { describe, expect, test } from 'bun:test'
import { describeSource } from '../../../src/editor/components/plain-text-chip-utils'
import type { ManifestEntry } from '../../../src/types'

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
	return { id: 'x', tag: 'span', text: '', ...overrides }
}

describe('describeSource', () => {
	test('returns generic label when entry is missing', () => {
		expect(describeSource(undefined)).toBe('no formatting')
	})

	test('names the collection when entry has collectionName', () => {
		expect(describeSource(entry({ collectionName: 'blog' }))).toBe('blog collection field')
	})

	test('names the prop when entry has variableName', () => {
		expect(describeSource(entry({ variableName: 'description' }))).toBe('description prop')
	})

	test('prefers collectionName over variableName', () => {
		expect(describeSource(entry({ collectionName: 'blog', variableName: 'title' }))).toBe('blog collection field')
	})

	test('falls back to generic label when no context fields are set', () => {
		expect(describeSource(entry({}))).toBe('no formatting')
	})
})
