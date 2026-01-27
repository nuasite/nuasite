/**
 * Source finder tests: Props and Snippets
 *
 * Tests for finding prop values passed to components and
 * verifying snippet extraction behavior.
 */

import { expect, test } from 'bun:test'
import { findSourceLocation } from '../../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findSourceLocation - Props', (getCtx) => {
	test('should find prop values passed to components', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/layouts/Layout.astro',
			`---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<html>
<head>
  <title>{title}</title>
</head>
<body><slot /></body>
</html>
`,
		)

		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Layout from '../layouts/Layout.astro';
---
<Layout title="My Page Title">
  <h1>Welcome</h1>
</Layout>
`,
		)

		// Should find where the title prop is passed, not where it's used in Layout
		const result = await findSourceLocation('My Page Title', 'title')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.line).toBe(4) // Line where <Layout title="..." is
		expect(result?.type).toBe('prop')
		expect(result?.variableName).toBe('title')
	})

	test('should find prop values on multi-line component tags', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Card.astro',
			`---
interface Props {
  heading: string;
  description: string;
}
const { heading, description } = Astro.props;
---
<div>
  <h2>{heading}</h2>
  <p>{description}</p>
</div>
`,
		)

		await ctx.writeFile(
			'src/pages/cards.astro',
			`---
import Card from '../components/Card.astro';
---
<Card
  heading="Feature Card"
  description="This is a great feature"
/>
`,
		)

		const headingResult = await findSourceLocation('Feature Card', 'h2')
		expect(headingResult).toBeDefined()
		expect(headingResult?.file).toBe('src/pages/cards.astro')
		expect(headingResult?.type).toBe('prop')
		expect(headingResult?.variableName).toBe('heading')

		const descResult = await findSourceLocation('This is a great feature', 'p')
		expect(descResult).toBeDefined()
		expect(descResult?.file).toBe('src/pages/cards.astro')
		expect(descResult?.type).toBe('prop')
		expect(descResult?.variableName).toBe('description')
	})

	test('should prefer static content over prop when both exist', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Header.astro',
			`---
---
<h1>Static Title</h1>
`,
		)

		await ctx.writeFile(
			'src/pages/home.astro',
			`---
import Header from '../components/Header.astro';
---
<Header />
<p>Other content</p>
`,
		)

		const result = await findSourceLocation('Static Title', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Header.astro')
		expect(result?.type).toBe('static')
		expect(result?.line).toBe(3)
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Snippets', (getCtx) => {
	test('snippet should contain only innerHTML, not the complete element with tags', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Heading.astro',
			`---
---
<h2 class="text-4xl font-bold text-center">Hello World</h2>
`,
		)

		const result = await findSourceLocation('Hello World', 'h2')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Heading.astro')
		expect(result?.line).toBe(3)
		expect(result?.type).toBe('static')
		// Snippet should be just the innerHTML, not the complete element
		// This ensures CMS updates only replace the content, not the element structure
		expect(result?.snippet).toBe('Hello World')
		expect(result?.snippet).not.toContain('<h2')
		expect(result?.snippet).not.toContain('class=')
	})

	test('snippet should contain innerHTML for multi-line elements', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Para.astro',
			`---
---
<p class="text-lg leading-relaxed">
  This is multi-line
  paragraph content
</p>
`,
		)

		const result = await findSourceLocation('This is multi-line paragraph content', 'p')

		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
		// Snippet should contain the innerHTML (may include whitespace)
		expect(result?.snippet).toContain('This is multi-line')
		expect(result?.snippet).toContain('paragraph content')
		// Should NOT contain the element tags or attributes
		expect(result?.snippet).not.toContain('<p')
		expect(result?.snippet).not.toContain('class=')
	})

	test('snippet should contain innerHTML when opening tag is on separate lines (multi-line attributes)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		// This tests the case where <a> tag has attributes on multiple lines
		// and the text content is on yet another line
		await ctx.writeFile(
			'src/components/Link.astro',
			`---
---
<a
  href="/about"
  class="inline-block backdrop-blur-lg bg-white/30"
>
  Read more about us
</a>
`,
		)

		const result = await findSourceLocation('Read more about us', 'a')

		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
		// Snippet should contain only the innerHTML, not the opening tag or attributes
		expect(result?.snippet).toContain('Read more about us')
		// Should NOT contain the element tags or attributes
		expect(result?.snippet).not.toContain('<a')
		expect(result?.snippet).not.toContain('href=')
		expect(result?.snippet).not.toContain('class=')
		// Should NOT contain the closing tag
		expect(result?.snippet).not.toContain('</a>')
	})

	test('snippet should contain innerHTML with nested inline elements', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Styled.astro',
			`---
---
<p class="text-base">Text with <strong>bold</strong> and <em>italic</em></p>
`,
		)

		const result = await findSourceLocation('Text with bold and italic', 'p')

		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
		// Snippet should preserve inline HTML elements
		expect(result?.snippet).toBe('Text with <strong>bold</strong> and <em>italic</em>')
		// Should NOT contain the wrapper element
		expect(result?.snippet).not.toContain('<p')
		expect(result?.snippet).not.toContain('class=')
	})
}, { setupAstro: false })
