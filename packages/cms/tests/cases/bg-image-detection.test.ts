import { expect, test } from 'bun:test'
import { cmsDescribe, countMarkedElements, expectMarked, expectNotMarked, getEntryByTag } from '../utils'

cmsDescribe('background image detection', { generateManifest: true }, (ctx) => {
	test('marks element with bg-[url()] class with data-cms-bg-img attribute', async () => {
		const input =
			`<div class="bg-[url('/test.png')] bg-cover bg-center" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><p>Content</p></div>`
		const result = await ctx.process(input)

		expect(result.html).toContain('data-cms-bg-img')
	})

	test('sets data-cms-bg-img="true" on marked elements', async () => {
		const input = `<div class="bg-[url('/test.png')]" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><p>Content</p></div>`
		const result = await ctx.process(input)

		expect(result.html).toContain('data-cms-bg-img="true"')
	})

	test('creates manifest entry with backgroundImage metadata', async () => {
		const input =
			`<section class="bg-[url('/hero.jpg')] bg-cover bg-center" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><h1>Title</h1></section>`
		const result = await ctx.process(input)

		const sectionEntry = getEntryByTag(result, 'section')
		expect(sectionEntry).toBeDefined()
		expect(sectionEntry?.backgroundImage).toBeDefined()
	})

	test('backgroundImage metadata includes bgImageClass, imageUrl, bgSize, bgPosition, bgRepeat', async () => {
		const input =
			`<section class="bg-[url('/hero.jpg')] bg-cover bg-center bg-no-repeat" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><h1>Title</h1></section>`
		const result = await ctx.process(input)

		const sectionEntry = getEntryByTag(result, 'section')
		expect(sectionEntry?.backgroundImage?.bgImageClass).toBe("bg-[url('/hero.jpg')]")
		expect(sectionEntry?.backgroundImage?.imageUrl).toBe('/hero.jpg')
		expect(sectionEntry?.backgroundImage?.bgSize).toBe('bg-cover')
		expect(sectionEntry?.backgroundImage?.bgPosition).toBe('bg-center')
		expect(sectionEntry?.backgroundImage?.bgRepeat).toBe('bg-no-repeat')
	})

	test('does not mark elements without bg-[url()] class', async () => {
		const input = '<div class="bg-blue-500 px-4"><p>Content</p></div>'
		const result = await ctx.process(input)

		expect(result.html).not.toContain('data-cms-bg-img')
	})

	test('marked bg-image elements do NOT become text-editable', async () => {
		const input = `<div class="bg-[url('/test.png')]" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><p>Content</p></div>`
		const result = await ctx.process(input)

		// The bg-image div should be marked with data-cms-bg-img but should not have contentEditable
		expect(result.html).not.toContain('contenteditable')
		expect(result.html).toContain('data-cms-bg-img="true"')
	})

	test('children of bg-image containers still get their own CMS IDs', async () => {
		const input =
			`<div class="bg-[url('/test.png')]" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><h1>Title</h1><p>Paragraph</p></div>`
		const result = await ctx.process(input)

		expectMarked(result, 'h1')
		expectMarked(result, 'p')
	})

	test('element with bg-[url()] + bg-cover + bg-center has all metadata captured', async () => {
		const input =
			`<div class="bg-[url('/banner.webp')] bg-cover bg-center" data-astro-source-file="src/pages/test.astro" data-astro-source-line="10:0"><h2>Banner</h2></div>`
		const result = await ctx.process(input)

		const divEntry = getEntryByTag(result, 'div')
		expect(divEntry).toBeDefined()
		expect(divEntry?.backgroundImage?.bgImageClass).toBe("bg-[url('/banner.webp')]")
		expect(divEntry?.backgroundImage?.bgSize).toBe('bg-cover')
		expect(divEntry?.backgroundImage?.bgPosition).toBe('bg-center')
	})

	test('element already marked with data-cms-id is NOT double-marked', async () => {
		const input =
			`<div data-cms-id="existing" class="bg-[url('/test.png')]" data-astro-source-file="src/pages/test.astro" data-astro-source-line="5:0"><p>Content</p></div>`
		const result = await ctx.process(input)

		// The existing data-cms-id should be preserved
		expect(result.html).toContain('data-cms-id="existing"')
		// Count how many data-cms-id attributes the div has: should only be one
		const divMatches = result.html.match(/data-cms-id="existing"/g)
		expect(divMatches?.length).toBe(1)
	})
})
