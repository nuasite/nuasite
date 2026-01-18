import { describe, expect, test } from 'bun:test'
import { cleanText, INLINE_STYLE_TAGS, processHtml } from '../../src/html-processor'

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
		expect(wrapperEntry?.sourceType).toBe('collection')
		expect(wrapperEntry?.collectionName).toBe('services')
		expect(wrapperEntry?.collectionSlug).toBe('test-service')
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
		expect(wrapperEntry?.sourceType).toBe('collection')
		expect(wrapperEntry?.collectionName).toBe('blog')
		expect(wrapperEntry?.collectionSlug).toBe('test-post')
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

	test('should include contentPath in manifest entry for collection wrapper', async () => {
		const html = `
			<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="10:0">
				<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="12:0" class="prose">
					<p>Markdown content</p>
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
				collectionInfo: {
					name: 'services',
					slug: '3d-tisk',
					contentPath: 'src/content/services/3d-tisk.md',
				},
			},
			getNextId,
		)

		expect(result.collectionWrapperId).toBeDefined()
		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry).toBeDefined()
		expect(wrapperEntry?.contentPath).toBe('src/content/services/3d-tisk.md')
		expect(wrapperEntry?.collectionName).toBe('services')
		expect(wrapperEntry?.collectionSlug).toBe('3d-tisk')
	})

	test('should add data-cms-markdown attribute to collection wrapper', async () => {
		const html = `
			<div data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="10:0">
				<div data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="12:0">
					<p>Markdown content</p>
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
				collectionInfo: { name: 'blog', slug: 'my-post' },
			},
			getNextId,
		)

		expect(result.collectionWrapperId).toBeDefined()
		// The wrapper element should have data-cms-markdown="true"
		expect(result.html).toContain('data-cms-markdown="true"')
	})

	test('should find collection wrapper in build mode using bodyFirstLine', async () => {
		// Build mode: no data-astro-source-file attributes, must match by content
		const html = `
			<main>
				<article>
					<div class="prose">
						<p>This is the first paragraph of the markdown body.</p>
						<p>This is the second paragraph.</p>
						<h2>A heading in markdown</h2>
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
				collectionInfo: {
					name: 'blog',
					slug: 'test-post',
					bodyFirstLine: 'This is the first paragraph of the markdown body.',
					contentPath: 'src/content/blog/test-post.md',
				},
			},
			getNextId,
		)

		expect(result.collectionWrapperId).toBeDefined()
		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry).toBeDefined()
		expect(wrapperEntry?.sourceType).toBe('collection')
		expect(wrapperEntry?.collectionName).toBe('blog')
		expect(wrapperEntry?.collectionSlug).toBe('test-post')
		expect(wrapperEntry?.contentPath).toBe('src/content/blog/test-post.md')
		// Should have data-cms-markdown on the wrapper
		expect(result.html).toContain('data-cms-markdown="true"')
	})

	test('should handle markdown syntax in bodyFirstLine matching', async () => {
		const html = `
			<main>
				<div class="content">
					<p><strong>Bold text</strong> at the start of the body.</p>
					<p>Second paragraph.</p>
				</div>
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
				collectionInfo: {
					name: 'services',
					slug: 'test',
					// In markdown this would be **Bold text**
					bodyFirstLine: '**Bold text** at the start of the body.',
				},
			},
			getNextId,
		)

		expect(result.collectionWrapperId).toBeDefined()
		expect(result.entries[result.collectionWrapperId!]?.sourceType).toBe('collection')
	})

	test('should skip inline text styling elements by default', async () => {
		const html = '<p>Hello <strong>bold</strong> and <em>italic</em> text</p>'
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

		// Only the p tag should be marked, not strong or em
		expect(result.html).toContain('<p data-cms-id')
		expect(result.html).not.toContain('<strong data-cms-id')
		expect(result.html).not.toContain('<em data-cms-id')

		// The p element's text should include the inline content
		const pEntry = Object.values(result.entries).find(e => e.tag === 'p')
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Hello bold and italic text')
	})

	test('should skip all INLINE_STYLE_TAGS elements', async () => {
		// Test a few of the inline style tags
		const html = `
			<div>
				<p><strong>bold</strong></p>
				<p><b>bold2</b></p>
				<p><em>italic</em></p>
				<p><i>italic2</i></p>
				<p><u>underline</u></p>
				<p><mark>highlight</mark></p>
				<p><code>code</code></p>
				<p><small>small</small></p>
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
			},
			getNextId,
		)

		// None of the inline style tags should have data-cms-id
		for (const tag of ['strong', 'b', 'em', 'i', 'u', 'mark', 'code', 'small']) {
			expect(result.html).not.toContain(`<${tag} data-cms-id`)
		}

		// But the p tags should have data-cms-id
		const pMatches = result.html.match(/<p data-cms-id/g)
		expect(pMatches?.length).toBe(8)
	})

	test('should mark inline style elements when skipInlineStyleTags is false', async () => {
		const html = '<p>Hello <strong>bold</strong> text</p>'
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
				skipInlineStyleTags: false,
			},
			getNextId,
		)

		// Both p and strong should be marked
		expect(result.html).toContain('<p data-cms-id')
		expect(result.html).toContain('<strong data-cms-id')
	})

	test('should skip styled spans with only text styling classes', async () => {
		const html = '<p>Hello <span class="font-bold text-red-600">styled</span> text</p>'
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

		// p should be marked, but styled span should not
		expect(result.html).toContain('<p data-cms-id')
		expect(result.html).not.toContain('<span data-cms-id')
	})

	test('should mark spans with layout classes', async () => {
		const html = '<p>Hello <span class="flex items-center">layout span</span> text</p>'
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

		// Both p and span (with layout classes) should be marked
		expect(result.html).toContain('<p data-cms-id')
		// Span with layout classes should have data-cms-id (attribute order may vary)
		expect(result.html).toMatch(/<span[^>]*data-cms-id/)
	})

	test('should mark spans without any classes', async () => {
		const html = '<p>Hello <span>plain span</span> text</p>'
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

		// Both p and plain span should be marked
		expect(result.html).toContain('<p data-cms-id')
		expect(result.html).toContain('<span data-cms-id')
	})

	test('should preserve inline elements in parent text for manifest', async () => {
		const html = '<p>Start <strong>middle</strong> end</p>'
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

		// Only p should have an entry
		expect(Object.keys(result.entries)).toHaveLength(1)
		const pEntry = Object.values(result.entries)[0]
		expect(pEntry?.tag).toBe('p')
		// Text should include the inline element's text
		expect(pEntry?.text).toBe('Start middle end')
		// No child CMS IDs since strong is not marked
		expect(pEntry?.childCmsIds).toBeUndefined()
	})

	test('should populate html field for elements with inline style elements', async () => {
		const html = '<p>Text with <strong>bold</strong> and <em>italic</em> content</p>'
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

		const pEntry = Object.values(result.entries).find(e => e.tag === 'p')
		expect(pEntry).toBeDefined()
		// text should be plain text
		expect(pEntry?.text).toBe('Text with bold and italic content')
		// html should contain the inline HTML elements
		expect(pEntry?.html).toBe('Text with <strong>bold</strong> and <em>italic</em> content')
	})

	test('should not populate html field for elements without inline style elements', async () => {
		const html = '<p>Plain text without any styling</p>'
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

		const pEntry = Object.values(result.entries).find(e => e.tag === 'p')
		expect(pEntry).toBeDefined()
		expect(pEntry?.text).toBe('Plain text without any styling')
		// html should be undefined for plain text
		expect(pEntry?.html).toBeUndefined()
	})
})

describe('color class extraction', () => {
	test('should extract color classes from elements with bg color', async () => {
		const html = '<button class="px-4 py-2 bg-blue-500 text-white rounded">Click me</button>'
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

		const buttonEntry = Object.values(result.entries).find(e => e.tag === 'button')
		expect(buttonEntry).toBeDefined()
		expect(buttonEntry?.colorClasses).toBeDefined()
		expect(buttonEntry?.colorClasses?.bg).toBe('bg-blue-500')
		expect(buttonEntry?.colorClasses?.text).toBe('text-white')
	})

	test('should extract hover color classes', async () => {
		const html = '<button class="bg-blue-500 hover:bg-blue-600 text-white hover:text-gray-100">Hover me</button>'
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

		const buttonEntry = Object.values(result.entries).find(e => e.tag === 'button')
		expect(buttonEntry).toBeDefined()
		expect(buttonEntry?.colorClasses?.bg).toBe('bg-blue-500')
		expect(buttonEntry?.colorClasses?.hoverBg).toBe('hover:bg-blue-600')
		expect(buttonEntry?.colorClasses?.text).toBe('text-white')
		expect(buttonEntry?.colorClasses?.hoverText).toBe('hover:text-gray-100')
	})

	test('should extract border color classes', async () => {
		const html = '<div class="border border-gray-300 bg-white">Content</div>'
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

		const divEntry = Object.values(result.entries).find(e => e.tag === 'div')
		expect(divEntry).toBeDefined()
		expect(divEntry?.colorClasses?.border).toBe('border-gray-300')
		expect(divEntry?.colorClasses?.bg).toBe('bg-white')
	})

	test('should include all color classes in allColorClasses array', async () => {
		const html = '<button class="bg-blue-500 text-white border-blue-600 hover:bg-blue-600">Button</button>'
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

		const buttonEntry = Object.values(result.entries).find(e => e.tag === 'button')
		expect(buttonEntry).toBeDefined()
		expect(buttonEntry?.colorClasses?.allColorClasses).toContain('bg-blue-500')
		expect(buttonEntry?.colorClasses?.allColorClasses).toContain('text-white')
		expect(buttonEntry?.colorClasses?.allColorClasses).toContain('border-blue-600')
		expect(buttonEntry?.colorClasses?.allColorClasses).toContain('hover:bg-blue-600')
	})

	test('should not include colorClasses for elements without color classes', async () => {
		const html = '<p class="text-lg font-bold">Text without colors</p>'
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

		const pEntry = Object.values(result.entries).find(e => e.tag === 'p')
		expect(pEntry).toBeDefined()
		expect(pEntry?.colorClasses).toBeUndefined()
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
