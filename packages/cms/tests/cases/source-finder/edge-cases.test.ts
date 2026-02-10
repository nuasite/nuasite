/**
 * Source finder tests: Edge Cases
 *
 * Tests for edge cases like renamed props, default values,
 * prop drilling, and spread props.
 */

import { expect, test } from 'bun:test'
import { findSourceLocation } from '../../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findSourceLocation - Edge Cases', (getCtx) => {
	// Edge case: Renamed destructured props
	// const { items: navItems } = Astro.props; -> local var is 'navItems', prop name is 'items'
	test('should handle renamed destructured props', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Nav from '../components/Nav.astro';
const menuItems = ['Home', 'About'];
---
<Nav items={menuItems} />
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
interface Props {
  items: string[];
}
const { items: navItems } = Astro.props;
---
<a>{navItems[0]}</a>
`,
		)

		const result = await findSourceLocation('Home', 'a')

		// Should work even with renamed destructuring (items -> navItems)
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toBe('menuItems[0]')
	})

	// Edge case: Props with default values
	test('should handle props with default values', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Nav from '../components/Nav.astro';
const menuItems = ['Home', 'About'];
---
<Nav items={menuItems} />
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
interface Props {
  items?: string[];
}
const { items = [] } = Astro.props;
---
<a>{items[0]}</a>
`,
		)

		const result = await findSourceLocation('Home', 'a')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toBe('menuItems[0]')
	})

	// Edge case: Multiple components using same prop pattern
	test('should find correct source when multiple components use similar patterns', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import NavA from '../components/NavA.astro';
import NavB from '../components/NavB.astro';
const itemsA = ['Alpha', 'Beta'];
const itemsB = ['Gamma', 'Delta'];
---
<NavA items={itemsA} />
<NavB items={itemsB} />
`,
		)

		await ctx.writeFile(
			'src/components/NavA.astro',
			`---
const { items } = Astro.props;
---
<a>{items[0]}</a>
`,
		)

		await ctx.writeFile(
			'src/components/NavB.astro',
			`---
const { items } = Astro.props;
---
<span>{items[0]}</span>
`,
		)

		const resultA = await findSourceLocation('Alpha', 'a')
		const resultB = await findSourceLocation('Gamma', 'span')

		expect(resultA).toBeDefined()
		expect(resultA?.variableName).toBe('itemsA[0]')

		expect(resultB).toBeDefined()
		expect(resultB?.variableName).toBe('itemsB[0]')
	})

	// Edge case: Prop drilling (Page -> Layout -> Component)
	// Multi-level prop drilling now works with recursive tracking
	test('should track multi-level prop drilling (Page -> Layout -> Component)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Layout from '../layouts/Layout.astro';
const navItems = ['Home', 'About'];
---
<Layout items={navItems}>
  <h1>Content</h1>
</Layout>
`,
		)

		await ctx.writeFile(
			'src/layouts/Layout.astro',
			`---
import Nav from '../components/Nav.astro';
const { items } = Astro.props;
---
<html>
  <Nav items={items} />
  <slot />
</html>
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
const { items } = Astro.props;
---
<a>{items[0]}</a>
`,
		)

		const result = await findSourceLocation('Home', 'a')
		// Multi-level drilling: Page defines items, passes to Layout, Layout passes to Nav
		// Should track back to the original definition in Page
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.line).toBe(3)
		expect(result?.variableName).toBe('navItems[0]')
	})

	// Edge case: Spread props
	test('should track spread props', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Card from '../components/Card.astro';
const cardProps = { title: 'Hello', subtitle: 'World' };
---
<Card {...cardProps} />
`,
		)

		await ctx.writeFile(
			'src/components/Card.astro',
			`---
const { title } = Astro.props;
---
<h1>{title}</h1>
`,
		)

		const result = await findSourceLocation('Hello', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toBe('cardProps.title')
	})

	// Test spread props with nested object
	test('should track spread props with nested values', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/about.astro',
			`---
import Hero from '../components/Hero.astro';
const heroData = {
  heading: 'Welcome',
  description: 'This is the about page'
};
---
<Hero {...heroData} />
`,
		)

		await ctx.writeFile(
			'src/components/Hero.astro',
			`---
const { heading, description } = Astro.props;
---
<h1>{heading}</h1>
<p>{description}</p>
`,
		)

		const headingResult = await findSourceLocation('Welcome', 'h1')
		expect(headingResult).toBeDefined()
		expect(headingResult?.file).toBe('src/pages/about.astro')
		expect(headingResult?.variableName).toBe('heroData.heading')

		const descResult = await findSourceLocation('This is the about page', 'p')
		expect(descResult).toBeDefined()
		expect(descResult?.variableName).toBe('heroData.description')
	})
}, { setupAstro: false })
