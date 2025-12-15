import { describe, expect, test } from 'bun:test'
import { processHtml } from '../../src/html-processor'

describe('Text Style Class Detection', () => {
	const createTestHtml = (classes: string) => `<p>Hello <span class="${classes}">world</span>!</p>`

	const getOptions = () => ({
		attributeName: 'data-cms-id',
		includeTags: null,
		excludeTags: [],
		includeEmptyText: false,
		generateManifest: false,
		markStyledSpans: true,
	})

	let counter = 0
	const getNextId = () => `cms-${counter++}`

	test('should mark spans with standard Tailwind colors as styled', async () => {
		counter = 0
		const html = createTestHtml('text-red-500 font-bold')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should mark spans with custom color names as styled', async () => {
		counter = 0
		const html = createTestHtml('text-brand-primary font-semibold')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should mark spans with custom background colors as styled', async () => {
		counter = 0
		const html = createTestHtml('bg-custom-purple-500')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should NOT mark spans with text-center (layout class)', async () => {
		counter = 0
		const html = createTestHtml('text-center')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should NOT mark spans with text-left (layout class)', async () => {
		counter = 0
		const html = createTestHtml('text-left font-bold')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should NOT mark spans with text-justify (layout class)', async () => {
		counter = 0
		const html = createTestHtml('text-justify')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should NOT mark spans with text-wrap (layout class)', async () => {
		counter = 0
		const html = createTestHtml('text-wrap')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should NOT mark spans with bg-fixed (layout class)', async () => {
		counter = 0
		const html = createTestHtml('bg-fixed')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should NOT mark spans with bg-cover (layout class)', async () => {
		counter = 0
		const html = createTestHtml('bg-cover')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should NOT mark spans with bg-repeat (layout class)', async () => {
		counter = 0
		const html = createTestHtml('bg-repeat')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should mark spans with only text styling classes', async () => {
		counter = 0
		const html = createTestHtml('font-bold italic underline text-red-500')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should NOT mark spans with mixed styling and layout classes', async () => {
		counter = 0
		const html = createTestHtml('font-bold text-center')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})

	test('should mark spans with text decoration classes', async () => {
		counter = 0
		const html = createTestHtml('underline decoration-wavy decoration-red-500')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should mark spans with text transform classes', async () => {
		counter = 0
		const html = createTestHtml('uppercase tracking-wide')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should mark spans with font size and line height', async () => {
		counter = 0
		const html = createTestHtml('text-lg leading-relaxed')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).toContain('data-cms-styled="true"')
	})

	test('should NOT mark spans with align- classes', async () => {
		counter = 0
		const html = createTestHtml('align-middle')
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)
		expect(result.html).not.toContain('data-cms-styled')
	})
})
