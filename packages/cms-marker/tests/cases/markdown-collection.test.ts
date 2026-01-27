import { beforeEach, expect, test } from 'bun:test'
import { findCollectionSource, findMarkdownSourceLocation, parseMarkdownContent } from '../../src/source-finder'
import { setupContentCollections, withTempDir } from '../utils'

withTempDir('findCollectionSource', (getCtx) => {
	beforeEach(async () => {
		await setupContentCollections(getCtx(), ['services', 'blog'])
	})

	test('should find collection source for simple path', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/web-design.md',
			`---
title: Web Design Services
---

Content here.
`,
		)

		const result = await findCollectionSource('/services/web-design')

		expect(result).toBeDefined()
		expect(result?.name).toBe('services')
		expect(result?.slug).toBe('web-design')
		expect(result?.file).toBe('src/content/services/web-design.md')
	})

	test('should find collection source with mdx extension', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/blog/first-post.mdx',
			`---
title: First Post
---

MDX content here.
`,
		)

		const result = await findCollectionSource('/blog/first-post')

		expect(result).toBeDefined()
		expect(result?.name).toBe('blog')
		expect(result?.slug).toBe('first-post')
		expect(result?.file).toBe('src/content/blog/first-post.mdx')
	})

	test('should handle paths with leading/trailing slashes', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/seo.md',
			`---
title: SEO Services
---
`,
		)

		const result = await findCollectionSource('///services/seo///')

		expect(result).toBeDefined()
		expect(result?.slug).toBe('seo')
	})

	test('should return undefined for non-existent collection', async () => {
		const result = await findCollectionSource('/unknown/page')

		expect(result).toBeUndefined()
	})

	test('should return undefined for non-existent entry', async () => {
		const result = await findCollectionSource('/services/nonexistent')

		expect(result).toBeUndefined()
	})

	test('should return undefined for paths without collection/slug structure', async () => {
		const result = await findCollectionSource('/about')

		expect(result).toBeUndefined()
	})

	test('should work with custom content directory', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'content/posts/hello.md',
			`---
title: Hello
---
`,
		)

		const result = await findCollectionSource('/posts/hello', 'content')

		expect(result).toBeDefined()
		expect(result?.name).toBe('posts')
		expect(result?.slug).toBe('hello')
		expect(result?.file).toBe('content/posts/hello.md')
	})

	test('should find index.md files in slug directories', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/enterprise/index.md',
			`---
title: Enterprise Solutions
---
`,
		)

		const result = await findCollectionSource('/services/enterprise')

		expect(result).toBeDefined()
		expect(result?.slug).toBe('enterprise')
		expect(result?.file).toBe('src/content/services/enterprise/index.md')
	})
})

withTempDir('findMarkdownSourceLocation', (getCtx) => {
	beforeEach(async () => {
		await setupContentCollections(getCtx(), ['services'])
	})

	test('should find text in frontmatter title', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/3d-print.md',
			`---
title: 3D Printing Services
subtitle: Fast and reliable
---

Body content.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: '3d-print',
			file: 'src/content/services/3d-print.md',
		}

		const result = await findMarkdownSourceLocation('3D Printing Services', collectionInfo)

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/content/services/3d-print.md')
		expect(result?.line).toBe(2)
		expect(result?.type).toBe('collection')
		expect(result?.variableName).toBe('title')
		expect(result?.collectionName).toBe('services')
		expect(result?.collectionSlug).toBe('3d-print')
	})

	test('should find text in frontmatter subtitle', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/design.md',
			`---
title: Design
subtitle: Creative solutions for your brand
---
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'design',
			file: 'src/content/services/design.md',
		}

		const result = await findMarkdownSourceLocation('Creative solutions for your brand', collectionInfo)

		expect(result).toBeDefined()
		expect(result?.line).toBe(3)
		expect(result?.variableName).toBe('subtitle')
	})

	test('should handle quoted frontmatter values', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/support.md',
			`---
title: "24/7 Support Services"
---
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'support',
			file: 'src/content/services/support.md',
		}

		const result = await findMarkdownSourceLocation('24/7 Support Services', collectionInfo)

		expect(result).toBeDefined()
		expect(result?.line).toBe(2)
		expect(result?.variableName).toBe('title')
	})

	test('should handle single-quoted frontmatter values', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/api.md',
			`---
title: 'API Integration'
---
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'api',
			file: 'src/content/services/api.md',
		}

		const result = await findMarkdownSourceLocation('API Integration', collectionInfo)

		expect(result).toBeDefined()
		expect(result?.line).toBe(2)
	})

	test('should return undefined for text in body (body is handled separately)', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/consulting.md',
			`---
title: Consulting
---

We provide expert consulting services.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'consulting',
			file: 'src/content/services/consulting.md',
		}

		// Body content should NOT be found by findMarkdownSourceLocation
		// Use parseMarkdownContent instead to get the full body
		const result = await findMarkdownSourceLocation('We provide expert consulting services.', collectionInfo)

		expect(result).toBeUndefined()
	})

	test('should return undefined when text not found', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/empty.md',
			`---
title: Empty
---

Nothing here.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'empty',
			file: 'src/content/services/empty.md',
		}

		const result = await findMarkdownSourceLocation('Some non-existent text', collectionInfo)

		expect(result).toBeUndefined()
	})
})

withTempDir('parseMarkdownContent', (getCtx) => {
	beforeEach(async () => {
		await setupContentCollections(getCtx(), ['services'])
	})

	test('should parse frontmatter fields with line numbers', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/web.md',
			`---
title: Web Services
subtitle: Fast and modern
description: We build amazing websites
---

Body content here.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'web',
			file: 'src/content/services/web.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(result?.frontmatter.title).toEqual({ value: 'Web Services', line: 2 })
		expect(result?.frontmatter.subtitle).toEqual({ value: 'Fast and modern', line: 3 })
		expect(result?.frontmatter.description).toEqual({ value: 'We build amazing websites', line: 4 })
	})

	test('should return full body content as single value', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/full.md',
			`---
title: Full Content
---

This is the first paragraph.

This is the second paragraph with **bold** text.

### A heading

- List item 1
- List item 2
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'full',
			file: 'src/content/services/full.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(result?.body).toContain('This is the first paragraph.')
		expect(result?.body).toContain('This is the second paragraph with **bold** text.')
		expect(result?.body).toContain('### A heading')
		expect(result?.body).toContain('- List item 1')
		expect(result?.body).toContain('- List item 2')
	})

	test('should return correct body start line', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/lines.md',
			`---
title: Lines Test
subtitle: Testing line numbers
---

Body starts here.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'lines',
			file: 'src/content/services/lines.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(result?.bodyStartLine).toBe(5) // Line after closing ---
	})

	test('should include collection metadata', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/meta.md',
			`---
title: Meta Test
---

Content.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'meta',
			file: 'src/content/services/meta.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(result?.collectionName).toBe('services')
		expect(result?.collectionSlug).toBe('meta')
		expect(result?.file).toBe('src/content/services/meta.md')
	})

	test('should handle quoted frontmatter values', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/quotes.md',
			`---
title: "Quoted Title"
subtitle: 'Single Quoted'
---
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'quotes',
			file: 'src/content/services/quotes.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(result?.frontmatter.title).toEqual({ value: 'Quoted Title', line: 2 })
		expect(result?.frontmatter.subtitle).toEqual({ value: 'Single Quoted', line: 3 })
	})

	test('should handle empty body', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/empty-body.md',
			`---
title: No Body
---
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'empty-body',
			file: 'src/content/services/empty-body.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(result?.body).toBe('')
		expect(result?.frontmatter.title).toEqual({ value: 'No Body', line: 2 })
	})

	test('should handle file without frontmatter', async () => {
		const ctx = getCtx()
		await ctx.writeFile(
			'src/content/services/no-front.md',
			`Just some content without frontmatter.

More content here.
`,
		)

		const collectionInfo = {
			name: 'services',
			slug: 'no-front',
			file: 'src/content/services/no-front.md',
		}

		const result = await parseMarkdownContent(collectionInfo)

		expect(result).toBeDefined()
		expect(Object.keys(result?.frontmatter || {})).toHaveLength(0)
		expect(result?.body).toContain('Just some content without frontmatter.')
		expect(result?.bodyStartLine).toBe(1)
	})
})
