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

	test('should find text from .map() over array of objects', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Stats.astro',
			`---
const facts = [
	{ label: 'Lokalita', value: 'Kolín' },
	{ label: 'Bytové jednotky v prodeji', value: '76 bytů' },
	{ label: 'Předpokládané dokončení', value: '2027' },
]
---
<section>
	{
		facts.map((fact) => (
			<div>
				<span>{fact.label}</span>
				<span>{fact.value}</span>
			</div>
		))
	}
</section>
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const labelResult = await findSourceLocation('Lokalita', 'span')
		expect(labelResult).toBeDefined()
		expect(labelResult?.file).toBe('src/components/Stats.astro')
		expect(labelResult?.line).toBe(3)
		expect(labelResult?.type).toBe('variable')
		expect(labelResult?.variableName).toBe('facts[0].label')

		const valueResult = await findSourceLocation('76 bytů', 'span')
		expect(valueResult).toBeDefined()
		expect(valueResult?.file).toBe('src/components/Stats.astro')
		expect(valueResult?.line).toBe(4)
		expect(valueResult?.variableName).toBe('facts[1].value')
	})

	test('should find text from .map() over flat string array', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Tags.astro',
			`---
const tags = ['Alpha', 'Beta', 'Gamma']
---
<ul>
	{tags.map((t) => <li>{t}</li>)}
</ul>
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = await findSourceLocation('Beta', 'li')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Tags.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('tags[1]')
	})

	test('should find text from expression-prop template literal passed to component', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/SectionHeading.astro',
			`---
const { heading } = Astro.props;
const Tag = 'h2';
---
<Tag class="display-section" set:html={heading} />
`,
		)
		await ctx.writeFile(
			'src/components/Intro.astro',
			`---
import SectionHeading from './SectionHeading.astro';
---
<section>
	<SectionHeading heading={\`Tři bytové domy jako další díl „skládačky".\`} />
</section>
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = await findSourceLocation('Tři bytové domy jako další díl „skládačky".', 'h2')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Intro.astro')
		expect(result?.type).toBe('prop')
		expect(result?.variableName).toBe('heading')
	})

	test('should find text from expression-prop double-quoted string', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Banner.astro',
			`---
const { title } = Astro.props;
---
<h1 set:html={title} />
`,
		)
		await ctx.writeFile(
			'src/components/Page.astro',
			`---
import Banner from './Banner.astro';
---
<Banner title={"Welcome to our site"} />
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = await findSourceLocation('Welcome to our site', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Page.astro')
		expect(result?.type).toBe('prop')
	})

	test('extracted snippet matches file content byte-for-byte (blank lines preserved)', async () => {
		// Regression: extractCompleteTagSnippet used to skip blank lines, producing
		// a snippet that wouldn't pass `content.includes(snippet)` in the writer when
		// the file had a blank line (e.g. between frontmatter --- and the template).
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		const fileContent = `---
const facts = [
	{ label: 'Lokalita', value: 'Kolín' },
]
---

<section>
	{
		facts.map((fact) => (
			<span>{fact.value}</span>
		))
	}
</section>
`
		await ctx.writeFile('src/components/Stats.astro', fileContent)

		const path = await import('node:path')
		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		const { enhanceManifestWithSourceSnippets } = await import('../../../src/source-finder/snippet-utils')
		await initializeSearchIndex()

		const enhanced = await enhanceManifestWithSourceSnippets({
			'cms-1': {
				id: 'cms-1',
				tag: 'span',
				text: 'Kolín',
				sourcePath: path.resolve(ctx.tempDir, 'src/components/Stats.astro'),
				sourceLine: 10,
			},
		})

		const snippet = enhanced['cms-1']!.sourceSnippet!
		expect(snippet).toBeDefined()
		expect(fileContent.includes(snippet)).toBe(true)
	})

	test('overrides Astro template-line sourceLine with variable definition line (absolute path from Astro)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Stats.astro',
			`---
const facts = [
	{ label: 'Lokalita', value: 'Kolín' },
	{ label: 'Bytové jednotky v prodeji', value: '76 bytů' },
]
---
<section>
	{
		facts.map((fact) => (
			<div>
				<span>{fact.label}</span>
				<span>{fact.value}</span>
			</div>
		))
	}
</section>
`,
		)

		const path = await import('node:path')
		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		const { enhanceManifestWithSourceSnippets } = await import('../../../src/source-finder/snippet-utils')
		await initializeSearchIndex()

		// Astro stamps `data-astro-source-file` with absolute paths and points
		// `sourceLine` at the JSX template line, not the data definition.
		const absoluteStatsPath = path.resolve(ctx.tempDir, 'src/components/Stats.astro')
		const enhanced = await enhanceManifestWithSourceSnippets({
			'cms-1': {
				id: 'cms-1',
				tag: 'span',
				text: 'Kolín',
				sourcePath: absoluteStatsPath,
				sourceLine: 11, // JSX template line
			},
		})

		expect(enhanced['cms-1']!.variableName).toBe('facts[0].value')
		expect(enhanced['cms-1']!.sourceLine).toBe(3) // upgraded to data definition line
		// Path may be normalized to project-relative form.
		expect(enhanced['cms-1']!.sourcePath?.endsWith('src/components/Stats.astro')).toBe(true)
	})

	test('should find text from .map() with destructured params', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Menu.astro',
			`---
const links = [
	{ label: 'Home', href: '/' },
	{ label: 'About', href: '/about' },
]
---
<nav>
	{links.map(({ label, href }) => <a href={href}>{label}</a>)}
</nav>
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = await findSourceLocation('About', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Menu.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('links[1].label')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Prop Default Array Values', (getCtx) => {
	test('should find text from prop default array value', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Heading.astro',
			`---
const {
  title = ['Už jste si toho přečetli dost,', 'je na čase se nám ozvat.'],
} = Astro.props
---
<h1>{title[0]}</h1>
<h2>{title[1]}</h2>
`,
		)

		const result0 = await findSourceLocation('Už jste si toho přečetli dost,', 'h1')
		const result1 = await findSourceLocation('je na čase se nám ozvat.', 'h2')

		expect(result0).toBeDefined()
		expect(result0?.file).toBe('src/components/Heading.astro')
		expect(result0?.type).toBe('variable')
		expect(result0?.variableName).toBe('title[0]')

		expect(result1).toBeDefined()
		expect(result1?.file).toBe('src/components/Heading.astro')
		expect(result1?.type).toBe('variable')
		expect(result1?.variableName).toBe('title[1]')
	})

	test('should find text from prop default object value', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Card.astro',
			`---
const {
  config = { title: 'Default Title', subtitle: 'Default Subtitle' },
} = Astro.props
---
<h1>{config.title}</h1>
<p>{config.subtitle}</p>
`,
		)

		const result = await findSourceLocation('Default Title', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Card.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('config.title')
	})

	test('should find text from prop default with array of objects', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Links.astro',
			`---
const {
  links = [
    { text: 'Home', href: '/' },
    { text: 'About', href: '/about' }
  ],
} = Astro.props
---
<a>{links[0].text}</a>
<a>{links[1].text}</a>
`,
		)

		const result0 = await findSourceLocation('Home', 'a')
		const result1 = await findSourceLocation('About', 'a')

		expect(result0).toBeDefined()
		expect(result0?.file).toBe('src/components/Links.astro')
		expect(result0?.type).toBe('variable')
		expect(result0?.variableName).toBe('links[0].text')

		expect(result1).toBeDefined()
		expect(result1?.file).toBe('src/components/Links.astro')
		expect(result1?.type).toBe('variable')
		expect(result1?.variableName).toBe('links[1].text')
	})

	test('should find text from renamed prop with default value', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Hero.astro',
			`---
const {
  heading: title = ['Line 1', 'Line 2'],
} = Astro.props
---
<h1>{title[0]}</h1>
`,
		)

		const result = await findSourceLocation('Line 1', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Hero.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('title[0]')
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

	test('should track .map() loop param across file boundary', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		// Parent passes the array; child renders via .map()
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Nav from '../components/Nav.astro';
const navItems = [
	{ label: 'Home', href: '/' },
	{ label: 'About', href: '/about' },
	{ label: 'Contact', href: '/contact' },
];
---
<Nav items={navItems} />
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
interface Props {
	items: Array<{ label: string; href: string }>;
}
const { items } = Astro.props;
---
<nav>
	{items.map((item) => <a href={item.href}>{item.label}</a>)}
</nav>
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = await findSourceLocation('About', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('navItems[1].label')
	})

	test('should track destructured .map() loop param across file boundary', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/page.astro',
			`---
import Menu from '../components/Menu.astro';
const links = [
	{ label: 'Home', href: '/' },
	{ label: 'About', href: '/about' },
];
---
<Menu items={links} />
`,
		)

		await ctx.writeFile(
			'src/components/Menu.astro',
			`---
const { items } = Astro.props;
---
<nav>
	{items.map(({ label, href }) => <a href={href}>{label}</a>)}
</nav>
`,
		)

		const { initializeSearchIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = await findSourceLocation('About', 'a')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/page.astro')
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('links[1].label')
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
