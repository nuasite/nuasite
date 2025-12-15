import { describe, expect, test } from 'bun:test'
import { processHtml } from '../../src/html-processor'

describe('Nested Text Handling', () => {
	let counter = 0
	const getNextId = () => `cms-${counter++}`

	const getOptions = () => ({
		attributeName: 'data-cms-id',
		includeTags: ['p', 'h1', 'strong', 'em'],
		excludeTags: [],
		includeEmptyText: false,
		generateManifest: true,
	})

	test('should preserve text around nested CMS elements in intermediate containers', async () => {
		counter = 0
		// Only <p> and <strong> get CMS IDs, <span> does not
		const html = '<p>Start <span>before <strong>bold</strong> after</span> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		// p gets cms-0, strong gets cms-1
		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()

		// The text should include "before", the placeholder, and "after"
		expect(pEntry?.text).toContain('before')
		expect(pEntry?.text).toContain('{{cms:cms-1}}')
		expect(pEntry?.text).toContain('after')
		expect(pEntry?.text).toBe('Start before {{cms:cms-1}} after end')
	})

	test('should handle multiple levels of nesting without CMS IDs', async () => {
		counter = 0
		// Only <p> and <strong> get CMS IDs in this test (span and em don't match includeTags)
		const html = '<p>Start <span><div>before <strong>bold</strong> after</div></span> end</p>'
		const result = await processHtml(
			html,
			'test.html',
			{ ...getOptions(), includeTags: ['p', 'strong'] },
			getNextId,
		)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toContain('before')
		expect(pEntry?.text).toContain('{{cms:cms-1}}') // strong
		expect(pEntry?.text).toContain('after')
		expect(pEntry?.text).toBe('Start before {{cms:cms-1}} after end')
	})

	test('should handle text siblings of nested CMS elements', async () => {
		counter = 0
		const html = '<p>Start <span>A <strong>B</strong> C <strong>D</strong> E</span> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		// Should have: Start A {{cms:cms-1}} C {{cms:cms-2}} E end
		expect(pEntry?.text).toContain('A')
		expect(pEntry?.text).toContain('{{cms:cms-1}}')
		expect(pEntry?.text).toContain('C')
		expect(pEntry?.text).toContain('{{cms:cms-2}}')
		expect(pEntry?.text).toContain('E')
	})

	test('should handle direct child CMS elements (existing behavior)', async () => {
		counter = 0
		const html = '<p>Start <strong>bold</strong> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Start {{cms:cms-1}} end')
		expect(pEntry?.childCmsIds).toContain('cms-1')
	})

	test('should handle mixed direct and nested CMS elements', async () => {
		counter = 0
		// <em> and <strong> have CMS IDs, <span> doesn't
		const html = '<p><em>italic</em> <span>text <strong>bold</strong> more</span> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		// em is direct child -> placeholder
		// span has no ID -> recursively process -> strong becomes placeholder
		expect(pEntry?.text).toContain('{{cms:cms-1}}') // em
		expect(pEntry?.text).toContain('text')
		expect(pEntry?.text).toContain('{{cms:cms-2}}') // strong
		expect(pEntry?.text).toContain('more')
		expect(pEntry?.text).toBe('{{cms:cms-1}} text {{cms:cms-2}} more end')
	})

	test('should preserve whitespace in nested structures', async () => {
		counter = 0
		const html = '<p>Start <span>  before  <strong>bold</strong>  after  </span> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		// Whitespace should be preserved from innerText
		expect(pEntry?.text).toMatch(/before\s+.*\s+after/)
	})

	test('should handle empty intermediate containers', async () => {
		counter = 0
		const html = '<p>Start <span></span> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Start  end')
	})

	test('should handle intermediate container with only nested CMS element', async () => {
		counter = 0
		const html = '<p>Start <span><strong>bold</strong></span> end</p>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Start {{cms:cms-1}} end')
	})
})
