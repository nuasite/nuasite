/**
 * Source finder tests: Basic text finding
 *
 * Tests for finding text content in Astro components,
 * including static text, variables, and multiline content.
 */

import { describe, expect, test } from 'bun:test'
import { findSourceLocation } from '../../../src/source-finder'
import { snippetContainsText } from '../../../src/source-finder/snippet-utils'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

// Deciding "static template text" vs. "dynamic expression" hinges on this — a
// false negative sends the lookup to the search index, which resolves the text
// in whichever file was indexed first.
describe('snippetContainsText', () => {
	test('matches plain text directly', () => {
		expect(snippetContainsText('<h1>Hello World</h1>', 'Hello World')).toBe(true)
	})

	test('matches rendered U+00A0 against a source &nbsp;', () => {
		expect(snippetContainsText('<a href="/about">About&nbsp;us</a>', 'About\u00A0us')).toBe(true)
	})

	test('matches a rendered <br> against <br class="..." />', () => {
		expect(
			snippetContainsText(
				'<h1>Když onemocní dítě, bojuje<br class="hidden lg:inline" /> celá rodina.</h1>',
				'Když onemocní dítě, bojuje<br> celá rodina.',
			),
		).toBe(true)
	})

	test('matches text split by an inline <strong>', () => {
		expect(
			snippetContainsText(
				'<li><strong class="font-semibold">Pořádáme kurzy</strong> pro zdravotníky.</li>',
				'Pořádáme kurzy pro zdravotníky.',
			),
		).toBe(true)
	})

	test('does not match text rendered from an expression', () => {
		expect(snippetContainsText('<p>{STORY}</p>', 'Tématu podpory sourozenců')).toBe(false)
	})

	test('matches around a nested CMS child placeholder', () => {
		expect(
			snippetContainsText(
				'<p>Read more <a href="/docs">here</a>.</p>',
				'Read more {{cms:cms-5}}.',
			),
		).toBe(true)
	})

	test('matches an element that is nothing but a nested child', () => {
		expect(snippetContainsText('<p><a href="/docs">here</a></p>', '{{cms:cms-5}}')).toBe(true)
	})

	test('matches inline markup with no whitespace at the seam', () => {
		expect(snippetContainsText('<h2>Nua<span class="text-primary">Site</span></h2>', 'NuaSite')).toBe(true)
	})

	test('requires the runs to appear in order', () => {
		expect(
			snippetContainsText('<p>second <a href="/x">link</a> first</p>', 'first {{cms:cms-5}} second'),
		).toBe(false)
	})
})

withTempDir('findSourceLocation - Text Finding', (getCtx) => {
	test('covers the whole value when an object property spans lines', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Config.astro',
			`---
const CONFIG = {
	body: 'Tématu podpory '
		+ 'sourozenců.',
}
---
<p>{CONFIG.body}</p>
`,
		)

		const result = await findSourceLocation('Tématu podpory sourozenců.', 'p')

		expect(result?.file).toBe('src/components/Config.astro')
		expect(result?.snippet).toContain("'sourozenců.'")
	})

	test('finds text built from a + chain of string literals', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Story.astro',
			`---
const STORY = 'Tématu podpory sourozenců '
	+ 'jsem si poprvé všimla v USA.'
---
<p>{STORY}</p>
`,
		)

		const result = await findSourceLocation('Tématu podpory sourozenců jsem si poprvé všimla v USA.', 'p')

		expect(result?.file).toBe('src/components/Story.astro')
		expect(result?.line).toBe(2)
		// The whole chain is the edit target, not just its first line.
		expect(result?.snippet).toContain("'jsem si poprvé všimla v USA.'")
	})

	test('should find simple text in component', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Test.astro',
			`---
---
<h1>Hello World</h1>
<p>Some text</p>
`,
		)

		const result = await findSourceLocation('Hello World', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Test.astro')
		expect(result?.line).toBe(3)
	})

	test('should find text with variable reference', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Button.astro',
			`---
const label = 'Click Me';
---
<button>{label}</button>
`,
		)

		const result = await findSourceLocation('Click Me', 'button')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Button.astro')
		expect(result?.line).toBe(2) // Definition line, not usage line
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('label')
	})

	test('should find text with object property variable', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
const links = {
  home: 'Home Page',
  about: 'About Us',
};
---
<a>{links.home}</a>
<a>{links.about}</a>
`,
		)

		const result = await findSourceLocation('Home Page', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Nav.astro')
		expect(result?.line).toBe(3) // Definition line in object
		expect(result?.type).toBe('variable')
	})

	test('should handle TypeScript type annotations', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Typed.astro',
			`---
const title: string = 'Typed Title';
---
<h1>{title}</h1>
`,
		)

		const result = await findSourceLocation('Typed Title', 'h1')

		expect(result).toBeDefined()
		expect(result?.line).toBe(2) // Definition line with type annotation
		expect(result?.type).toBe('variable')
	})

	test('should find multiline tag content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Multi.astro',
			`---
---
<p>
  This is a long paragraph
  that spans multiple lines
</p>
`,
		)

		const result = await findSourceLocation('This is a long paragraph that spans multiple lines', 'p')

		expect(result).toBeDefined()
		expect(result?.line).toBe(3)
	})

	test('should handle escaped quotes', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		// Use String.raw to preserve the backslash
		const content = String.raw`---
const text = 'What\'s up';
---
<p>{text}</p>
`
		await ctx.writeFile('src/components/Quote.astro', content)

		const result = await findSourceLocation("What's up", 'p')

		expect(result).toBeDefined()
		expect(result?.line).toBe(2) // Definition line with escaped quote
		expect(result?.type).toBe('variable')
	})

	test('should return undefined when text not found', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Empty.astro',
			`---
---
<div>Nothing here</div>
`,
		)

		const result = await findSourceLocation('Something else', 'div')

		expect(result).toBeUndefined()
	})

	test('should match first few words for long text', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Long.astro',
			`---
---
<p>This is a very long paragraph with lots of words and content that goes on and on</p>
`,
		)

		const result = await findSourceLocation('This is a very long paragraph with lots of words and content that goes on and on', 'p')

		expect(result).toBeDefined()
		expect(result?.line).toBe(3)
	})

	test('should search in pages directory', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
---
<h1>Homepage</h1>
`,
		)

		const result = await findSourceLocation('Homepage', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
	})

	test('should search in layouts directory', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/layouts/Base.astro',
			`---
---
<title>Base Layout</title>
`,
		)

		const result = await findSourceLocation('Base Layout', 'title')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/layouts/Base.astro')
	})

	test('should handle nested directories', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/ui/Card.astro',
			`---
---
<div>Card Content</div>
`,
		)

		const result = await findSourceLocation('Card Content', 'div')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/ui/Card.astro')
	})

	test('should return line where text is, not just where tag opens', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/MultiLine.astro',
			`---
---
<a href="/test"
  class="button"
  >Link Text</a>
`,
		)

		const result = await findSourceLocation('Link Text', 'a')

		expect(result).toBeDefined()
		expect(result?.line).toBe(5) // Line where text is, not line 3 where tag opens
	})

	test('should distinguish between multiple similar tags with static content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Multiple.astro',
			`---
---
<a>First Link</a>
<a>Second Link</a>
<a>Third Link</a>
`,
		)

		const resultFirst = await findSourceLocation('First Link', 'a')
		const resultSecond = await findSourceLocation('Second Link', 'a')
		const resultThird = await findSourceLocation('Third Link', 'a')

		expect(resultFirst?.line).toBe(3)
		expect(resultSecond?.line).toBe(4)
		expect(resultThird?.line).toBe(5)
	})

	test('should handle HTML entities', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Entity.astro',
			`---
const message = "Hello & goodbye";
const title = 'What\\'s "new"?';
---
<p>{message}</p>
<h1>{title}</h1>
`,
		)

		// Test ampersand entity
		const result1 = await findSourceLocation('Hello & goodbye', 'p')
		expect(result1).toBeDefined()
		expect(result1?.line).toBe(2) // Definition line
		expect(result1?.type).toBe('variable')

		// Test apostrophe and quote entities
		const result2 = await findSourceLocation('What\'s "new"?', 'h1')
		expect(result2).toBeDefined()
		expect(result2?.line).toBe(3) // Definition line
		expect(result2?.type).toBe('variable')
	})

	test('should handle template literals without interpolation', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Template.astro',
			`---
const greeting = \`Hello World\`;
const message = \`Welcome to our site\`;
---
<h1>{greeting}</h1>
<p>{message}</p>
`,
		)

		const result1 = await findSourceLocation('Hello World', 'h1')
		expect(result1).toBeDefined()
		expect(result1?.line).toBe(2) // Definition line
		expect(result1?.type).toBe('variable')

		const result2 = await findSourceLocation('Welcome to our site', 'p')
		expect(result2).toBeDefined()
		expect(result2?.line).toBe(3) // Definition line
		expect(result2?.type).toBe('variable')
	})

	test('should handle short text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Badge.astro',
			`---
---
<span>OK</span>
<span>NEW</span>
`,
		)

		const result = await findSourceLocation('OK', 'span')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Badge.astro')
		expect(result?.line).toBe(3)
		expect(result?.type).toBe('static')
	})

	test('should handle br elements in text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Hero.astro',
			`---
---
<h1 class="text-4xl">
  <span class="gradient">Chytrý</span><br>
  <span class="text-black">fulfillment</span> pro váš růst
</h1>
`,
		)

		// The rendered text would show "Chytrý fulfillment pro váš růst" with space due to br
		const result = await findSourceLocation('Chytrý fulfillment pro váš růst', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Hero.astro')
		expect(result?.type).toBe('static')
	})

	test('should handle multiple br elements', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Address.astro',
			`---
---
<p>Line one<br>Line two<br>Line three</p>
`,
		)

		const result = await findSourceLocation('Line one Line two Line three', 'p')

		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})

	test('should handle wbr elements in text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/WordBreak.astro',
			`---
---
<h3>Glass<wbr>Decor</h3>
`,
		)

		// wbr renders as empty (zero-width), so text is "GlassDecor"
		const result = await findSourceLocation('GlassDecor', 'h3')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/WordBreak.astro')
		expect(result?.type).toBe('static')
	})

	test('should match wbr text from manifest with literal <wbr> tag', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/WordBreak2.astro',
			`---
---
<h3>Glass<wbr>Decor</h3>
`,
		)

		// Manifest stores text as "Glass<wbr>Decor" (literal tag preserved)
		// normalizeText should strip <wbr> so it matches the indexed "GlassDecor"
		const result = await findSourceLocation('Glass<wbr>Decor', 'h3')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/WordBreak2.astro')
		expect(result?.type).toBe('static')
	})

	test('should match br text from manifest with literal <br> tag', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/LineBreak.astro',
			`---
---
<p>Glass<br>Decor</p>
`,
		)

		// Manifest stores text as "Glass<br>Decor" (literal tag preserved)
		// normalizeText should convert <br> to whitespace so it matches the indexed "Glass Decor"
		const result = await findSourceLocation('Glass<br>Decor', 'p')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/LineBreak.astro')
		expect(result?.type).toBe('static')
	})

	test('should handle nbsp entity in text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Nbsp.astro',
			`---
---
<p>Hello&nbsp;World</p>
`,
		)

		const result = await findSourceLocation('Hello World', 'p')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Nbsp.astro')
		expect(result?.type).toBe('static')
	})
}, { setupAstro: false }) // Don't auto-setup, tests do it themselves for backwards compat
