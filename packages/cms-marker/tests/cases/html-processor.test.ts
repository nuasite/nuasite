import { describe, expect, test } from 'bun:test'
import { cleanText, processHtml } from '../../src/html-processor'

describe('processHtml', () => {
	test('should add CMS IDs to qualifying elements', async () => {
		const html = '<div><h1>Hello</h1><p>World</p></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: ['html', 'head', 'body', 'script', 'style'],
				includeEmptyText: false,
				generateManifest: true,
			},
			getNextId,
		)

		expect(result.html).toContain('data-cms-id="cms-0"')
		expect(result.html).toContain('data-cms-id="cms-1"')
		expect(result.html).toContain('data-cms-id="cms-2"')
	})

	test('should exclude specified tags', async () => {
		const html = '<div><script>alert("hi")</script><p>Text</p></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: ['script'],
				includeEmptyText: false,
				generateManifest: false,
			},
			getNextId,
		)

		expect(result.html).not.toContain('<script data-cms-id')
		expect(result.html).toContain('<p data-cms-id')
	})

	test('should skip empty elements when includeEmptyText is false', async () => {
		const html = '<div><p></p><p>Text</p></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
			},
			getNextId,
		)

		const matches = result.html.match(/data-cms-id/g)
		expect(matches?.length).toBe(2) // div and p with text
	})

	test('should include empty elements when includeEmptyText is true', async () => {
		const html = '<div><p></p><p>Text</p></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: true,
				generateManifest: false,
			},
			getNextId,
		)

		const matches = result.html.match(/data-cms-id/g)
		expect(matches?.length).toBe(3) // div and both p tags
	})

	test('should only include specified tags when includeTags is set', async () => {
		const html = '<div><h1>Title</h1><p>Text</p></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: ['h1'],
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
			},
			getNextId,
		)

		expect(result.html).toContain('<h1 data-cms-id')
		expect(result.html).not.toContain('<div data-cms-id')
		expect(result.html).not.toContain('<p data-cms-id')
	})

	test('should not re-mark elements that already have the attribute', async () => {
		const html = '<div data-cms-id="existing"><p>Text</p></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
			},
			getNextId,
		)

		expect(result.html).toContain('data-cms-id="existing"')
		expect(result.html).toContain('data-cms-id="cms-0"') // Only the p tag gets new ID
	})

	test('should generate manifest entries', async () => {
		const html = '<h1>Hello World</h1>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: true,
			},
			getNextId,
			'src/test.astro',
		)

		expect(Object.keys(result.entries)).toHaveLength(1)
		expect(result.entries['cms-0']).toMatchObject({
			id: 'cms-0',
			tag: 'h1',
			text: 'Hello World',
			sourcePath: 'src/test.astro',
		})
	})

	test('should handle nested CMS elements with placeholders', async () => {
		const html = '<h1>Start <span>nested</span> end</h1>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: true,
			},
			getNextId,
		)

		expect(result.entries['cms-0']?.text).toContain('{{cms:cms-1}}')
		expect(result.entries['cms-0']?.childCmsIds).toContain('cms-1')
	})

	test('should skip pure container elements', async () => {
		const html = '<div><h1>Title</h1></div>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: true,
			},
			getNextId,
		)

		// div should not be in manifest (pure container)
		// only h1 should be in manifest
		expect(Object.keys(result.entries)).toHaveLength(1)
		expect(result.entries['cms-1']).toBeDefined()
		expect(result.entries['cms-0']).toBeUndefined()
	})

	test('should mark spans with text-only Tailwind classes as styled', async () => {
		const html = '<p>Hello <span class="font-bold text-red-600">world</span>!</p>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				markStyledSpans: true,
			},
			getNextId,
		)

		expect(result.html).toContain('data-cms-styled="true"')
		expect(result.html).toContain('class="font-bold text-red-600"')
	})

	test('should not mark spans with layout classes as styled', async () => {
		const html = '<p>Hello <span class="flex items-center font-bold">world</span>!</p>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				markStyledSpans: true,
			},
			getNextId,
		)

		// Should NOT have data-cms-styled because 'flex' and 'items-center' are layout classes
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should mark spans with italic and underline classes as styled', async () => {
		const html = '<p>Hello <span class="italic underline">world</span>!</p>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				markStyledSpans: true,
			},
			getNextId,
		)

		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should mark spans with background highlight classes as styled', async () => {
		const html = '<p>Hello <span class="bg-yellow-200">world</span>!</p>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				markStyledSpans: true,
			},
			getNextId,
		)

		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should not mark spans without class attribute', async () => {
		const html = '<p>Hello <span>world</span>!</p>'
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				markStyledSpans: true,
			},
			getNextId,
		)

		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should skip elements without source attributes when skipMarkdownContent is true', async () => {
		// Simulating HTML with mixed template and markdown-rendered content
		// Template elements have data-astro-source-file, markdown content doesn't
		const html = `
			<div data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0">
				<h1 data-astro-source-file="src/pages/test.astro" data-astro-source-line="6:0">Template Title</h1>
				<div>
					<p>Markdown paragraph one</p>
					<p>Markdown paragraph two</p>
					<h3>Markdown heading</h3>
				</div>
			</div>
		`
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				skipMarkdownContent: true,
			},
			getNextId,
		)

		// Template elements should be marked
		expect(result.html).toContain('<div data-cms-id="cms-0"')
		expect(result.html).toContain('<h1 data-cms-id="cms-1"')

		// Markdown-rendered elements (no source file) should NOT be marked
		expect(result.html).not.toContain('<p data-cms-id')
		expect(result.html).not.toContain('<h3 data-cms-id')
	})

	test('should mark all elements when skipMarkdownContent is false', async () => {
		const html = `
			<div data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0">
				<h1 data-astro-source-file="src/pages/test.astro" data-astro-source-line="6:0">Template Title</h1>
				<div>
					<p>Markdown paragraph</p>
				</div>
			</div>
		`
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: false,
				skipMarkdownContent: false,
			},
			getNextId,
		)

		// All elements should be marked
		expect(result.html).toContain('<div data-cms-id')
		expect(result.html).toContain('<h1 data-cms-id')
		expect(result.html).toContain('<p data-cms-id')
	})

	test('should mark collection wrapper element when collectionInfo is provided', async () => {
		const html = `
			<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="10:0">
				<h1 data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="11:0">Title</h1>
				<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="12:0" class="prose">
					<p>Markdown content</p>
					<h2>Another heading</h2>
				</div>
			</div>
		`
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: true,
				skipMarkdownContent: true,
				collectionInfo: { name: 'services', slug: 'test-service' },
			},
			getNextId,
		)

		// Should have collection wrapper marked with standard data-cms-id
		expect(result.collectionWrapperId).toBeDefined()
		expect(result.html).toContain(`data-cms-id="${result.collectionWrapperId}"`)
		
		// Collection info should be in the manifest entry, not on the HTML
		expect(result.html).not.toContain('data-cms-collection-name')
		expect(result.html).not.toContain('data-cms-collection-slug')
		
		// Manifest entry should have collection info
		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry).toBeDefined()
		expect(wrapperEntry.sourceType).toBe('collection')
		expect(wrapperEntry.collectionName).toBe('services')
		expect(wrapperEntry.collectionSlug).toBe('test-service')
	})

	test('should mark the innermost wrapper element containing markdown', async () => {
		const html = `
			<main data-astro-source-file="src/layouts/layout.astro" data-astro-source-line="5:0">
				<article data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="15:0">
					<div data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="16:0" class="prose">
						<p>Markdown paragraph</p>
					</div>
				</article>
			</main>
		`
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: true,
				collectionInfo: { name: 'blog', slug: 'test-post' },
			},
			getNextId,
		)

		// The innermost wrapper (div.prose) should be marked with data-cms-id
		expect(result.collectionWrapperId).toBeDefined()
		expect(result.html).toContain('class="prose"')
		
		// The div with prose class should have the data-cms-id attribute
		expect(result.html).toMatch(/class="prose"[^>]*data-cms-id/)
		
		// Manifest entry for wrapper should have collection info
		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry).toBeDefined()
		expect(wrapperEntry.sourceType).toBe('collection')
		expect(wrapperEntry.collectionName).toBe('blog')
		expect(wrapperEntry.collectionSlug).toBe('test-post')
	})

	test('should not mark collection wrapper when collectionInfo is not provided', async () => {
		const html = `
			<div data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0">
				<p>Regular content</p>
			</div>
		`
		let counter = 0
		const getNextId = () => `cms-${counter++}`

		const result = await processHtml(
			html,
			'test.html',
			{
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: [],
				includeEmptyText: false,
				generateManifest: true,
			},
			getNextId,
		)

		expect(result.collectionWrapperId).toBeUndefined()
		// No entry should have collection sourceType
		for (const entry of Object.values(result.entries)) {
			expect(entry.sourceType).not.toBe('collection')
		}
	})
})

describe('cleanText', () => {
	test('should normalize whitespace', () => {
		expect(cleanText('  hello   world  ')).toBe('hello world')
	})

	test('should convert to lowercase', () => {
		expect(cleanText('Hello World')).toBe('hello world')
	})

	test('should handle newlines', () => {
		expect(cleanText('hello\n\nworld')).toBe('hello world')
	})

	test('should handle tabs', () => {
		expect(cleanText('hello\t\tworld')).toBe('hello world')
	})
})
