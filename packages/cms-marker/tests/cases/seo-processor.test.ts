import { describe, expect, test } from 'bun:test'
import { processSeoFromHtml } from '../../src/seo-processor'

describe('processSeoFromHtml', () => {
	describe('title extraction', () => {
		test('extracts title content', async () => {
			const html = '<html><head><title>My Page Title</title></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.title).toBeDefined()
			expect(result.seo.title?.content).toBe('My Page Title')
		})

		test('marks title with CMS ID when markTitle is true', async () => {
			const html = '<html><head><title>My Page Title</title></head><body></body></html>'
			let counter = 0
			const result = await processSeoFromHtml(html, { markTitle: true }, () => `cms-${counter++}`)

			expect(result.titleCmsId).toBe('cms-0')
			expect(result.seo.title?.cmsId).toBe('cms-0')
			expect(result.html).toContain('data-cms-id="cms-0"')
		})

		test('does not mark title when markTitle is false', async () => {
			const html = '<html><head><title>My Page Title</title></head><body></body></html>'
			const result = await processSeoFromHtml(html, { markTitle: false })

			expect(result.titleCmsId).toBeUndefined()
			expect(result.seo.title?.cmsId).toBeUndefined()
			expect(result.html).not.toContain('data-cms-id')
		})

		test('handles empty title', async () => {
			const html = '<html><head><title></title></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.title).toBeUndefined()
		})

		test('handles missing title', async () => {
			const html = '<html><head></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.title).toBeUndefined()
		})

		test('includes source info for title', async () => {
			const html = '<html><head>\n<title>My Page Title</title>\n</head><body></body></html>'
			const result = await processSeoFromHtml(html, { sourcePath: 'src/pages/index.astro' })

			expect(result.seo.title?.sourcePath).toBe('src/pages/index.astro')
			expect(result.seo.title?.sourceLine).toBeGreaterThan(0)
			expect(result.seo.title?.sourceSnippet).toContain('<title>')
		})
	})

	describe('meta description extraction', () => {
		test('extracts meta description', async () => {
			const html = '<html><head><meta name="description" content="This is my description"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.description).toBeDefined()
			expect(result.seo.description?.content).toBe('This is my description')
			expect(result.seo.description?.name).toBe('description')
		})

		test('handles missing description', async () => {
			const html = '<html><head></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.description).toBeUndefined()
		})

		test('includes source info for description', async () => {
			const html = '<html><head><meta name="description" content="Test description"></head><body></body></html>'
			const result = await processSeoFromHtml(html, { sourcePath: 'src/pages/index.astro' })

			expect(result.seo.description?.sourcePath).toBe('src/pages/index.astro')
			expect(result.seo.description?.sourceSnippet).toContain('meta')
			expect(result.seo.description?.sourceSnippet).toContain('description')
		})
	})

	describe('keywords extraction', () => {
		test('extracts and parses meta keywords', async () => {
			const html = '<html><head><meta name="keywords" content="web, development, cms"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.keywords).toBeDefined()
			expect(result.seo.keywords?.content).toBe('web, development, cms')
			expect(result.seo.keywords?.keywords).toEqual(['web', 'development', 'cms'])
		})

		test('handles keywords with extra spaces', async () => {
			const html = '<html><head><meta name="keywords" content="  web ,  development ,  cms  "></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.keywords?.keywords).toEqual(['web', 'development', 'cms'])
		})

		test('handles empty keywords', async () => {
			const html = '<html><head><meta name="keywords" content=""></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.keywords).toBeUndefined()
		})
	})

	describe('Open Graph extraction', () => {
		test('extracts og:title', async () => {
			const html = '<html><head><meta property="og:title" content="OG Title"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.title).toBeDefined()
			expect(result.seo.openGraph?.title?.content).toBe('OG Title')
			expect(result.seo.openGraph?.title?.property).toBe('og:title')
		})

		test('extracts og:description', async () => {
			const html = '<html><head><meta property="og:description" content="OG Description"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.description?.content).toBe('OG Description')
		})

		test('extracts og:image', async () => {
			const html = '<html><head><meta property="og:image" content="/og-image.jpg"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.image?.content).toBe('/og-image.jpg')
		})

		test('extracts og:url', async () => {
			const html = '<html><head><meta property="og:url" content="https://example.com/page"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.url?.content).toBe('https://example.com/page')
		})

		test('extracts og:type', async () => {
			const html = '<html><head><meta property="og:type" content="website"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.type?.content).toBe('website')
		})

		test('extracts og:site_name', async () => {
			const html = '<html><head><meta property="og:site_name" content="My Site"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.siteName?.content).toBe('My Site')
		})

		test('extracts multiple Open Graph tags', async () => {
			const html = `
				<html><head>
					<meta property="og:title" content="OG Title">
					<meta property="og:description" content="OG Description">
					<meta property="og:image" content="/og-image.jpg">
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph?.title?.content).toBe('OG Title')
			expect(result.seo.openGraph?.description?.content).toBe('OG Description')
			expect(result.seo.openGraph?.image?.content).toBe('/og-image.jpg')
		})

		test('does not include openGraph when no OG tags present', async () => {
			const html = '<html><head></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.openGraph).toBeUndefined()
		})
	})

	describe('Twitter Card extraction', () => {
		test('extracts twitter:card', async () => {
			const html = '<html><head><meta name="twitter:card" content="summary_large_image"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard?.card?.content).toBe('summary_large_image')
		})

		test('extracts twitter:title', async () => {
			const html = '<html><head><meta name="twitter:title" content="Twitter Title"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard?.title?.content).toBe('Twitter Title')
		})

		test('extracts twitter:description', async () => {
			const html = '<html><head><meta name="twitter:description" content="Twitter Description"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard?.description?.content).toBe('Twitter Description')
		})

		test('extracts twitter:image', async () => {
			const html = '<html><head><meta name="twitter:image" content="/twitter-image.jpg"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard?.image?.content).toBe('/twitter-image.jpg')
		})

		test('extracts twitter:site', async () => {
			const html = '<html><head><meta name="twitter:site" content="@mysite"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard?.site?.content).toBe('@mysite')
		})

		test('handles twitter tags with property attribute', async () => {
			const html = '<html><head><meta property="twitter:card" content="summary"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard?.card?.content).toBe('summary')
		})

		test('does not include twitterCard when no Twitter tags present', async () => {
			const html = '<html><head></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.twitterCard).toBeUndefined()
		})
	})

	describe('canonical URL extraction', () => {
		test('extracts canonical URL', async () => {
			const html = '<html><head><link rel="canonical" href="https://example.com/canonical"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.canonical).toBeDefined()
			expect(result.seo.canonical?.href).toBe('https://example.com/canonical')
		})

		test('handles missing canonical', async () => {
			const html = '<html><head></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.canonical).toBeUndefined()
		})

		test('handles canonical without href', async () => {
			const html = '<html><head><link rel="canonical"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.canonical).toBeUndefined()
		})

		test('includes source info for canonical', async () => {
			const html = '<html><head><link rel="canonical" href="https://example.com"></head><body></body></html>'
			const result = await processSeoFromHtml(html, { sourcePath: 'src/pages/index.astro' })

			expect(result.seo.canonical?.sourcePath).toBe('src/pages/index.astro')
			expect(result.seo.canonical?.sourceSnippet).toContain('canonical')
		})
	})

	describe('robots directive extraction', () => {
		test('extracts robots meta', async () => {
			const html = '<html><head><meta name="robots" content="noindex, nofollow"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.robots).toBeDefined()
			expect(result.seo.robots?.content).toBe('noindex, nofollow')
			expect(result.seo.robots?.directives).toEqual(['noindex', 'nofollow'])
		})

		test('handles single directive', async () => {
			const html = '<html><head><meta name="robots" content="noindex"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.robots?.directives).toEqual(['noindex'])
		})

		test('handles missing robots', async () => {
			const html = '<html><head></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.robots).toBeUndefined()
		})

		test('normalizes directive case', async () => {
			const html = '<html><head><meta name="robots" content="NoIndex, NoFollow"></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.robots?.directives).toEqual(['noindex', 'nofollow'])
		})
	})

	describe('JSON-LD extraction', () => {
		test('extracts single JSON-LD block', async () => {
			const html = `
				<html><head>
					<script type="application/ld+json">
						{"@type": "Organization", "name": "My Company"}
					</script>
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html)

			expect(result.seo.jsonLd).toBeDefined()
			expect(result.seo.jsonLd).toHaveLength(1)
			expect(result.seo.jsonLd?.[0]?.type).toBe('Organization')
			expect(result.seo.jsonLd?.[0]?.data?.name).toBe('My Company')
		})

		test('extracts multiple JSON-LD blocks', async () => {
			const html = `
				<html><head>
					<script type="application/ld+json">{"@type": "Organization", "name": "Company"}</script>
					<script type="application/ld+json">{"@type": "WebPage", "name": "Home"}</script>
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html)

			expect(result.seo.jsonLd).toHaveLength(2)
			expect(result.seo.jsonLd?.[0]?.type).toBe('Organization')
			expect(result.seo.jsonLd?.[1]?.type).toBe('WebPage')
		})

		test('handles malformed JSON-LD gracefully', async () => {
			const html = `
				<html><head>
					<script type="application/ld+json">{invalid json}</script>
					<script type="application/ld+json">{"@type": "Organization", "name": "Valid"}</script>
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html)

			expect(result.seo.jsonLd).toHaveLength(1)
			expect(result.seo.jsonLd?.[0]?.type).toBe('Organization')
		})

		test('handles JSON-LD without @type', async () => {
			const html = `
				<html><head>
					<script type="application/ld+json">{"name": "No Type"}</script>
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html)

			expect(result.seo.jsonLd?.[0]?.type).toBe('Unknown')
			expect(result.seo.jsonLd?.[0]?.data?.name).toBe('No Type')
		})

		test('does not parse JSON-LD when parseJsonLd is false', async () => {
			const html = `
				<html><head>
					<script type="application/ld+json">{"@type": "Organization"}</script>
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html, { parseJsonLd: false })

			expect(result.seo.jsonLd).toBeUndefined()
		})

		test('handles empty JSON-LD script', async () => {
			const html = '<html><head><script type="application/ld+json"></script></head><body></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo.jsonLd).toBeUndefined()
		})

		test('includes source info for JSON-LD', async () => {
			const html = `
				<html><head>
					<script type="application/ld+json">{"@type": "Organization", "name": "Test"}</script>
				</head><body></body></html>
			`
			const result = await processSeoFromHtml(html, { sourcePath: 'src/pages/index.astro' })

			expect(result.seo.jsonLd?.[0]?.sourcePath).toBe('src/pages/index.astro')
			expect(result.seo.jsonLd?.[0]?.sourceSnippet).toContain('application/ld+json')
		})

		test('extracts JSON-LD from body as well', async () => {
			const html = `
				<html><head></head><body>
					<script type="application/ld+json">{"@type": "Product", "name": "Widget"}</script>
				</body></html>
			`
			const result = await processSeoFromHtml(html)

			expect(result.seo.jsonLd).toHaveLength(1)
			expect(result.seo.jsonLd?.[0]?.type).toBe('Product')
		})
	})

	describe('complete SEO extraction', () => {
		test('extracts all SEO elements from a complete page', async () => {
			const html = `
				<html>
				<head>
					<title>My Page Title</title>
					<meta name="description" content="Page description">
					<meta name="keywords" content="keyword1, keyword2">
					<meta name="robots" content="index, follow">
					<meta property="og:title" content="OG Title">
					<meta property="og:description" content="OG Description">
					<meta property="og:image" content="/og-image.jpg">
					<meta name="twitter:card" content="summary_large_image">
					<meta name="twitter:title" content="Twitter Title">
					<link rel="canonical" href="https://example.com/page">
					<script type="application/ld+json">{"@type": "WebPage", "name": "My Page"}</script>
				</head>
				<body>
					<h1>Content</h1>
				</body>
				</html>
			`
			let counter = 0
			const result = await processSeoFromHtml(
				html,
				{ markTitle: true, parseJsonLd: true, sourcePath: 'src/pages/index.astro' },
				() => `cms-${counter++}`,
			)

			// Title
			expect(result.seo.title?.content).toBe('My Page Title')
			expect(result.seo.title?.cmsId).toBe('cms-0')

			// Description
			expect(result.seo.description?.content).toBe('Page description')

			// Keywords
			expect(result.seo.keywords?.keywords).toEqual(['keyword1', 'keyword2'])

			// Robots
			expect(result.seo.robots?.directives).toEqual(['index', 'follow'])

			// Open Graph
			expect(result.seo.openGraph?.title?.content).toBe('OG Title')
			expect(result.seo.openGraph?.description?.content).toBe('OG Description')
			expect(result.seo.openGraph?.image?.content).toBe('/og-image.jpg')

			// Twitter Card
			expect(result.seo.twitterCard?.card?.content).toBe('summary_large_image')
			expect(result.seo.twitterCard?.title?.content).toBe('Twitter Title')

			// Canonical
			expect(result.seo.canonical?.href).toBe('https://example.com/page')

			// JSON-LD
			expect(result.seo.jsonLd?.[0]?.type).toBe('WebPage')
			expect(result.seo.jsonLd?.[0]?.data?.name).toBe('My Page')
		})

		test('returns empty seo object when no SEO elements present', async () => {
			const html = '<html><head></head><body><h1>Content</h1></body></html>'
			const result = await processSeoFromHtml(html)

			expect(result.seo).toEqual({})
		})
	})
})
