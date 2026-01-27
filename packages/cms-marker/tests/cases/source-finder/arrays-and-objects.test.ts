/**
 * Source finder tests: Arrays and Nested Objects
 *
 * Tests for finding text from array elements, nested objects,
 * and cross-file prop tracking.
 */

import { expect, test } from 'bun:test'
import { findSourceLocation } from '../../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findSourceLocation - Arrays and Nested Objects', (getCtx) => {
	test('should find text from array element', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
const navItems = ['Home', 'About', 'Contact'];
---
<nav>
  <a>{navItems[0]}</a>
</nav>
`,
		)

		const result = await findSourceLocation('Home', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Nav.astro')
		expect(result?.line).toBe(2) // Definition line
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('navItems[0]')
	})

	test('should find text from nested object property', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Dashboard.astro',
			`---
const config = {
  nav: {
    title: 'Dashboard'
  }
};
---
<h1>{config.nav.title}</h1>
`,
		)

		const result = await findSourceLocation('Dashboard', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Dashboard.astro')
		expect(result?.line).toBe(4) // Definition line of 'title' property
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('config.nav.title')
	})

	test('should find text from array of objects', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Links.astro',
			`---
const links = [
  { text: 'Home', href: '/' },
  { text: 'About', href: '/about' }
];
---
<a>{links[0].text}</a>
<a>{links[1].text}</a>
`,
		)

		const result = await findSourceLocation('Home', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Links.astro')
		expect(result?.line).toBe(3) // Line where { text: 'Home' } is
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('links[0].text')
	})

	test('should find text from deeply nested structure (3+ levels)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Site.astro',
			`---
const data = {
  site: {
    meta: {
      title: 'My Site'
    }
  }
};
---
<title>{data.site.meta.title}</title>
`,
		)

		const result = await findSourceLocation('My Site', 'title')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Site.astro')
		expect(result?.line).toBe(5) // Definition line of 'title' property
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('data.site.meta.title')
	})

	test('should find different array elements correctly', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/List.astro',
			`---
const items = ['First', 'Second', 'Third'];
---
<span>{items[0]}</span>
<span>{items[1]}</span>
<span>{items[2]}</span>
`,
		)

		const result0 = await findSourceLocation('First', 'span')
		const result1 = await findSourceLocation('Second', 'span')
		const result2 = await findSourceLocation('Third', 'span')

		expect(result0).toBeDefined()
		expect(result0?.type).toBe('variable')
		expect(result0?.variableName).toBe('items[0]')

		expect(result1).toBeDefined()
		expect(result1?.type).toBe('variable')
		expect(result1?.variableName).toBe('items[1]')

		expect(result2).toBeDefined()
		expect(result2?.type).toBe('variable')
		expect(result2?.variableName).toBe('items[2]')
	})

	test('should find second element in array of objects', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Menu.astro',
			`---
const menuItems = [
  { label: 'Dashboard', icon: 'home' },
  { label: 'Settings', icon: 'gear' },
  { label: 'Profile', icon: 'user' }
];
---
<nav>
  <span>{menuItems[1].label}</span>
</nav>
`,
		)

		const result = await findSourceLocation('Settings', 'span')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Menu.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('menuItems[1].label')
	})

	test('should handle mixed nested structures', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Complex.astro',
			`---
const app = {
  navigation: {
    items: [
      { name: 'Home', path: '/' },
      { name: 'Blog', path: '/blog' }
    ]
  }
};
---
<a>{app.navigation.items[0].name}</a>
`,
		)

		// Note: This is a complex case - the implementation may not fully support
		// nested arrays within objects. This test documents expected behavior.
		const result = await findSourceLocation('Home', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Complex.astro')
		expect(result?.type).toBe('variable')
	})

	test('should handle array with numeric index access in expression', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Numbers.astro',
			`---
const numbers = ['One', 'Two', 'Three', 'Four', 'Five'];
---
<div>{numbers[3]}</div>
`,
		)

		const result = await findSourceLocation('Four', 'div')

		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('numbers[3]')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Cross-File Prop Tracking', (getCtx) => {
	test('should track array passed as expression prop between files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		// Parent page passes array as expression prop
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Nav from '../components/Nav.astro';
const navItems = ['Home', 'About', 'Contact'];
---
<Nav items={navItems} />
`,
		)

		// Child component receives and uses the array
		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
interface Props {
  items: string[];
}
const { items } = Astro.props;
---
<nav>
  <a>{items[0]}</a>
</nav>
`,
		)

		const result = await findSourceLocation('Home', 'a')

		// Should find the source in the parent file where the array is defined
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.line).toBe(3) // Line where navItems is defined
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('navItems[0]')
	})

	// Verify that quoted string props DO work (for comparison)
	test('CAN track quoted string props between files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/home.astro',
			`---
import Hero from '../components/Hero.astro';
---
<Hero title="Welcome Home" />
`,
		)

		await ctx.writeFile(
			'src/components/Hero.astro',
			`---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<h1>{title}</h1>
`,
		)

		const result = await findSourceLocation('Welcome Home', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/home.astro')
		expect(result?.type).toBe('prop')
		expect(result?.variableName).toBe('title')
	})

	test('should track nested object passed as expression prop between files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/dashboard.astro',
			`---
import Header from '../components/Header.astro';
const siteConfig = {
  nav: {
    title: 'Dashboard'
  }
};
---
<Header config={siteConfig} />
`,
		)

		await ctx.writeFile(
			'src/components/Header.astro',
			`---
interface Props {
  config: { nav: { title: string } };
}
const { config } = Astro.props;
---
<h1>{config.nav.title}</h1>
`,
		)

		const result = await findSourceLocation('Dashboard', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/dashboard.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('siteConfig.nav.title')
	})

	test('should track array of objects passed as expression prop between files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/menu.astro',
			`---
import Navigation from '../components/Navigation.astro';
const menuLinks = [
  { label: 'Home', url: '/' },
  { label: 'About', url: '/about' },
  { label: 'Contact', url: '/contact' }
];
---
<Navigation links={menuLinks} />
`,
		)

		await ctx.writeFile(
			'src/components/Navigation.astro',
			`---
interface Props {
  links: Array<{ label: string; url: string }>;
}
const { links } = Astro.props;
---
<nav>
  <a>{links[1].label}</a>
</nav>
`,
		)

		const result = await findSourceLocation('About', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/menu.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('menuLinks[1].label')
	})

	test('should track expression prop from layout to page', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/layouts/BaseLayout.astro',
			`---
interface Props {
  items: string[];
}
const { items } = Astro.props;
---
<html>
<body>
  <nav><a>{items[0]}</a></nav>
  <slot />
</body>
</html>
`,
		)

		await ctx.writeFile(
			'src/pages/home.astro',
			`---
import BaseLayout from '../layouts/BaseLayout.astro';
const navItems = ['Home', 'Services', 'Contact'];
---
<BaseLayout items={navItems}>
  <h1>Welcome</h1>
</BaseLayout>
`,
		)

		const result = await findSourceLocation('Home', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/home.astro')
		expect(result?.variableName).toBe('navItems[0]')
	})
}, { setupAstro: false })
