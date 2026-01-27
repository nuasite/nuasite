import { expect, test } from 'bun:test'
import { cmsDescribe, expectEntry } from '../utils'

cmsDescribe('Nested Text Handling', { includeTags: ['p', 'h1', 'strong', 'em'], generateManifest: true }, (ctx) => {
	test('preserves text around nested CMS elements in intermediate containers', async () => {
		const result = await ctx.process('<p>Start <span>before <strong>bold</strong> after</span> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toContain('before')
		expect(pEntry?.text).toContain('{{cms:cms-1}}')
		expect(pEntry?.text).toContain('after')
		expect(pEntry?.text).toBe('Start before {{cms:cms-1}} after end')
	})

	test('handles multiple levels of nesting without CMS IDs', async () => {
		const result = await ctx.process(
			'<p>Start <span><div>before <strong>bold</strong> after</div></span> end</p>',
			{ includeTags: ['p', 'strong'] },
		)

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toContain('before')
		expect(pEntry?.text).toContain('{{cms:cms-1}}')
		expect(pEntry?.text).toContain('after')
		expect(pEntry?.text).toBe('Start before {{cms:cms-1}} after end')
	})

	test('handles text siblings of nested CMS elements', async () => {
		const result = await ctx.process('<p>Start <span>A <strong>B</strong> C <strong>D</strong> E</span> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toContain('A')
		expect(pEntry?.text).toContain('{{cms:cms-1}}')
		expect(pEntry?.text).toContain('C')
		expect(pEntry?.text).toContain('{{cms:cms-2}}')
		expect(pEntry?.text).toContain('E')
	})

	test('handles direct child CMS elements (existing behavior)', async () => {
		const result = await ctx.process('<p>Start <strong>bold</strong> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Start {{cms:cms-1}} end')
		expect(pEntry?.childCmsIds).toContain('cms-1')
	})

	test('handles mixed direct and nested CMS elements', async () => {
		const result = await ctx.process('<p><em>italic</em> <span>text <strong>bold</strong> more</span> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toContain('{{cms:cms-1}}')
		expect(pEntry?.text).toContain('text')
		expect(pEntry?.text).toContain('{{cms:cms-2}}')
		expect(pEntry?.text).toContain('more')
		expect(pEntry?.text).toBe('{{cms:cms-1}} text {{cms:cms-2}} more end')
	})

	test('preserves whitespace in nested structures', async () => {
		const result = await ctx.process('<p>Start <span>  before  <strong>bold</strong>  after  </span> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toMatch(/before\s+.*\s+after/)
	})

	test('handles empty intermediate containers', async () => {
		const result = await ctx.process('<p>Start <span></span> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Start  end')
	})

	test('handles intermediate container with only nested CMS element', async () => {
		const result = await ctx.process('<p>Start <span><strong>bold</strong></span> end</p>')

		const pEntry = result.entries['cms-0']
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Start {{cms:cms-1}} end')
	})

	test('h1 with br elements and mixed span types', async () => {
		const html = `<h1 class="text-4xl">
  <span class="gradient">Chytrý</span><br>
  <span class="text-black">fulfillment</span> pro váš růst
</h1>`
		const result = await ctx.process(html, {
			includeTags: null,
			markStyledSpans: true,
		})

		expect(result.html).toMatchSnapshot('marked html')
		expect(result.entries).toMatchSnapshot('manifest entries')
	})
})
