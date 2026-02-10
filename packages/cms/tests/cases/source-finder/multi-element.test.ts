/**
 * Source finder tests: Multiple Same-Tag Elements
 *
 * Tests for correctly identifying the right element when multiple
 * elements of the same tag type exist.
 */

import { expect, test } from 'bun:test'
import { findSourceLocation } from '../../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findSourceLocation - Multiple Same-Tag Elements', (getCtx) => {
	test('should find correct element among multiple same-tag with array props', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Nav from '../components/Nav.astro';
const navItems = ['Home', 'About', 'Contact'];
---
<Nav items={navItems} />
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
const { items } = Astro.props;
---
<nav>
  <a>{items[0]}</a>
  <a>{items[1]}</a>
  <a>{items[2]}</a>
</nav>
`,
		)

		// Each search should find the correct array element
		const homeResult = await findSourceLocation('Home', 'a')
		const aboutResult = await findSourceLocation('About', 'a')
		const contactResult = await findSourceLocation('Contact', 'a')

		expect(homeResult).toBeDefined()
		expect(homeResult?.variableName).toBe('navItems[0]')

		expect(aboutResult).toBeDefined()
		expect(aboutResult?.variableName).toBe('navItems[1]')

		expect(contactResult).toBeDefined()
		expect(contactResult?.variableName).toBe('navItems[2]')
	})

	test('should find correct element among multiple same-tag with imported values', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/links.ts',
			`export const links = ['GitHub', 'Twitter', 'LinkedIn'];
`,
		)

		await ctx.writeFile(
			'src/components/Social.astro',
			`---
import { links } from '../data/links';
---
<div>
  <a>{links[0]}</a>
  <a>{links[1]}</a>
  <a>{links[2]}</a>
</div>
`,
		)

		const githubResult = await findSourceLocation('GitHub', 'a')
		const twitterResult = await findSourceLocation('Twitter', 'a')
		const linkedinResult = await findSourceLocation('LinkedIn', 'a')

		expect(githubResult).toBeDefined()
		expect(githubResult?.variableName).toBe('links[0]')

		expect(twitterResult).toBeDefined()
		expect(twitterResult?.variableName).toBe('links[1]')

		expect(linkedinResult).toBeDefined()
		expect(linkedinResult?.variableName).toBe('links[2]')
	})

	test('should find correct element among multiple same-tag with array of objects', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/pages/menu.astro',
			`---
import Menu from '../components/Menu.astro';
const menuItems = [
  { label: 'Dashboard', icon: 'home' },
  { label: 'Settings', icon: 'gear' },
  { label: 'Profile', icon: 'user' }
];
---
<Menu items={menuItems} />
`,
		)

		await ctx.writeFile(
			'src/components/Menu.astro',
			`---
const { items } = Astro.props;
---
<nav>
  <span>{items[0].label}</span>
  <span>{items[1].label}</span>
  <span>{items[2].label}</span>
</nav>
`,
		)

		const dashboardResult = await findSourceLocation('Dashboard', 'span')
		const settingsResult = await findSourceLocation('Settings', 'span')
		const profileResult = await findSourceLocation('Profile', 'span')

		expect(dashboardResult).toBeDefined()
		expect(dashboardResult?.variableName).toBe('menuItems[0].label')

		expect(settingsResult).toBeDefined()
		expect(settingsResult?.variableName).toBe('menuItems[1].label')

		expect(profileResult).toBeDefined()
		expect(profileResult?.variableName).toBe('menuItems[2].label')
	})

	test('should find correct element among multiple same-tag with imported array of objects', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/nav.ts',
			`export const navLinks = [
  { text: 'Home', url: '/' },
  { text: 'Blog', url: '/blog' },
  { text: 'Contact', url: '/contact' }
];
`,
		)

		await ctx.writeFile(
			'src/components/Header.astro',
			`---
import { navLinks } from '../data/nav';
---
<header>
  <a>{navLinks[0].text}</a>
  <a>{navLinks[1].text}</a>
  <a>{navLinks[2].text}</a>
</header>
`,
		)

		const homeResult = await findSourceLocation('Home', 'a')
		const blogResult = await findSourceLocation('Blog', 'a')
		const contactResult = await findSourceLocation('Contact', 'a')

		expect(homeResult).toBeDefined()
		expect(homeResult?.variableName).toBe('navLinks[0].text')

		expect(blogResult).toBeDefined()
		expect(blogResult?.variableName).toBe('navLinks[1].text')

		expect(contactResult).toBeDefined()
		expect(contactResult?.variableName).toBe('navLinks[2].text')
	})

	test('should find correct element among mixed static and dynamic content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/config.ts',
			`export const appName = 'MyApp';
`,
		)

		await ctx.writeFile(
			'src/components/Mixed.astro',
			`---
import { appName } from '../data/config';
---
<div>
  <span>Static Text</span>
  <span>{appName}</span>
  <span>More Static</span>
</div>
`,
		)

		const staticResult = await findSourceLocation('Static Text', 'span')
		const dynamicResult = await findSourceLocation('MyApp', 'span')
		const moreStaticResult = await findSourceLocation('More Static', 'span')

		expect(staticResult).toBeDefined()
		expect(staticResult?.type).toBe('static')
		expect(staticResult?.line).toBe(5)

		expect(dynamicResult).toBeDefined()
		expect(dynamicResult?.variableName).toBe('appName')

		expect(moreStaticResult).toBeDefined()
		expect(moreStaticResult?.type).toBe('static')
		expect(moreStaticResult?.line).toBe(7)
	})
}, { setupAstro: false })
