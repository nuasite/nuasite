import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearSourceFinderCache, findImageSourceLocation, findSourceLocation } from '../../src/source-finder'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testDir = path.join(__dirname, '__test-fixtures__')

describe('findSourceLocation', () => {
	beforeEach(async () => {
		// Clear caches from previous tests
		clearSourceFinderCache()

		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/components'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/pages'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/layouts'), { recursive: true })

		// Change to test directory
		process.chdir(testDir)
	})

	afterEach(async () => {
		// Change back and cleanup
		process.chdir(path.dirname(testDir))
		await fs.rm(testDir, { recursive: true, force: true })
	})

	test('should find simple text in component', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Test.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Button.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Typed.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Multi.astro'),
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
		// Use String.raw to preserve the backslash
		const content = String.raw`---
const text = 'What\'s up';
---
<p>{text}</p>
`
		await fs.writeFile(
			path.join(testDir, 'src/components/Quote.astro'),
			content,
		)

		const result = await findSourceLocation("What's up", 'p')

		expect(result).toBeDefined()
		expect(result?.line).toBe(2) // Definition line with escaped quote
		expect(result?.type).toBe('variable')
	})

	test('should return undefined when text not found', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Empty.astro'),
			`---
---
<div>Nothing here</div>
`,
		)

		const result = await findSourceLocation('Something else', 'div')

		expect(result).toBeUndefined()
	})

	test('should match first few words for long text', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Long.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/layouts/Base.astro'),
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
		await fs.mkdir(path.join(testDir, 'src/components/ui'), { recursive: true })
		await fs.writeFile(
			path.join(testDir, 'src/components/ui/Card.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/MultiLine.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Multiple.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Entity.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Template.astro'),
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

	test('should find prop values passed to components', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/layouts/Layout.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Card.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/pages/cards.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Header.astro'),
			`---
---
<h1>Static Title</h1>
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/pages/home.astro'),
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

	test('should handle short text content', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Badge.astro'),
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

	test('snippet should contain only innerHTML, not the complete element with tags', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Heading.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Para.astro'),
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
		// This tests the case where <a> tag has attributes on multiple lines
		// and the text content is on yet another line
		await fs.writeFile(
			path.join(testDir, 'src/components/Link.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Styled.astro'),
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
})

describe('findImageSourceLocation', () => {
	beforeEach(async () => {
		// Clear caches from previous tests
		clearSourceFinderCache()

		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/components'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/pages'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/layouts'), { recursive: true })

		// Change to test directory
		process.chdir(testDir)
	})

	afterEach(async () => {
		// Change back and cleanup
		process.chdir(path.dirname(testDir))
		await fs.rm(testDir, { recursive: true, force: true })
	})

	test('should find src in single-line img tag with src first', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img src="/images/hero.jpg" alt="Hero image" class="w-full" />
`,
		)

		const result = await findImageSourceLocation('/images/hero.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(3)
		expect(result?.type).toBe('static')
	})

	test('should find src in single-line img tag with src last', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img alt="Hero image" class="w-full" src="/images/hero.jpg" />
`,
		)

		const result = await findImageSourceLocation('/images/hero.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(3)
	})

	test('should find src in multi-line img tag with src on first attribute line', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img
  src="/images/photo.webp"
  alt="Photo description"
  class="rounded-lg"
/>
`,
		)

		const result = await findImageSourceLocation('/images/photo.webp')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(4) // Line with src attribute
	})

	test('should find src in multi-line img tag with src in middle', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img
  decoding="async"
  src="/assets/product-image.png"
  class="w-full h-auto"
  alt="Product"
/>
`,
		)

		const result = await findImageSourceLocation('/assets/product-image.png')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(5) // Line with src attribute
	})

	test('should find src in multi-line img tag with src after alt (the bug case)', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/CaseStudies.astro'),
			`---
---
<div class="relative">
  <img
    decoding="async"
    src="/assets/case-study.webp"
    class="w-full h-auto object-cover"
    alt="Hibiki Suntory Whisky display"
  />
</div>
`,
		)

		const result = await findImageSourceLocation('/assets/case-study.webp')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/CaseStudies.astro')
		expect(result?.line).toBe(6) // Line with src, NOT the alt line (8)
	})

	test('should find src in multi-line img tag with src on last line before closing', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img
  alt="Gallery image"
  class="gallery-img"
  loading="lazy"
  src="/gallery/item-1.jpg"
/>
`,
		)

		const result = await findImageSourceLocation('/gallery/item-1.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(7) // Line with src attribute
	})

	test('should find src with single quotes', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img src='/images/single-quote.jpg' alt='Image' />
`,
		)

		const result = await findImageSourceLocation('/images/single-quote.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(3)
	})

	test('should find src in non-self-closing img tag', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img src="/images/old-style.jpg" alt="Old style">
`,
		)

		const result = await findImageSourceLocation('/images/old-style.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Image.astro')
		expect(result?.line).toBe(3)
	})

	test('should find image in TSX file', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Gallery.tsx'),
			`export function Gallery() {
  return (
    <div>
      <img
        src="/images/tsx-image.png"
        alt="TSX Image"
        className="w-full"
      />
    </div>
  );
}
`,
		)

		const result = await findImageSourceLocation('/images/tsx-image.png')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Gallery.tsx')
		expect(result?.line).toBe(5) // Line with src attribute
	})

	test('should find image in JSX file', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Banner.jsx'),
			`export function Banner() {
  return (
    <img src="/images/banner.jpg" alt="Banner" />
  );
}
`,
		)

		const result = await findImageSourceLocation('/images/banner.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Banner.jsx')
		expect(result?.line).toBe(3)
	})

	test('should find correct image when multiple images exist', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Gallery.astro'),
			`---
---
<div>
  <img src="/images/first.jpg" alt="First" />
  <img src="/images/second.jpg" alt="Second" />
  <img src="/images/third.jpg" alt="Third" />
</div>
`,
		)

		const resultFirst = await findImageSourceLocation('/images/first.jpg')
		const resultSecond = await findImageSourceLocation('/images/second.jpg')
		const resultThird = await findImageSourceLocation('/images/third.jpg')

		expect(resultFirst?.line).toBe(4)
		expect(resultSecond?.line).toBe(5)
		expect(resultThird?.line).toBe(6)
	})

	test('should return undefined for non-existent image', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img src="/images/exists.jpg" alt="Exists" />
`,
		)

		const result = await findImageSourceLocation('/images/does-not-exist.jpg')

		expect(result).toBeUndefined()
	})

	test('should search in pages directory', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
---
<img src="/hero-image.webp" alt="Hero" />
`,
		)

		const result = await findImageSourceLocation('/hero-image.webp')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/pages/index.astro')
	})

	test('should search in layouts directory', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/layouts/Base.astro'),
			`---
---
<img src="/logo.svg" alt="Logo" />
`,
		)

		const result = await findImageSourceLocation('/logo.svg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/layouts/Base.astro')
	})

	test('should handle nested component directories', async () => {
		await fs.mkdir(path.join(testDir, 'src/components/sections/homepage'), { recursive: true })
		await fs.writeFile(
			path.join(testDir, 'src/components/sections/homepage/Hero.astro'),
			`---
---
<img src="/sections/hero-bg.jpg" alt="Hero Background" />
`,
		)

		const result = await findImageSourceLocation('/sections/hero-bg.jpg')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/sections/homepage/Hero.astro')
	})

	test('snippet should contain the full img tag', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img src="/images/test.jpg" alt="Test" class="rounded" />
`,
		)

		const result = await findImageSourceLocation('/images/test.jpg')

		expect(result).toBeDefined()
		expect(result?.snippet).toContain('<img')
		expect(result?.snippet).toContain('src="/images/test.jpg"')
	})

	test('snippet should contain multi-line img tag', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Image.astro'),
			`---
---
<img
  src="/images/multiline.jpg"
  alt="Multi-line"
  class="w-full"
/>
`,
		)

		const result = await findImageSourceLocation('/images/multiline.jpg')

		expect(result).toBeDefined()
		expect(result?.snippet).toContain('src="/images/multiline.jpg"')
		expect(result?.snippet).toContain('alt="Multi-line"')
		expect(result?.snippet).toContain('/>')
	})
})

describe('findSourceLocation - Arrays and Nested Objects', () => {
	beforeEach(async () => {
		clearSourceFinderCache()

		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/components'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/pages'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/layouts'), { recursive: true })

		process.chdir(testDir)
	})

	afterEach(async () => {
		process.chdir(path.dirname(testDir))
		await fs.rm(testDir, { recursive: true, force: true })
	})

	test('should find text from array element', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Dashboard.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Links.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Site.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/List.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Menu.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Complex.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/components/Numbers.astro'),
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

	// Expression props (items={items}) ARE tracked across files
	test('should track array passed as expression prop between files', async () => {
		// Parent page passes array as expression prop
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
import Nav from '../components/Nav.astro';
const navItems = ['Home', 'About', 'Contact'];
---
<Nav items={navItems} />
`,
		)

		// Child component receives and uses the array
		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/home.astro'),
			`---
import Hero from '../components/Hero.astro';
---
<Hero title="Welcome Home" />
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Hero.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/dashboard.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/components/Header.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/menu.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/components/Navigation.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/layouts/BaseLayout.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/pages/home.astro'),
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
})

describe('findSourceLocation - Edge Cases', () => {
	beforeEach(async () => {
		clearSourceFinderCache()

		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/components'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/pages'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/layouts'), { recursive: true })

		process.chdir(testDir)
	})

	afterEach(async () => {
		process.chdir(path.dirname(testDir))
		await fs.rm(testDir, { recursive: true, force: true })
	})

	// Edge case: Renamed destructured props
	// const { items: navItems } = Astro.props; -> local var is 'navItems', prop name is 'items'
	test('should handle renamed destructured props', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
import Nav from '../components/Nav.astro';
const menuItems = ['Home', 'About'];
---
<Nav items={menuItems} />
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
import Nav from '../components/Nav.astro';
const menuItems = ['Home', 'About'];
---
<Nav items={menuItems} />
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/components/NavA.astro'),
			`---
const { items } = Astro.props;
---
<a>{items[0]}</a>
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/NavB.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
import Layout from '../layouts/Layout.astro';
const navItems = ['Home', 'About'];
---
<Layout items={navItems}>
  <h1>Content</h1>
</Layout>
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/layouts/Layout.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
import Card from '../components/Card.astro';
const cardProps = { title: 'Hello', subtitle: 'World' };
---
<Card {...cardProps} />
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Card.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/about.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/components/Hero.astro'),
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
})

describe('findSourceLocation - External Imports', () => {
	beforeEach(async () => {
		clearSourceFinderCache()

		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/components'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/pages'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/data'), { recursive: true })

		process.chdir(testDir)
	})

	afterEach(async () => {
		process.chdir(path.dirname(testDir))
		await fs.rm(testDir, { recursive: true, force: true })
	})

	test('should track simple string from external import', async () => {
		// Create the data file with exported value
		await fs.writeFile(
			path.join(testDir, 'src/data/config.ts'),
			`export const siteTitle = 'My Amazing Site';
`,
		)

		// Create a component that imports and uses it
		await fs.writeFile(
			path.join(testDir, 'src/components/Header.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/navigation.ts'),
			`export const navItems = ['Home', 'About', 'Contact'];
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/site.ts'),
			`export const config = {
  meta: {
    title: 'Site Title',
    description: 'Site Description'
  }
};
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Meta.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/links.ts'),
			`export const links = [
  { text: 'GitHub', url: 'https://github.com' },
  { text: 'Twitter', url: 'https://twitter.com' }
];
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Footer.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/strings.ts'),
			`export const greeting = 'Hello World';
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Welcome.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/defaults.ts'),
			`const config = {
  appName: 'My App'
};
export default config;
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/App.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/messages.ts'),
			`export const welcome = 'Welcome to the site';
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Banner.astro'),
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
})

describe('findSourceLocation - Multiple Same-Tag Elements', () => {
	beforeEach(async () => {
		clearSourceFinderCache()

		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/components'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/pages'), { recursive: true })
		await fs.mkdir(path.join(testDir, 'src/data'), { recursive: true })

		process.chdir(testDir)
	})

	afterEach(async () => {
		process.chdir(path.dirname(testDir))
		await fs.rm(testDir, { recursive: true, force: true })
	})

	test('should find correct element among multiple same-tag with array props', async () => {
		await fs.writeFile(
			path.join(testDir, 'src/pages/index.astro'),
			`---
import Nav from '../components/Nav.astro';
const navItems = ['Home', 'About', 'Contact'];
---
<Nav items={navItems} />
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Nav.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/links.ts'),
			`export const links = ['GitHub', 'Twitter', 'LinkedIn'];
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Social.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/pages/menu.astro'),
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

		await fs.writeFile(
			path.join(testDir, 'src/components/Menu.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/nav.ts'),
			`export const navLinks = [
  { text: 'Home', url: '/' },
  { text: 'Blog', url: '/blog' },
  { text: 'Contact', url: '/contact' }
];
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Header.astro'),
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
		await fs.writeFile(
			path.join(testDir, 'src/data/config.ts'),
			`export const appName = 'MyApp';
`,
		)

		await fs.writeFile(
			path.join(testDir, 'src/components/Mixed.astro'),
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
})
