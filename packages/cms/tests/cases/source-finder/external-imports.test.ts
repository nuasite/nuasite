/**
 * Source finder tests: External Imports
 *
 * Tests for tracking values imported from external TypeScript files.
 */

import { expect, test } from 'bun:test'
import { findSourceLocation } from '../../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findSourceLocation - External Imports', (getCtx) => {
	test('should track simple string from external import', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		// Create the data file with exported value
		await ctx.writeFile(
			'src/data/config.ts',
			`export const siteTitle = 'My Amazing Site';
`,
		)

		// Create a component that imports and uses it
		await ctx.writeFile(
			'src/components/Header.astro',
			`---
import { siteTitle } from '../data/config';
---
<h1>{siteTitle}</h1>
`,
		)

		const result = await findSourceLocation('My Amazing Site', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/data/config.ts')
		expect(result?.line).toBe(1)
		expect(result?.variableName).toBe('siteTitle')
	})

	test('should track array element from external import', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/navigation.ts',
			`export const navItems = ['Home', 'About', 'Contact'];
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
import { navItems } from '../data/navigation';
---
<a>{navItems[0]}</a>
<span>{navItems[1]}</span>
`,
		)

		const homeResult = await findSourceLocation('Home', 'a')
		expect(homeResult).toBeDefined()
		expect(homeResult?.file).toBe('src/data/navigation.ts')
		expect(homeResult?.variableName).toBe('navItems[0]')

		// Use different tag to avoid confusion
		const aboutResult = await findSourceLocation('About', 'span')
		expect(aboutResult).toBeDefined()
		expect(aboutResult?.variableName).toBe('navItems[1]')
	})

	test('should track nested object from external import', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/site.ts',
			`export const config = {
  meta: {
    title: 'Site Title',
    description: 'Site Description'
  }
};
`,
		)

		await ctx.writeFile(
			'src/components/Meta.astro',
			`---
import { config } from '../data/site';
---
<title>{config.meta.title}</title>
<meta name="description" content={config.meta.description} />
`,
		)

		const result = await findSourceLocation('Site Title', 'title')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/data/site.ts')
		expect(result?.variableName).toBe('config.meta.title')
	})

	test('should track array of objects from external import', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/links.ts',
			`export const links = [
  { text: 'GitHub', url: 'https://github.com' },
  { text: 'Twitter', url: 'https://twitter.com' }
];
`,
		)

		await ctx.writeFile(
			'src/components/Footer.astro',
			`---
import { links } from '../data/links';
---
<a>{links[0].text}</a>
<span>{links[1].text}</span>
`,
		)

		const githubResult = await findSourceLocation('GitHub', 'a')
		expect(githubResult).toBeDefined()
		expect(githubResult?.file).toBe('src/data/links.ts')
		expect(githubResult?.variableName).toBe('links[0].text')

		// Use different tag to avoid multi-element same-tag complexity
		const twitterResult = await findSourceLocation('Twitter', 'span')
		expect(twitterResult).toBeDefined()
		expect(twitterResult?.variableName).toBe('links[1].text')
	})

	test('should track renamed import', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/strings.ts',
			`export const greeting = 'Hello World';
`,
		)

		await ctx.writeFile(
			'src/components/Welcome.astro',
			`---
import { greeting as welcomeMessage } from '../data/strings';
---
<h1>{welcomeMessage}</h1>
`,
		)

		const result = await findSourceLocation('Hello World', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/data/strings.ts')
		expect(result?.variableName).toBe('greeting')
	})

	test('should track default export', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/defaults.ts',
			`const config = {
  appName: 'My App'
};
export default config;
`,
		)

		await ctx.writeFile(
			'src/components/App.astro',
			`---
import config from '../data/defaults';
---
<h1>{config.appName}</h1>
`,
		)

		const result = await findSourceLocation('My App', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/data/defaults.ts')
		expect(result?.variableName).toBe('config.appName')
	})

	test('should handle import without extension', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/messages.ts',
			`export const welcome = 'Welcome to the site';
`,
		)

		await ctx.writeFile(
			'src/components/Banner.astro',
			`---
import { welcome } from '../data/messages';
---
<p>{welcome}</p>
`,
		)

		const result = await findSourceLocation('Welcome to the site', 'p')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/data/messages.ts')
	})
}, { setupAstro: false })
