import { expect, test } from 'bun:test'
import { cmsDescribe, expectNotStyled, expectStyled } from '../utils'

cmsDescribe('Text Style Class Detection', { markStyledSpans: true }, (ctx) => {
	const createTestHtml = (classes: string) => `<p>Hello <span class="${classes}">world</span>!</p>`

	// Classes that SHOULD be marked as styled
	const styledCases = [
		['text-red-500 font-bold', 'standard Tailwind colors'],
		['text-brand-primary font-semibold', 'custom color names'],
		['bg-custom-purple-500', 'custom background colors'],
		['font-bold italic underline text-red-500', 'only text styling classes'],
		['underline decoration-wavy decoration-red-500', 'text decoration classes'],
		['uppercase tracking-wide', 'text transform classes'],
		['text-lg leading-relaxed', 'font size and line height'],
	] as const

	// Classes that should NOT be marked as styled (layout classes)
	const layoutCases = [
		['text-center', 'text-center'],
		['text-left font-bold', 'text-left'],
		['text-justify', 'text-justify'],
		['text-wrap', 'text-wrap'],
		['bg-fixed', 'bg-fixed'],
		['bg-cover', 'bg-cover'],
		['bg-repeat', 'bg-repeat'],
		['font-bold text-center', 'mixed styling and layout'],
		['align-middle', 'align- classes'],
	] as const

	for (const [classes, description] of styledCases) {
		test(`marks as styled: ${description}`, async () => {
			const result = await ctx.process(createTestHtml(classes))
			expectStyled(result)
		})
	}

	for (const [classes, description] of layoutCases) {
		test(`does NOT mark as styled (layout): ${description}`, async () => {
			const result = await ctx.process(createTestHtml(classes))
			expectNotStyled(result)
		})
	}
})
