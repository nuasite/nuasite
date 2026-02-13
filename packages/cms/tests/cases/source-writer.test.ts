import { describe, expect, test } from 'bun:test'
import { applyTextChange } from '../../src/handlers/source-writer'
import type { ChangePayload } from '../../src/editor/types'
import type { CmsManifest } from '../../src/types'

const emptyManifest: CmsManifest = { entries: {}, components: {}, componentDefinitions: {} }

function makeChange(overrides: Partial<ChangePayload>): ChangePayload {
	return {
		cmsId: 'cms-0',
		newValue: '',
		originalValue: '',
		sourcePath: '/test.astro',
		sourceLine: 1,
		sourceSnippet: '',
		...overrides,
	}
}

describe('applyTextChange', () => {
	test('simple text replacement', () => {
		const content = '<h3>Hello world</h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Hello world</h3>',
				originalValue: 'Hello world',
				newValue: 'Hello universe',
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<h3>Hello universe</h3>' })
	})

	test('text spanning inline styled span', () => {
		const content = '                <h3 class="text-3xl font-semibold leading-9">od 25 000 Kč <span class="text-lg leading-7">/ měsíc</span></h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '                <h3 class="text-3xl font-semibold leading-9">od 25 000 Kč <span class="text-lg leading-7">/ měsíc</span></h3>',
				originalValue: 'od 25 000 Kč / měsíc',
				newValue: 'od 25 0003 Kč / měsíc',
				htmlValue: 'od 25 0003 Kč <span class="text-lg leading-7">/ měsíc</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(
				'                <h3 class="text-3xl font-semibold leading-9">od 25 0003 Kč <span class="text-lg leading-7">/ měsíc</span></h3>',
			)
		}
	})

	test('text spanning multiple inline elements', () => {
		const content = '<p class="info">Price: <span class="bold">100</span> <span class="unit">USD</span></p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p class="info">Price: <span class="bold">100</span> <span class="unit">USD</span></p>',
				originalValue: 'Price: 100 USD',
				newValue: 'Price: 200 EUR',
				htmlValue: 'Price: <span class="bold">200</span> <span class="unit">EUR</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(
				'<p class="info">Price: <span class="bold">200</span> <span class="unit">EUR</span></p>',
			)
		}
	})

	test('text spanning inline span without htmlValue falls back to newValue', () => {
		const content = '<h2>Hello <span class="accent">world</span></h2>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h2>Hello <span class="accent">world</span></h2>',
				originalValue: 'Hello world',
				newValue: 'Hi everyone',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<h2>Hi everyone</h2>')
		}
	})

	test('returns error when text not found and no inline elements', () => {
		const content = '<h3>Some other text</h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Some other text</h3>',
				originalValue: 'Nonexistent text',
				newValue: 'New text',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(false)
	})

	test('snippet not found in file content', () => {
		const content = '<h3>Completely different</h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Some text</h3>',
				originalValue: 'Some text',
				newValue: 'New text',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toBe('Source snippet not found in file')
		}
	})

	test('handles HTML entities in text', () => {
		const content = '<p>Tom &amp; Jerry</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Tom &amp; Jerry</p>',
				originalValue: 'Tom & Jerry',
				newValue: 'Tom & Friends',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Tom & Friends</p>')
		}
	})

	test('preserves surrounding content when replacing snippet', () => {
		const content = '<div>\n  <h3>Hello <span class="sm">world</span></h3>\n  <p>Other</p>\n</div>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Hello <span class="sm">world</span></h3>',
				originalValue: 'Hello world',
				newValue: 'Hi earth',
				htmlValue: 'Hi <span class="sm">earth</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<div>\n  <h3>Hi <span class="sm">earth</span></h3>\n  <p>Other</p>\n</div>')
		}
	})
})
