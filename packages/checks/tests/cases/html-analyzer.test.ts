import { describe, expect, test } from 'bun:test'
import { analyzeHtml } from '../../src/html-analyzer'

describe('html-analyzer', () => {
	test('extracts title', () => {
		const { pageData } = analyzeHtml('<html><head><title>Hello World</title></head><body></body></html>')
		expect(pageData.title).toEqual({ content: 'Hello World', line: 1 })
	})

	test('returns undefined for missing title', () => {
		const { pageData } = analyzeHtml('<html><head></head><body></body></html>')
		expect(pageData.title).toBeUndefined()
	})

	test('returns empty content for whitespace-only title', () => {
		const { pageData } = analyzeHtml('<html><head><title>   </title></head><body></body></html>')
		expect(pageData.title).toBeDefined()
		expect(pageData.title!.content).toBe('')
	})

	test('extracts meta description', () => {
		const { pageData } = analyzeHtml(
			'<html><head><meta name="description" content="A test page"></head><body></body></html>',
		)
		expect(pageData.metaDescription?.content).toBe('A test page')
	})

	test('extracts Open Graph tags', () => {
		const html = `<html><head>
			<meta property="og:title" content="OG Title">
			<meta property="og:description" content="OG Desc">
			<meta property="og:image" content="/img.jpg">
		</head><body></body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.openGraph.title?.content).toBe('OG Title')
		expect(pageData.openGraph.description?.content).toBe('OG Desc')
		expect(pageData.openGraph.image?.content).toBe('/img.jpg')
	})

	test('extracts canonical URL', () => {
		const { pageData } = analyzeHtml(
			'<html><head><link rel="canonical" href="https://example.com/"></head><body></body></html>',
		)
		expect(pageData.canonical?.href).toBe('https://example.com/')
	})

	test('extracts JSON-LD', () => {
		const html = `<html><head>
			<script type="application/ld+json">{"@type":"Organization","name":"Test"}</script>
		</head><body></body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.jsonLd).toHaveLength(1)
		expect(pageData.jsonLd[0]?.type).toBe('Organization')
		expect(pageData.jsonLd[0]?.valid).toBe(true)
	})

	test('reports invalid JSON-LD', () => {
		const html = `<html><head>
			<script type="application/ld+json">{invalid json}</script>
		</head><body></body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.jsonLd).toHaveLength(1)
		expect(pageData.jsonLd[0]?.valid).toBe(false)
		expect(pageData.jsonLd[0]?.error).toBeDefined()
	})

	test('extracts headings', () => {
		const html = '<html><head></head><body><h1>Title</h1><h2>Sub</h2><h3>Sub-sub</h3></body></html>'
		const { pageData } = analyzeHtml(html)
		expect(pageData.headings).toHaveLength(3)
		expect(pageData.headings[0]?.level).toBe(1)
		expect(pageData.headings[1]?.level).toBe(2)
		expect(pageData.headings[2]?.level).toBe(3)
	})

	test('extracts images with alt attributes', () => {
		const html = '<html><head></head><body><img src="/a.jpg" alt="Photo"><img src="/b.jpg"></body></html>'
		const { pageData } = analyzeHtml(html)
		expect(pageData.images).toHaveLength(2)
		expect(pageData.images[0]?.alt).toBe('Photo')
		expect(pageData.images[1]?.alt).toBeUndefined()
	})

	test('extracts html lang attribute', () => {
		const { pageData } = analyzeHtml('<html lang="en"><head></head><body></body></html>')
		expect(pageData.htmlLang).toBe('en')
	})

	test('extracts scripts with inline detection', () => {
		const html = `<html><head>
			<script src="/app.js"></script>
			<script src="/analytics.js" async></script>
			<script src="/lib.js" defer></script>
			<script>console.log('inline')</script>
		</head><body></body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.scripts).toHaveLength(4)
		expect(pageData.scripts[0]?.isAsync).toBe(false)
		expect(pageData.scripts[0]?.isDefer).toBe(false)
		expect(pageData.scripts[0]?.isInline).toBe(false)
		expect(pageData.scripts[1]?.isAsync).toBe(true)
		expect(pageData.scripts[2]?.isDefer).toBe(true)
		expect(pageData.scripts[3]?.isInline).toBe(true)
		expect(pageData.scripts[3]?.size).toBeGreaterThan(0)
	})

	test('calculates html size', () => {
		const html = '<html><head></head><body>Hello</body></html>'
		const { pageData } = analyzeHtml(html)
		expect(pageData.htmlSize).toBe(Buffer.byteLength(html, 'utf8'))
	})

	test('extracts forms and labels', () => {
		const html = `<html><head></head><body>
			<form>
				<label for="email">Email</label>
				<input type="email" id="email" name="email">
				<input type="text" name="name">
			</form>
		</body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.forms).toHaveLength(1)
		expect(pageData.forms[0]?.inputs).toHaveLength(2)
		expect(pageData.forms[0]?.inputs[0]?.hasLabel).toBe(true)
		expect(pageData.forms[0]?.inputs[1]?.hasLabel).toBe(false)
	})

	test('detects viewport meta tag', () => {
		const { pageData: without } = analyzeHtml('<html><head></head><body></body></html>')
		expect(without.hasViewport).toBe(false)

		const { pageData: withVp } = analyzeHtml(
			'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>',
		)
		expect(withVp.hasViewport).toBe(true)
	})

	test('detects noindex directive', () => {
		const { pageData: without } = analyzeHtml('<html><head></head><body></body></html>')
		expect(without.hasNoindex).toBe(false)

		const { pageData: withNoindex } = analyzeHtml(
			'<html><head><meta name="robots" content="noindex, nofollow"></head><body></body></html>',
		)
		expect(withNoindex.hasNoindex).toBe(true)
	})

	test('extracts Twitter Card tags', () => {
		const html = `<html><head>
			<meta name="twitter:card" content="summary_large_image">
			<meta name="twitter:title" content="My Title">
		</head><body></body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.twitterCard.card?.content).toBe('summary_large_image')
		expect(pageData.twitterCard.title?.content).toBe('My Title')
	})

	test('calculates inline script and style sizes', () => {
		const html = `<html><head>
			<script>var x = 1;</script>
			<style>body { color: red; }</style>
		</head><body></body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.inlineScriptBytes).toBeGreaterThan(0)
		expect(pageData.inlineStyleBytes).toBeGreaterThan(0)
	})

	test('assigns correct line numbers to duplicate elements', () => {
		const html = `<html><head></head><body>
<img src="/a.jpg" alt="first">
<img src="/a.jpg" alt="second">
</body></html>`
		const { pageData } = analyzeHtml(html)
		expect(pageData.images).toHaveLength(2)
		expect(pageData.images[0]!.line).toBe(2)
		expect(pageData.images[1]!.line).toBe(3)
	})
})
