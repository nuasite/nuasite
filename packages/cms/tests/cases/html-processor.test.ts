import { describe, expect, test } from 'bun:test'
import { cleanText } from '../../src/html-processor'
import {
	cmsDescribe,
	countMarkedElements,
	expectAllMarked,
	expectEntry,
	expectEntryCount,
	expectMarked,
	expectNoneMarked,
	expectNotMarked,
	expectNotStyled,
	expectStyled,
	getEntryByTag,
	html,
} from '../utils'

cmsDescribe('processHtml', { generateManifest: true }, (ctx) => {
	test('adds CMS IDs to qualifying elements', async () => {
		const input = '<div><h1>Hello</h1><p>World</p></div>'
		const result = await ctx.process(input, { excludeTags: ['html', 'head', 'body', 'script', 'style'] })

		expectMarked(result, 'h1', 'cms-0')
		expectMarked(result, 'p', 'cms-1')
		expectNotMarked(result, 'div')
	})

	test('excludes specified tags', async () => {
		const input = '<div><script>alert("hi")</script><p>Text</p></div>'
		const result = await ctx.process(input, { excludeTags: ['script'] })

		expectNotMarked(result, 'script')
		expectMarked(result, 'p')
	})

	test('skips empty elements when includeEmptyText is false', async () => {
		const input = '<div><p></p><p>Text</p></div>'
		const result = await ctx.process(input)

		expect(countMarkedElements(result)).toBe(1)
	})

	test('includes empty elements when includeEmptyText is true', async () => {
		const input = '<div><p></p><p>Text</p></div>'
		const result = await ctx.process(input, { includeEmptyText: true })

		expect(countMarkedElements(result)).toBe(2)
	})

	test('only includes specified tags when includeTags is set', async () => {
		const input = '<div><h1>Title</h1><p>Text</p></div>'
		const result = await ctx.process(input, { includeTags: ['h1'] })

		expectMarked(result, 'h1')
		expectNoneMarked(result, ['div', 'p'])
	})

	test('does not re-mark elements that already have the attribute', async () => {
		const input = '<div data-cms-id="existing"><p>Text</p></div>'
		const result = await ctx.process(input)

		expect(result.html).toContain('data-cms-id="existing"')
		expect(result.html).toContain('data-cms-id="cms-0"')
	})

	test('generates manifest entries', async () => {
		const input = '<h1>Hello World</h1>'
		const result = await ctx.process(input)

		expectEntryCount(result, 1)
		expectEntry(result, 'cms-0', {
			id: 'cms-0',
			tag: 'h1',
			text: 'Hello World',
		})
	})

	test('handles nested CMS elements with placeholders', async () => {
		const input = '<h1>Start <span class="flex">nested</span> end</h1>'
		const result = await ctx.process(input)

		expect(result.entries['cms-0']?.text).toContain('{{cms:cms-1}}')
		expect(result.entries['cms-0']?.childCmsIds).toContain('cms-1')
	})

	test('skips pure container elements', async () => {
		const input = '<div><h1>Title</h1></div>'
		const result = await ctx.process(input)

		expectEntryCount(result, 1)
		expect(result.entries['cms-0']).toBeDefined()
		expectNotMarked(result, 'div')
	})
})

cmsDescribe('styled spans', { markStyledSpans: true }, (ctx) => {
	test('marks spans with text-only Tailwind classes as styled', async () => {
		const input = '<p>Hello <span class="font-bold text-red-600">world</span>!</p>'
		const result = await ctx.process(input)

		expectStyled(result)
		expect(result.html).toContain('class="font-bold text-red-600"')
	})

	test('does not mark spans with layout classes as styled', async () => {
		const input = '<p>Hello <span class="flex items-center font-bold">world</span>!</p>'
		const result = await ctx.process(input)

		expectNotStyled(result)
	})

	test('marks spans with italic and underline classes as styled', async () => {
		const input = '<p>Hello <span class="italic underline">world</span>!</p>'
		const result = await ctx.process(input)

		expectStyled(result)
	})

	test('marks spans with background highlight classes as styled', async () => {
		const input = '<p>Hello <span class="bg-yellow-200">world</span>!</p>'
		const result = await ctx.process(input)

		expectStyled(result)
	})

	test('does not mark spans without class attribute', async () => {
		const input = '<p>Hello <span>world</span>!</p>'
		const result = await ctx.process(input)

		expectNotStyled(result)
	})
})

cmsDescribe('markdown content handling', {}, (ctx) => {
	test('skips elements without source attributes when skipMarkdownContent is true', async () => {
		const input = `
			<div data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0">
				<h1 data-astro-source-file="src/pages/test.astro" data-astro-source-line="6:0">Template Title</h1>
				<div>
					<p>Markdown paragraph one</p>
					<p>Markdown paragraph two</p>
					<h3>Markdown heading</h3>
				</div>
			</div>
		`
		const result = await ctx.process(input, { skipMarkdownContent: true })

		expectMarked(result, 'div', 'cms-0')
		expectMarked(result, 'h1', 'cms-1')
		expectNoneMarked(result, ['p', 'h3'])
	})

	test('marks all elements when skipMarkdownContent is false', async () => {
		const input = `
			<div data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0">
				<h1 data-astro-source-file="src/pages/test.astro" data-astro-source-line="6:0">Template Title</h1>
				<div>
					<p>Markdown paragraph</p>
				</div>
			</div>
		`
		const result = await ctx.process(input, { skipMarkdownContent: false })

		expectNotMarked(result, 'div')
		expectAllMarked(result, ['h1', 'p'])
	})
})

cmsDescribe('collection wrapper', { generateManifest: true }, (ctx) => {
	test('marks collection wrapper element when collectionInfo is provided', async () => {
		const input = `
			<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="10:0">
				<h1 data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="11:0">Title</h1>
				<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="12:0" class="prose">
					<p>Markdown content</p>
					<h2>Another heading</h2>
				</div>
			</div>
		`
		const result = await ctx.process(input, {
			skipMarkdownContent: true,
			collectionInfo: { name: 'services', slug: 'test-service' },
		})

		expect(result.collectionWrapperId).toBeDefined()
		expect(result.html).toContain(`data-cms-id="${result.collectionWrapperId}"`)
		expect(result.html).not.toContain('data-cms-collection-name')
		expect(result.html).not.toContain('data-cms-collection-slug')

		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry).toBeDefined()
		expect(wrapperEntry?.collectionName).toBe('services')
		expect(wrapperEntry?.collectionSlug).toBe('test-service')
	})

	test('marks the innermost wrapper element containing markdown', async () => {
		const input = `
			<main data-astro-source-file="src/layouts/layout.astro" data-astro-source-line="5:0">
				<article data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="15:0">
					<div data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="16:0" class="prose">
						<p>Markdown paragraph</p>
					</div>
				</article>
			</main>
		`
		const result = await ctx.process(input, {
			collectionInfo: { name: 'blog', slug: 'test-post' },
		})

		expect(result.collectionWrapperId).toBeDefined()
		expect(result.html).toContain('class="prose"')
		expect(result.html).toMatch(/class="prose"[^>]*data-cms-id/)

		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry?.collectionName).toBe('blog')
		expect(wrapperEntry?.collectionSlug).toBe('test-post')
	})

	test('does not mark collection wrapper when collectionInfo is not provided', async () => {
		const input = `
			<div data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0">
				<p>Regular content</p>
			</div>
		`
		const result = await ctx.process(input)

		expect(result.collectionWrapperId).toBeUndefined()
		for (const entry of Object.values(result.entries)) {
			expect(entry.collectionName).toBeUndefined()
		}
	})

	test('includes contentPath in manifest entry for collection wrapper', async () => {
		const input = `
			<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="10:0">
				<div data-astro-source-file="src/pages/services/[slug].astro" data-astro-source-line="12:0" class="prose">
					<p>Markdown content</p>
				</div>
			</div>
		`
		const result = await ctx.process(input, {
			collectionInfo: {
				name: 'services',
				slug: '3d-tisk',
				contentPath: 'src/content/services/3d-tisk.md',
			},
		})

		expect(result.collectionWrapperId).toBeDefined()
		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry?.contentPath).toBe('src/content/services/3d-tisk.md')
		expect(wrapperEntry?.collectionName).toBe('services')
		expect(wrapperEntry?.collectionSlug).toBe('3d-tisk')
	})

	test('adds data-cms-markdown attribute to collection wrapper', async () => {
		const input = `
			<div data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="10:0">
				<div data-astro-source-file="src/pages/blog/[slug].astro" data-astro-source-line="12:0">
					<p>Markdown content</p>
				</div>
			</div>
		`
		const result = await ctx.process(input, {
			collectionInfo: { name: 'blog', slug: 'my-post' },
		})

		expect(result.collectionWrapperId).toBeDefined()
		expect(result.html).toContain('data-cms-markdown="true"')
	})

	test('finds collection wrapper in build mode using bodyFirstLine', async () => {
		const input = `
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
		const result = await ctx.process(input, {
			collectionInfo: {
				name: 'blog',
				slug: 'test-post',
				bodyFirstLine: 'This is the first paragraph of the markdown body.',
				contentPath: 'src/content/blog/test-post.md',
			},
		})

		expect(result.collectionWrapperId).toBeDefined()
		const wrapperEntry = result.entries[result.collectionWrapperId!]
		expect(wrapperEntry?.collectionName).toBe('blog')
		expect(wrapperEntry?.collectionSlug).toBe('test-post')
		expect(wrapperEntry?.contentPath).toBe('src/content/blog/test-post.md')
		expect(result.html).toContain('data-cms-markdown="true"')
	})

	test('handles markdown syntax in bodyFirstLine matching', async () => {
		const input = `
			<main>
				<div class="content">
					<p><strong>Bold text</strong> at the start of the body.</p>
					<p>Second paragraph.</p>
				</div>
			</main>
		`
		const result = await ctx.process(input, {
			collectionInfo: {
				name: 'services',
				slug: 'test',
				bodyFirstLine: '**Bold text** at the start of the body.',
			},
		})

		expect(result.collectionWrapperId).toBeDefined()
		expect(result.entries[result.collectionWrapperId!]?.collectionName).toBeDefined()
	})
})

cmsDescribe('inline style tags', { generateManifest: true }, (ctx) => {
	test('skips inline text styling elements by default', async () => {
		const input = '<p>Hello <strong>bold</strong> and <em>italic</em> text</p>'
		const result = await ctx.process(input)

		expectMarked(result, 'p')
		expectNoneMarked(result, ['strong', 'em'])

		const pEntry = getEntryByTag(result, 'p')
		expect(pEntry?.text).toBe('Hello bold and italic text')
	})

	test('skips all INLINE_STYLE_TAGS elements', async () => {
		const input = `
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
		const result = await ctx.process(input)

		expectNoneMarked(result, ['strong', 'b', 'em', 'i', 'u', 'mark', 'code', 'small'])

		const pMatches = result.html.match(/<p data-cms-id/g)
		expect(pMatches?.length).toBe(8)
	})

	test('marks inline style elements when skipInlineStyleTags is false', async () => {
		const input = '<p>Hello <strong>bold</strong> text</p>'
		const result = await ctx.process(input, { skipInlineStyleTags: false })

		expectAllMarked(result, ['p', 'strong'])
	})

	test('skips styled spans with only text styling classes', async () => {
		const input = '<p>Hello <span class="font-bold text-red-600">styled</span> text</p>'
		const result = await ctx.process(input)

		expectMarked(result, 'p')
		expectNotMarked(result, 'span')
	})

	test('marks spans with layout classes', async () => {
		const input = '<p>Hello <span class="flex items-center">layout span</span> text</p>'
		const result = await ctx.process(input)

		expectMarked(result, 'p')
		expect(result.html).toMatch(/<span[^>]*data-cms-id/)
	})

	test('skips bare spans without any classes', async () => {
		const input = '<p>Hello <span>plain span</span> text</p>'
		const result = await ctx.process(input)

		expectMarked(result, 'p')
		expectNotMarked(result, 'span')
	})

	test('preserves inline elements in parent text for manifest', async () => {
		const input = '<p>Start <strong>middle</strong> end</p>'
		const result = await ctx.process(input)

		expectEntryCount(result, 1)
		const pEntry = Object.values(result.entries)[0]
		expect(pEntry?.tag).toBe('p')
		expect(pEntry?.text).toBe('Start middle end')
		expect(pEntry?.childCmsIds).toBeUndefined()
	})

	test('populates html field for elements with inline style elements', async () => {
		const input = '<p>Text with <strong>bold</strong> and <em>italic</em> content</p>'
		const result = await ctx.process(input)

		const pEntry = getEntryByTag(result, 'p')
		expect(pEntry?.text).toBe('Text with bold and italic content')
		expect(pEntry?.html).toBe('Text with <strong>bold</strong> and <em>italic</em> content')
	})

	test('does not populate html field for elements without inline style elements', async () => {
		const input = '<p>Plain text without any styling</p>'
		const result = await ctx.process(input)

		const pEntry = getEntryByTag(result, 'p')
		expect(pEntry?.text).toBe('Plain text without any styling')
		expect(pEntry?.html).toBeUndefined()
	})
})

cmsDescribe('color class extraction', { generateManifest: true }, (ctx) => {
	test('extracts color classes from elements with bg color', async () => {
		const result = await ctx.process(html.button('Click me', 'px-4 py-2 bg-blue-500 text-white rounded'))

		const buttonEntry = getEntryByTag(result, 'button')
		expect(buttonEntry?.colorClasses).toBeDefined()
		expect(buttonEntry?.colorClasses?.bg?.value).toBe('bg-blue-500')
		expect(buttonEntry?.colorClasses?.text?.value).toBe('text-white')
	})

	test('extracts hover color classes', async () => {
		const result = await ctx.process(
			html.button('Hover me', 'bg-blue-500 hover:bg-blue-600 text-white hover:text-gray-100'),
		)

		const buttonEntry = getEntryByTag(result, 'button')
		expect(buttonEntry?.colorClasses?.bg?.value).toBe('bg-blue-500')
		expect(buttonEntry?.colorClasses?.hoverBg?.value).toBe('hover:bg-blue-600')
		expect(buttonEntry?.colorClasses?.text?.value).toBe('text-white')
		expect(buttonEntry?.colorClasses?.hoverText?.value).toBe('hover:text-gray-100')
	})

	test('extracts border color classes', async () => {
		const result = await ctx.process('<div class="border border-gray-300 bg-white">Content</div>')

		const divEntry = getEntryByTag(result, 'div')
		expect(divEntry?.colorClasses?.border?.value).toBe('border-gray-300')
		expect(divEntry?.colorClasses?.bg?.value).toBe('bg-white')
	})

	test('extracts all color classes as flat Attribute keys', async () => {
		const result = await ctx.process(
			html.button('Button', 'bg-blue-500 text-white border-blue-600 hover:bg-blue-600'),
		)

		const buttonEntry = getEntryByTag(result, 'button')
		expect(buttonEntry?.colorClasses?.bg?.value).toBe('bg-blue-500')
		expect(buttonEntry?.colorClasses?.text?.value).toBe('text-white')
		expect(buttonEntry?.colorClasses?.border?.value).toBe('border-blue-600')
		expect(buttonEntry?.colorClasses?.hoverBg?.value).toBe('hover:bg-blue-600')
	})

	test('does not include colorClasses for elements without color classes', async () => {
		const result = await ctx.process(html.p('Text without colors', 'p-4 mx-auto'))

		const pEntry = getEntryByTag(result, 'p')
		expect(pEntry?.colorClasses).toBeUndefined()
	})
})

describe('cleanText', () => {
	test('normalizes whitespace', () => {
		expect(cleanText('  hello   world  ')).toBe('hello world')
	})

	test('converts to lowercase', () => {
		expect(cleanText('Hello World')).toBe('hello world')
	})

	test('handles newlines', () => {
		expect(cleanText('hello\n\nworld')).toBe('hello world')
	})

	test('handles tabs', () => {
		expect(cleanText('hello\t\tworld')).toBe('hello world')
	})
})

cmsDescribe('SEO integration', { generateManifest: true }, (ctx) => {
	test('includes SEO data in process result', async () => {
		const input = `
			<html>
			<head>
				<title>Test Page</title>
				<meta name="description" content="Test description">
				<meta property="og:title" content="OG Test">
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true } })

		expect(result.seo).toBeDefined()
		expect(result.seo?.title?.content).toBe('Test Page')
		expect(result.seo?.description?.content).toBe('Test description')
		expect(result.seo?.openGraph?.title?.content).toBe('OG Test')
	})

	test('title gets CMS ID when markTitle is enabled', async () => {
		const input = `
			<html>
			<head><title>My Title</title></head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true, markTitle: true } })

		expect(result.seo?.title?.id).toBeDefined()
		expect(result.html).toContain(`data-cms-id="${result.seo?.title?.id}"`)

		// Title should also be in entries
		const titleEntry = result.entries[result.seo?.title?.id || '']
		expect(titleEntry).toBeDefined()
		expect(titleEntry?.tag).toBe('title')
		expect(titleEntry?.text).toBe('My Title')
	})

	test('SEO disabled via options', async () => {
		const input = `
			<html>
			<head>
				<title>Test Page</title>
				<meta name="description" content="Test description">
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: false } })

		// SEO data should be undefined when tracking is disabled
		expect(result.seo).toBeUndefined()
		// But regular elements in body should still be marked
		expect(result.html).toContain('data-cms-id')
		expectMarked(result, 'h1')
	})

	test('extracts canonical URL', async () => {
		const input = `
			<html>
			<head>
				<title>Page</title>
				<link rel="canonical" href="https://example.com/page">
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true } })

		expect(result.seo?.canonical?.href).toBe('https://example.com/page')
	})

	test('extracts JSON-LD when parseJsonLd is enabled', async () => {
		const input = `
			<html>
			<head>
				<title>Page</title>
				<script type="application/ld+json">{"@type": "Organization", "name": "Test Org"}</script>
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true, parseJsonLd: true } })

		expect(result.seo?.jsonLd).toHaveLength(1)
		expect(result.seo?.jsonLd?.[0]?.type).toBe('Organization')
		expect(result.seo?.jsonLd?.[0]?.data?.name).toBe('Test Org')
	})

	test('does not extract JSON-LD when parseJsonLd is disabled', async () => {
		const input = `
			<html>
			<head>
				<title>Page</title>
				<script type="application/ld+json">{"@type": "Organization"}</script>
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true, parseJsonLd: false } })

		expect(result.seo?.jsonLd).toBeUndefined()
	})

	test('extracts Twitter Card metadata', async () => {
		const input = `
			<html>
			<head>
				<title>Page</title>
				<meta name="twitter:card" content="summary_large_image">
				<meta name="twitter:title" content="Twitter Title">
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true } })

		expect(result.seo?.twitterCard?.card?.content).toBe('summary_large_image')
		expect(result.seo?.twitterCard?.title?.content).toBe('Twitter Title')
	})

	test('extracts keywords and parses them into array', async () => {
		const input = `
			<html>
			<head>
				<title>Page</title>
				<meta name="keywords" content="web, development, astro">
			</head>
			<body><h1>Content</h1></body>
			</html>
		`
		const result = await ctx.process(input, { seo: { trackSeo: true } })

		expect(result.seo?.keywords?.content).toBe('web, development, astro')
		expect(result.seo?.keywords?.keywords).toEqual(['web', 'development', 'astro'])
	})
})

cmsDescribe('processHtml Snapshots', { generateManifest: true }, (ctx) => {
	test('basic document with headings and paragraphs', async () => {
		const result = await ctx.process(`
			<article>
				<h1>Main Title</h1>
				<p>First paragraph with some text.</p>
				<h2>Subtitle</h2>
				<p>Second paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
			</article>
		`)

		expect(result.html).toMatchSnapshot('html')
		expect(result.entries).toMatchSnapshot('entries')
	})

	test('elements with color classes', async () => {
		const result = await ctx.process(`
			<div>
				<button class="bg-blue-500 text-white hover:bg-blue-600 px-4 py-2">Primary</button>
				<button class="bg-gray-200 text-gray-800 border border-gray-300">Secondary</button>
				<a class="text-blue-600 hover:text-blue-800 underline" href="#">Link</a>
			</div>
		`)

		expect(result.html).toMatchSnapshot('html')
		expect(result.entries).toMatchSnapshot('entries')
	})
})
