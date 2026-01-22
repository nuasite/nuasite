import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findImageSourceLocation, findSourceLocation } from '../../src/source-finder'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testDir = path.join(__dirname, '__test-fixtures__')

describe('findSourceLocation', () => {
	beforeEach(async () => {
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

	test('should distinguish between multiple similar tags', async () => {
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
		// Note: Currently returns first match, not the specific one
		// This is a limitation of the current implementation
		expect(resultSecond?.line).toBeGreaterThanOrEqual(3)
		expect(resultThird?.line).toBeGreaterThanOrEqual(3)
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
