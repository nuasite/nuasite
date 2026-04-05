/**
 * Source finder tests: Search Index
 *
 * Tests for the search index functionality including:
 * - File collection (collectAstroFiles)
 * - Index initialization (initializeSearchIndex)
 * - Content indexing (indexFileContent, indexFileImages)
 * - Index lookups (findInTextIndex, findInImageIndex)
 */

import type { Node as AstroNode } from '@astrojs/compiler/types'
import { describe, expect, test } from 'bun:test'
import {
	addToImageSearchIndex,
	addToTextSearchIndex,
	clearSourceFinderCache,
	getImageSearchIndex,
	getTextSearchIndex,
	isSearchIndexInitialized,
} from '../../../src/source-finder/cache'
import {
	collectAstroFiles,
	findInImageIndex,
	findInTextIndex,
	indexFileContent,
	indexFileImages,
	initializeSearchIndex,
	isChildOfArray,
	resolveMapChain,
} from '../../../src/source-finder/search-index'
import type { CachedParsedFile } from '../../../src/source-finder/types'
import { setupAstroProjectStructure, withTempDir } from '../../utils'

// ============================================================================
// collectAstroFiles Tests
// ============================================================================

withTempDir('collectAstroFiles', (getCtx) => {
	test('should collect .astro files', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/components')
		await ctx.writeFile('src/components/Button.astro', '<button>Click</button>')
		await ctx.writeFile('src/components/Card.astro', '<div>Card</div>')

		const files = await collectAstroFiles(`${ctx.tempDir}/src/components`)

		expect(files).toHaveLength(2)
		expect(files.some(f => f.endsWith('Button.astro'))).toBe(true)
		expect(files.some(f => f.endsWith('Card.astro'))).toBe(true)
	})

	test('should collect .tsx files', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/components')
		await ctx.writeFile('src/components/Button.tsx', 'export const Button = () => <button />')

		const files = await collectAstroFiles(`${ctx.tempDir}/src/components`)

		expect(files).toHaveLength(1)
		expect(files[0]).toContain('Button.tsx')
	})

	test('should collect .jsx files', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/components')
		await ctx.writeFile('src/components/Button.jsx', 'export const Button = () => <button />')

		const files = await collectAstroFiles(`${ctx.tempDir}/src/components`)

		expect(files).toHaveLength(1)
		expect(files[0]).toContain('Button.jsx')
	})

	test('should collect files recursively from nested directories', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/components/ui')
		await ctx.mkdir('src/components/layout')
		await ctx.writeFile('src/components/Button.astro', '<button />')
		await ctx.writeFile('src/components/ui/Card.astro', '<div />')
		await ctx.writeFile('src/components/layout/Header.astro', '<header />')

		const files = await collectAstroFiles(`${ctx.tempDir}/src/components`)

		expect(files).toHaveLength(3)
		expect(files.some(f => f.endsWith('Button.astro'))).toBe(true)
		expect(files.some(f => f.includes('ui/Card.astro'))).toBe(true)
		expect(files.some(f => f.includes('layout/Header.astro'))).toBe(true)
	})

	test('should ignore non-supported file types', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/components')
		await ctx.writeFile('src/components/Button.astro', '<button />')
		await ctx.writeFile('src/components/styles.css', '.button {}')
		await ctx.writeFile('src/components/utils.ts', 'export const x = 1')
		await ctx.writeFile('src/components/README.md', '# Components')

		const files = await collectAstroFiles(`${ctx.tempDir}/src/components`)

		expect(files).toHaveLength(1)
		expect(files[0]).toContain('Button.astro')
	})

	test('should return empty array for non-existent directory', async () => {
		const ctx = getCtx()

		const files = await collectAstroFiles(`${ctx.tempDir}/non-existent`)

		expect(files).toEqual([])
	})

	test('should return empty array for empty directory', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/empty')

		const files = await collectAstroFiles(`${ctx.tempDir}/src/empty`)

		expect(files).toEqual([])
	})

	test('should cache directory results', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/components')
		await ctx.writeFile('src/components/Button.astro', '<button />')

		// First call
		const files1 = await collectAstroFiles(`${ctx.tempDir}/src/components`)
		// Second call should return cached result
		const files2 = await collectAstroFiles(`${ctx.tempDir}/src/components`)

		expect(files1).toEqual(files2)
		// Both should reference the same array (cached)
		expect(files1).toBe(files2)
	})
})

// ============================================================================
// initializeSearchIndex Tests
// ============================================================================

withTempDir('initializeSearchIndex', (getCtx) => {
	test('should initialize search index from project files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Button.astro',
			`---
---
<button>Click Me</button>
`,
		)

		await initializeSearchIndex()

		expect(isSearchIndexInitialized()).toBe(true)
		const textIndex = getTextSearchIndex()
		expect(textIndex.length).toBeGreaterThan(0)
	})

	test('should not re-initialize if already initialized', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Test.astro',
			`---
---
<h1>Hello</h1>
`,
		)

		await initializeSearchIndex()
		const indexSize1 = getTextSearchIndex().length

		// Add more files
		await ctx.writeFile(
			'src/components/Another.astro',
			`---
---
<h2>World</h2>
`,
		)

		// Re-initialize should not add more entries
		await initializeSearchIndex()
		const indexSize2 = getTextSearchIndex().length

		expect(indexSize1).toBe(indexSize2)
	})

	test('should index files from components, pages, and layouts', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.writeFile(
			'src/components/Button.astro',
			`---
---
<button>Component Button</button>
`,
		)
		await ctx.writeFile(
			'src/pages/index.astro',
			`---
---
<h1>Page Title</h1>
`,
		)
		await ctx.writeFile(
			'src/layouts/Base.astro',
			`---
---
<title>Layout Title</title>
`,
		)

		await initializeSearchIndex()

		const textIndex = getTextSearchIndex()
		const files = [...new Set(textIndex.map(e => e.file))]

		expect(files.some(f => f.includes('components/Button.astro'))).toBe(true)
		expect(files.some(f => f.includes('pages/index.astro'))).toBe(true)
		expect(files.some(f => f.includes('layouts/Base.astro'))).toBe(true)
	})

	test('should skip directories that do not exist', async () => {
		const ctx = getCtx()
		// Only create components, not pages or layouts
		await ctx.mkdir('src/components')
		await ctx.writeFile(
			'src/components/Test.astro',
			`---
---
<div>Test</div>
`,
		)

		// Should not throw
		await initializeSearchIndex()

		expect(isSearchIndexInitialized()).toBe(true)
	})
})

// ============================================================================
// indexFileContent Tests
// ============================================================================

withTempDir('indexFileContent', (getCtx) => {
	test('should index static text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', '---', '<h1>Hello World</h1>'],
			ast: createMockAst([
				createMockElement('h1', 'Hello World', 3),
			]),
		})

		indexFileContent(cached, 'src/components/Test.astro')

		const index = getTextSearchIndex()
		const entry = index.find(e => e.normalizedText === 'hello world')

		expect(entry).toBeDefined()
		expect(entry?.file).toBe('src/components/Test.astro')
		expect(entry?.tag).toBe('h1')
		expect(entry?.type).toBe('static')
	})

	test('should index variable text content', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', 'const title = "Hello World"', '---', '<h1>{title}</h1>'],
			ast: createMockAst([
				createMockElementWithExpression('h1', 'title', 4),
			]),
			variableDefinitions: [
				{ name: 'title', value: 'Hello World', line: 2 },
			],
		})

		indexFileContent(cached, 'src/components/Test.astro')

		const index = getTextSearchIndex()
		const variableEntry = index.find(e => e.type === 'variable' && e.variableName === 'title')

		expect(variableEntry).toBeDefined()
		expect(variableEntry?.normalizedText).toBe('hello world')
		expect(variableEntry?.definitionLine).toBe(2)
	})

	test('should index component props', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', '---', '<Button label="Click Me" />'],
			ast: createMockAst([
				createMockComponent('Button', [{ name: 'label', value: 'Click Me', line: 3 }], 3),
			]),
		})

		indexFileContent(cached, 'src/components/Test.astro')

		const index = getTextSearchIndex()
		const propEntry = index.find(e => e.type === 'prop' && e.variableName === 'label')

		expect(propEntry).toBeDefined()
		expect(propEntry?.normalizedText).toBe('click me')
	})

	test('should normalize text for indexing', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', '---', '<p>  Hello   World  </p>'],
			ast: createMockAst([
				createMockElement('p', '  Hello   World  ', 3),
			]),
		})

		indexFileContent(cached, 'src/components/Test.astro')

		const index = getTextSearchIndex()
		const entry = index.find(e => e.normalizedText === 'hello world')

		expect(entry).toBeDefined()
	})

	test('should skip text shorter than 2 characters', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', '---', '<span>X</span>'],
			ast: createMockAst([
				createMockElement('span', 'X', 3),
			]),
		})

		indexFileContent(cached, 'src/components/Test.astro')

		const index = getTextSearchIndex()
		const entry = index.find(e => e.normalizedText === 'x')

		expect(entry).toBeUndefined()
	})

	test('should handle nested object variable paths', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', 'const config = { nav: { title: "Home" } }', '---', '<a>{config.nav.title}</a>'],
			ast: createMockAst([
				createMockElementWithExpression('a', 'config.nav.title', 4),
			]),
			variableDefinitions: [
				{ name: 'title', value: 'Home', line: 2, parentName: 'config.nav' },
			],
		})

		indexFileContent(cached, 'src/components/Test.astro')

		const index = getTextSearchIndex()
		const entry = index.find(e => e.type === 'variable' && e.variableName === 'config.nav.title')

		expect(entry).toBeDefined()
		expect(entry?.normalizedText).toBe('home')
	})
})

// ============================================================================
// indexFileImages Tests
// ============================================================================

withTempDir('indexFileImages', (getCtx) => {
	test('should index images from Astro files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', '---', '<img src="/images/hero.png" alt="Hero" />'],
			ast: createMockAst([
				createMockImage('/images/hero.png', 3),
			]),
		})

		indexFileImages(cached, 'src/components/Hero.astro')

		const index = getImageSearchIndex()
		const entry = index.find(e => e.src === '/images/hero.png')

		expect(entry).toBeDefined()
		expect(entry?.file).toBe('src/components/Hero.astro')
		expect(entry?.line).toBe(3)
	})

	test('should index images from tsx/jsx files using regex', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: [
				'export function Hero() {',
				'  return <img src="/images/hero.png" alt="Hero" />',
				'}',
			],
			ast: { type: 'root', children: [] } as unknown as AstroNode,
		})

		indexFileImages(cached, 'src/components/Hero.tsx')

		const index = getImageSearchIndex()
		const entry = index.find(e => e.src === '/images/hero.png')

		expect(entry).toBeDefined()
		expect(entry?.file).toBe('src/components/Hero.tsx')
		expect(entry?.line).toBe(2)
	})

	test('should handle single-quoted src attributes in tsx/jsx', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: [
				'export function Hero() {',
				"  return <img src='/images/hero.png' alt='Hero' />",
				'}',
			],
			ast: { type: 'root', children: [] } as unknown as AstroNode,
		})

		indexFileImages(cached, 'src/components/Hero.jsx')

		const index = getImageSearchIndex()
		const entry = index.find(e => e.src === '/images/hero.png')

		expect(entry).toBeDefined()
	})

	test('should index multiple images per file', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const cached = createMockCachedFile({
			lines: ['---', '---', '<img src="/a.png" />', '<img src="/b.png" />'],
			ast: createMockAst([
				createMockImage('/a.png', 3),
				createMockImage('/b.png', 4),
			]),
		})

		indexFileImages(cached, 'src/components/Gallery.astro')

		const index = getImageSearchIndex()
		const entries = index.filter(e => e.file === 'src/components/Gallery.astro')

		expect(entries).toHaveLength(2)
	})
})

// ============================================================================
// findInTextIndex Tests
// ============================================================================

withTempDir('findInTextIndex', (getCtx) => {
	test('should find exact match with same tag', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToTextSearchIndex({
			file: 'src/components/Test.astro',
			line: 3,
			snippet: '<h1>Hello World</h1>',
			type: 'static',
			normalizedText: 'hello world',
			tag: 'h1',
		})

		const result = findInTextIndex('Hello World', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Test.astro')
		expect(result?.line).toBe(3)
		expect(result?.type).toBe('static')
	})

	test('should find partial match for long text', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToTextSearchIndex({
			file: 'src/components/Test.astro',
			line: 3,
			snippet: '<p>This is a very long paragraph with lots of content</p>',
			type: 'static',
			normalizedText: 'this is a very long paragraph with lots of content',
			tag: 'p',
		})

		const result = findInTextIndex('This is a very long paragraph with lots of content', 'p')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Test.astro')
	})

	test('should fall back to any tag match', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToTextSearchIndex({
			file: 'src/components/Test.astro',
			line: 3,
			snippet: '<span>Hello World</span>',
			type: 'static',
			normalizedText: 'hello world',
			tag: 'span',
		})

		// Search with different tag
		const result = findInTextIndex('Hello World', 'div')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Test.astro')
	})

	test('should return undefined when not found', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const result = findInTextIndex('Non-existent text', 'h1')

		expect(result).toBeUndefined()
	})

	test('should include variable information in result', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToTextSearchIndex({
			file: 'src/components/Test.astro',
			line: 2,
			snippet: 'const title = "Hello"',
			type: 'variable',
			variableName: 'title',
			definitionLine: 2,
			normalizedText: 'hello',
			tag: 'h1',
		})

		const result = findInTextIndex('Hello', 'h1')

		expect(result).toBeDefined()
		expect(result?.type).toBe('variable')
		expect(result?.variableName).toBe('title')
		expect(result?.definitionLine).toBe(2)
	})

	test('should prefer exact tag match over any tag match', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToTextSearchIndex({
			file: 'src/components/Wrong.astro',
			line: 3,
			snippet: '<span>Hello</span>',
			type: 'static',
			normalizedText: 'hello',
			tag: 'span',
		})
		addToTextSearchIndex({
			file: 'src/components/Correct.astro',
			line: 5,
			snippet: '<h1>Hello</h1>',
			type: 'static',
			normalizedText: 'hello',
			tag: 'h1',
		})

		const result = findInTextIndex('Hello', 'h1')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Correct.astro')
	})
})

// ============================================================================
// findInImageIndex Tests
// ============================================================================

withTempDir('findInImageIndex', (getCtx) => {
	test('should find image by exact src match', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToImageSearchIndex({
			file: 'src/components/Hero.astro',
			line: 3,
			snippet: '<img src="/images/hero.png" />',
			src: '/images/hero.png',
		})

		const result = findInImageIndex('/images/hero.png')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/Hero.astro')
		expect(result?.line).toBe(3)
		expect(result?.type).toBe('static')
	})

	test('should return undefined when image not found', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		const result = findInImageIndex('/images/nonexistent.png')

		expect(result).toBeUndefined()
	})

	test('should find first match when multiple images have same src', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		addToImageSearchIndex({
			file: 'src/components/First.astro',
			line: 3,
			snippet: '<img src="/logo.png" />',
			src: '/logo.png',
		})
		addToImageSearchIndex({
			file: 'src/components/Second.astro',
			line: 5,
			snippet: '<img src="/logo.png" />',
			src: '/logo.png',
		})

		const result = findInImageIndex('/logo.png')

		expect(result).toBeDefined()
		expect(result?.file).toBe('src/components/First.astro')
	})
})

// ============================================================================
// resolveMapChain Tests
// ============================================================================

describe('resolveMapChain', () => {
	test('simple .map() with single parameter', () => {
		const result = resolveMapChain(['images.map((img, i) => (\n  '], 'img')
		expect(result).toBe('images')
	})

	test('nested .map() chains', () => {
		const result = resolveMapChain(
			['categories.map((cat) => (\n  cat.images.map((img, i) => (\n    '],
			'img',
		)
		expect(result).toBe('categories[*].images')
	})

	test('returns null for unknown parameter', () => {
		const result = resolveMapChain(['images.map((img) => (\n  '], 'unknown')
		expect(result).toBeNull()
	})

	test('returns null for no .map() calls', () => {
		const result = resolveMapChain(['<div>{title}</div>'], 'title')
		expect(result).toBeNull()
	})
})

// ============================================================================
// isChildOfArray Tests
// ============================================================================

describe('isChildOfArray', () => {
	test('simple array: images[0] is child of images', () => {
		expect(isChildOfArray('images[0]', 'images')).toBe(true)
		expect(isChildOfArray('images[5]', 'images')).toBe(true)
	})

	test('simple array: images[0].url is NOT child of images', () => {
		expect(isChildOfArray('images[0].url', 'images')).toBe(false)
	})

	test('nested wildcard: categories[0].images[1] is child of categories[*].images', () => {
		expect(isChildOfArray('categories[0].images[1]', 'categories[*].images')).toBe(true)
		expect(isChildOfArray('categories[3].images[0]', 'categories[*].images')).toBe(true)
	})

	test('nested wildcard: wrong depth is NOT child', () => {
		expect(isChildOfArray('categories[0].images', 'categories[*].images')).toBe(false)
		expect(isChildOfArray('categories[0].images[1].url', 'categories[*].images')).toBe(false)
	})

	test('different path is NOT child', () => {
		expect(isChildOfArray('other[0]', 'images')).toBe(false)
	})
})

// ============================================================================
// indexFileImages: expression src via AST
// ============================================================================

withTempDir('indexFileImages expression src', (getCtx) => {
	test('should index images from expression src={img} in .map() via AST', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		const { parse } = await import('@astrojs/compiler')

		const source = [
			'---',
			'const images = ["/assets/a.png", "/assets/b.png"];',
			'---',
			'<div>',
			'{images.map((img) => (',
			'  <img src={img} alt="photo" />',
			'))}',
			'</div>',
		].join('\n')

		const parsed = await parse(source)
		const cached = createMockCachedFile({
			lines: source.split('\n'),
			ast: parsed.ast as unknown as AstroNode,
			variableDefinitions: [
				{ name: '0', value: '/assets/a.png', line: 2, parentName: 'images' },
				{ name: '1', value: '/assets/b.png', line: 2, parentName: 'images' },
			],
		})

		indexFileImages(cached, 'src/components/Gallery.astro')

		const resultA = findInImageIndex('/assets/a.png')
		expect(resultA).toBeDefined()
		expect(resultA?.file).toBe('src/components/Gallery.astro')
		expect(resultA?.line).toBe(2)

		const resultB = findInImageIndex('/assets/b.png')
		expect(resultB).toBeDefined()
	})
})

// ============================================================================
// Helper Functions for Creating Mock Data
// ============================================================================

function createMockCachedFile(options: {
	lines: string[]
	ast: AstroNode
	variableDefinitions?: Array<{ name: string; value: string; line: number; parentName?: string }>
}): CachedParsedFile {
	return {
		content: options.lines.join('\n'),
		lines: options.lines,
		ast: options.ast,
		frontmatterContent: null,
		frontmatterStartLine: 1,
		variableDefinitions: options.variableDefinitions ?? [],
		propAliases: new Map(),
		imports: [],
	}
}

function createMockAst(children: AstroNode[]): AstroNode {
	return {
		type: 'root',
		children,
	} as unknown as AstroNode
}

function createMockElement(name: string, text: string, line: number): AstroNode {
	return {
		type: 'element',
		name,
		attributes: [],
		children: [
			{
				type: 'text',
				value: text,
			},
		],
		position: {
			start: { line, column: 1, offset: 0 },
		},
	} as unknown as AstroNode
}

function createMockElementWithExpression(name: string, varName: string, line: number): AstroNode {
	return {
		type: 'element',
		name,
		attributes: [],
		children: [
			{
				type: 'expression',
				children: [
					{
						type: 'text',
						value: varName,
					},
				],
			},
		],
		position: {
			start: { line, column: 1, offset: 0 },
		},
	} as unknown as AstroNode
}

function createMockComponent(
	name: string,
	props: Array<{ name: string; value: string; line: number }>,
	line: number,
): AstroNode {
	return {
		type: 'component',
		name,
		attributes: props.map(p => ({
			type: 'attribute',
			kind: 'quoted',
			name: p.name,
			value: p.value,
			position: { start: { line: p.line, column: 1, offset: 0 } },
		})),
		children: [],
		position: {
			start: { line, column: 1, offset: 0 },
		},
	} as unknown as AstroNode
}

// ============================================================================
// Content Collection Image Indexing Tests
// ============================================================================

withTempDir('content collection image indexing', (getCtx) => {
	test('should index images from JSON data files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/content/people')
		await ctx.writeFile(
			'src/content/people/alice.json',
			'{\n  "name": "Alice",\n  "image": "/assets/alice.webp"\n}',
		)

		await initializeSearchIndex()

		const result = findInImageIndex('/assets/alice.webp')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/content/people/alice.json')
	})

	test('should index images from YAML data files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/content/config')
		await ctx.writeFile(
			'src/content/config/settings.yaml',
			'logo: /images/logo.png\nfavicon: /images/favicon.ico',
		)

		await initializeSearchIndex()

		const logoResult = findInImageIndex('/images/logo.png')
		expect(logoResult).toBeDefined()
		expect(logoResult?.file).toBe('src/content/config/settings.yaml')

		const faviconResult = findInImageIndex('/images/favicon.ico')
		expect(faviconResult).toBeDefined()
		expect(faviconResult?.file).toBe('src/content/config/settings.yaml')
	})

	test('should index images from MD frontmatter', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/content/blog')
		await ctx.writeFile(
			'src/content/blog/post.md',
			'---\ntitle: Post\nimage: /photos/hero.jpg\n---\nBody',
		)

		await initializeSearchIndex()

		const result = findInImageIndex('/photos/hero.jpg')
		expect(result).toBeDefined()
		expect(result?.file).toBe('src/content/blog/post.md')
	})

	test('should NOT index non-image values from data files', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)
		await ctx.mkdir('src/content/people')
		await ctx.writeFile(
			'src/content/people/alice.json',
			'{\n  "name": "Alice",\n  "email": "alice@test.com"\n}',
		)

		await initializeSearchIndex()

		const result = findInImageIndex('alice@test.com')
		expect(result).toBeUndefined()
	})
})

// ============================================================================
// Helper Functions for Creating Mock Data
// ============================================================================

function createMockImage(src: string, line: number): AstroNode {
	return {
		type: 'element',
		name: 'img',
		attributes: [
			{
				type: 'attribute',
				name: 'src',
				value: src,
				position: { start: { line, column: 1, offset: 0 } },
			},
		],
		children: [],
		position: {
			start: { line, column: 1, offset: 0 },
		},
	} as unknown as AstroNode
}
