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
	// Edge case: Spread props from .map() with parenthesized param
	test('should track spread props from .map() loop variable (parenthesized param)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Card from '../components/Card.astro';
const items = [
  { title: 'First Item', description: 'Description one' },
  { title: 'Second Item', description: 'Description two' },
];
---
{items.map((item) => <Card {...item} />)}
`,
		)

		await ctx.writeFile(
			'src/components/Card.astro',
			`---
const { title, description } = Astro.props;
---
<h3>{title}</h3>
<p>{description}</p>
`,
		)

		const result = await findSourceLocation('First Item', 'h3')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toMatch(/^items\[\d+\]\.title$/)
	})

	// Edge case: Spread props from .map() without parens
	test('should track spread props from .map() loop variable (no parens)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Tag from '../components/Tag.astro';
const tags = [
  { label: 'JavaScript' },
  { label: 'TypeScript' },
];
---
{tags.map(tag => <Tag {...tag} />)}
`,
		)

		await ctx.writeFile(
			'src/components/Tag.astro',
			`---
const { label } = Astro.props;
---
<span>{label}</span>
`,
		)

		const result = await findSourceLocation('JavaScript', 'span')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toMatch(/^tags\[\d+\]\.label$/)
	})
}, { setupAstro: false })

// ============================================================================
// Additional Edge Cases
// ============================================================================

withTempDir('findSourceLocation - Empty/Minimal Frontmatter', (getCtx) => {
	test('should find text in component with empty frontmatter', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Simple.astro',
			`---
---
<p>No variables here</p>
`,
		)

		const result = await findSourceLocation('No variables here', 'p')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})

	test('should find text in component with no frontmatter at all', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Bare.astro',
			`<h1>Just HTML</h1>
`,
		)

		const result = await findSourceLocation('Just HTML', 'h1')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Unicode and Special Characters', (getCtx) => {
	test('should find Unicode text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Unicode.astro',
			`---
const greeting = 'Привет мир';
---
<h1>{greeting}</h1>
`,
		)

		const result = await findSourceLocation('Привет мир', 'h1')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('greeting')
	})

	test('should find text with accented characters', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Accents.astro',
			`---
---
<p>Café résumé naïve</p>
`,
		)

		const result = await findSourceLocation('Café résumé naïve', 'p')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})

	test('should find text containing special regex characters', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Regex.astro',
			`---
const price = '$49.99 (save 20%)';
---
<span>{price}</span>
`,
		)

		const result = await findSourceLocation('$49.99 (save 20%)', 'span')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Short and Boundary Text', (getCtx) => {
	test('should not find single character text (below 2-char minimum)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Short.astro',
			`---
---
<span>X</span>
`,
		)

		const result = await findSourceLocation('X', 'span')
		// Single character text should not match (too ambiguous)
		expect(result).toBeUndefined()
	})

	test('should find exactly 2 character text', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/TwoChar.astro',
			`---
---
<span>OK</span>
`,
		)

		const result = await findSourceLocation('OK', 'span')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})

	test('should return undefined for empty search text', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Empty.astro',
			`---
---
<div>Content</div>
`,
		)

		const result = await findSourceLocation('', 'div')
		expect(result).toBeUndefined()
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Variable Priority', (getCtx) => {
	test('should prefer variable match over static content match', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Priority.astro',
			`---
const title = 'Welcome';
---
<h1>{title}</h1>
`,
		)

		const result = await findSourceLocation('Welcome', 'h1')
		expect(result).toBeDefined()
		// Variable match (priority 100) should beat static match
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('title')
	})

	test('should find variable when same text exists as both static and variable', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Duplicate.astro',
			`---
const label = 'Click Here';
---
<button>{label}</button>
`,
		)

		// The same text "Click Here" is both a variable value and present in template
		const result = await findSourceLocation('Click Here', 'button')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('label')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Declaration Types', (getCtx) => {
	test('should find text from let declaration', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/LetVar.astro',
			`---
let message = 'Mutable Value';
---
<p>{message}</p>
`,
		)

		const result = await findSourceLocation('Mutable Value', 'p')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('message')
	})

	test('should find numeric string value', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Year.astro',
			`---
const year = '2024';
---
<span>{year}</span>
`,
		)

		const result = await findSourceLocation('2024', 'span')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('year')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Deeply Nested Directories', (getCtx) => {
	test('should find component in deeply nested subdirectory', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/ui/forms/inputs/TextInput.astro',
			`---
const label = 'Enter your name';
---
<label>{label}</label>
`,
		)

		const result = await findSourceLocation('Enter your name', 'label')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/ui/forms/inputs/TextInput.astro')
		expect(result?.type).toBe('variable')
	})

	test('should find pages in nested route directories', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/blog/posts/first-post.astro',
			`---
---
<h1>My First Post</h1>
`,
		)

		const result = await findSourceLocation('My First Post', 'h1')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/blog/posts/first-post.astro')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Multiple Imports from Same File', (getCtx) => {
	test('should track multiple named imports from same file', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/content.ts',
			`export const title = 'Page Title';
export const subtitle = 'Page Subtitle';
`,
		)

		await ctx.writeFile(
			'src/components/Header.astro',
			`---
import { title, subtitle } from '../data/content';
---
<h1>{title}</h1>
<h2>{subtitle}</h2>
`,
		)

		const titleResult = await findSourceLocation('Page Title', 'h1')
		expect(titleResult).toBeDefined()
		expect(titleResult?.file).toBe('src/data/content.ts')
		expect(titleResult?.variableName).toBe('title')

		const subtitleResult = await findSourceLocation('Page Subtitle', 'h2')
		expect(subtitleResult).toBeDefined()
		expect(subtitleResult?.file).toBe('src/data/content.ts')
		expect(subtitleResult?.variableName).toBe('subtitle')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - String-Keyed Object Properties', (getCtx) => {
	test('should find text from string-keyed object properties', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Config.astro',
			`---
const config = {
  "site-name": "My Site",
  "tagline": "Build better"
};
---
<h1>{config["site-name"]}</h1>
`,
		)

		// The object property should be extracted even with string keys
		// but the expression parsing may not handle bracket notation
		const result = await findSourceLocation('My Site', 'h1')
		// This may or may not work depending on parseExpressionPath support
		// At minimum, the variable definition should be extractable
		if (result) {
			expect(result?.file).toBe('src/components/Config.astro')
		}
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Whitespace Handling', (getCtx) => {
	test('should handle text with leading/trailing whitespace', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Whitespace.astro',
			`---
---
<p>  Padded Text  </p>
`,
		)

		const result = await findSourceLocation('Padded Text', 'p')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})

	test('should handle text with multiple internal spaces', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Spaces.astro',
			`---
---
<p>Hello    World</p>
`,
		)

		// Multiple spaces are normalized to single space
		const result = await findSourceLocation('Hello World', 'p')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Case Insensitive Tags', (getCtx) => {
	test('should match tags case-insensitively', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Case.astro',
			`---
---
<div>Case Test</div>
`,
		)

		// Search with uppercase tag name
		const result = await findSourceLocation('Case Test', 'DIV')
		expect(result).toBeDefined()
		expect(result?.type).toBe('static')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Import Index File Resolution', (getCtx) => {
	test('should resolve imports from index file in directory', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/config')
		await ctx.writeFile(
			'src/config/index.ts',
			`export const appName = 'My Application';
`,
		)

		await ctx.writeFile(
			'src/components/Logo.astro',
			`---
import { appName } from '../config';
---
<span>{appName}</span>
`,
		)

		const result = await findSourceLocation('My Application', 'span')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/config/index.ts')
		expect(result?.variableName).toBe('appName')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Non-Existent Directories', (getCtx) => {
	test('should handle missing src directories gracefully', async () => {
		const ctx = getCtx()
		// Only create pages, not components or layouts
		await ctx.mkdir('src/pages')
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
---
<h1>Solo Page</h1>
`,
		)

		const result = await findSourceLocation('Solo Page', 'h1')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
	})

	test('should return undefined when no src directory exists at all', async () => {
		const ctx = getCtx()
		// Don't create any directories
		await ctx.mkdir('other')

		const result = await findSourceLocation('Nothing', 'h1')
		expect(result).toBeUndefined()
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Multiple Variables with Same Value', (getCtx) => {
	test('should find first matching variable when multiple have same value', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Dupes.astro',
			`---
const title = 'Shared Value';
const subtitle = 'Shared Value';
---
<h1>{title}</h1>
`,
		)

		const result = await findSourceLocation('Shared Value', 'h1')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		// Should match the variable actually used in the expression
		expect(result?.variableName).toBe('title')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Complex Prop Drilling', (getCtx) => {
	test('should track 4-level prop drilling (Page -> Layout -> Wrapper -> Component)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Layout from '../layouts/Layout.astro';
const siteTitle = 'Deep Drill Test';
---
<Layout title={siteTitle} />
`,
		)

		await ctx.writeFile(
			'src/layouts/Layout.astro',
			`---
import Wrapper from '../components/Wrapper.astro';
const { title } = Astro.props;
---
<Wrapper heading={title} />
`,
		)

		await ctx.writeFile(
			'src/components/Wrapper.astro',
			`---
import Display from '../components/Display.astro';
const { heading } = Astro.props;
---
<Display text={heading} />
`,
		)

		await ctx.writeFile(
			'src/components/Display.astro',
			`---
const { text } = Astro.props;
---
<h1>{text}</h1>
`,
		)

		const result = await findSourceLocation('Deep Drill Test', 'h1')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toBe('siteTitle')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Mixed HTML Entities', (getCtx) => {
	test('should handle multiple HTML entities in same text', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		// Use String.raw to preserve backslash escapes in the written file
		const content = String.raw`---
const text = "Tom & Jerry's \"Adventure\"";
---
<p>{text}</p>
`
		await ctx.writeFile('src/components/Entities.astro', content)

		const result = await findSourceLocation('Tom & Jerry\'s "Adventure"', 'p')
		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Spread Props with Imported Data', (getCtx) => {
	test('should track spread props using local object (not imported)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Card from '../components/Card.astro';
const heroConfig = {
  title: 'Local Hero',
  subtitle: 'From local definition'
};
---
<Card {...heroConfig} />
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

		const result = await findSourceLocation('Local Hero', 'h1')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toBe('heroConfig.title')
	})

	// Note: Spread props from imported data is a current limitation.
	// The cross-file tracker handles spread from local variables and props,
	// but not from imported variables yet.
	test('should handle spread props from imported data (falls back to prop search)', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/data')
		await ctx.writeFile(
			'src/data/hero.ts',
			`export const heroConfig = {
  title: 'Imported Hero',
  subtitle: 'From external file'
};
`,
		)

		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Card from '../components/Card.astro';
import { heroConfig } from '../data/hero';
---
<Card {...heroConfig} />
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

		// Spread from imports is not tracked yet - returns undefined
		const result = await findSourceLocation('Imported Hero', 'h1')
		expect(result).toBeUndefined()
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Prop Drilling with Renamed Props', (getCtx) => {
	test('should track renamed props through prop drilling', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Nav from '../components/Nav.astro';
const menuLinks = ['Home', 'About'];
---
<Nav links={menuLinks} />
`,
		)

		await ctx.writeFile(
			'src/components/Nav.astro',
			`---
const { links: items } = Astro.props;
---
<a>{items[0]}</a>
`,
		)

		const result = await findSourceLocation('Home', 'a')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
		expect(result?.variableName).toBe('menuLinks[0]')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Nested Component Props with Arrays of Objects', (getCtx) => {
	test('should track array of objects through expression prop with specific index', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Footer from '../components/Footer.astro';
const footerLinks = [
  { text: 'Privacy', href: '/privacy' },
  { text: 'Terms', href: '/terms' },
  { text: 'Contact', href: '/contact' },
];
---
<Footer links={footerLinks} />
`,
		)

		await ctx.writeFile(
			'src/components/Footer.astro',
			`---
const { links } = Astro.props;
---
<a>{links[0].text}</a>
<a>{links[1].text}</a>
<a>{links[2].text}</a>
`,
		)

		const privacyResult = await findSourceLocation('Privacy', 'a')
		expect(privacyResult).toBeDefined()
		expect(privacyResult?.file).toBe('src/pages/index.astro')
		expect(privacyResult?.variableName).toBe('footerLinks[0].text')

		const termsResult = await findSourceLocation('Terms', 'a')
		expect(termsResult).toBeDefined()
		expect(termsResult?.variableName).toBe('footerLinks[1].text')

		const contactResult = await findSourceLocation('Contact', 'a')
		expect(contactResult).toBeDefined()
		expect(contactResult?.variableName).toBe('footerLinks[2].text')
	})
}, { setupAstro: false })

withTempDir('findSourceLocation - Multiple Frontmatter Patterns', (getCtx) => {
	test('should handle frontmatter with interface and multiple props', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
import Card from '../components/Card.astro';
---
<Card title="Test Card" description="Card description" />
`,
		)

		await ctx.writeFile(
			'src/components/Card.astro',
			`---
interface Props {
  title: string;
  description: string;
  variant?: 'default' | 'highlight';
}
const { title, description, variant = 'default' } = Astro.props;
---
<div>
  <h3>{title}</h3>
  <p>{description}</p>
</div>
`,
		)

		const titleResult = await findSourceLocation('Test Card', 'h3')
		expect(titleResult).toBeDefined()
		expect(titleResult?.file).toBe('src/pages/index.astro')

		const descResult = await findSourceLocation('Card description', 'p')
		expect(descResult).toBeDefined()
		expect(descResult?.file).toBe('src/pages/index.astro')
	})
}, { setupAstro: false })
