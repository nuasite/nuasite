/**
 * Source finder tests: Image source finding
 *
 * Tests for finding image source locations in Astro components,
 * including various img tag formats and file types.
 */

import { expect, test } from 'bun:test'
import { findImageSourceLocation } from '../../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

withTempDir('findImageSourceLocation', (getCtx) => {
	test('should find src in single-line img tag with src first', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/CaseStudies.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Gallery.tsx',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Banner.jsx',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Gallery.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
			`---
---
<img src="/images/exists.jpg" alt="Exists" />
`,
		)

		const result = await findImageSourceLocation('/images/does-not-exist.jpg')

		expect(result).toBeUndefined()
	})

	test('should search in pages directory', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/pages/index.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/layouts/Base.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/sections/homepage/Hero.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Image.astro',
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
}, { setupAstro: false })
