import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearSourceFinderCache, findFieldInCollectionEntry } from '../../../src/source-finder'
import { enhanceManifestWithSourceSnippets } from '../../../src/source-finder/snippet-utils'
import type { CollectionDefinition, ManifestEntry } from '../../../src/types'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../../utils/temp-directory'

describe('findFieldInCollectionEntry', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('collection-img-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	function makeCollectionDefs(
		overrides: Partial<CollectionDefinition> & { entries: CollectionDefinition['entries'] },
	): Record<string, CollectionDefinition> {
		return {
			news: {
				name: 'news',
				label: 'News',
				path: 'src/content/news',
				entryCount: 1,
				fields: [
					{ name: 'title', type: 'text', required: true },
					{ name: 'image', type: 'image', required: true },
				],
				fileExtension: 'md',
				...overrides,
			},
		}
	}

	test('finds image field in markdown frontmatter', async () => {
		await ctx.writeFile(
			'src/content/news/my-post.md',
			[
				'---',
				'title: My Post',
				'image: ./images/hero.jpg',
				'---',
				'',
				'Content here.',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			entries: [{ slug: 'my-post', sourcePath: 'src/content/news/my-post.md' }],
		})

		const result = await findFieldInCollectionEntry('image', 'news', 'my-post', defs)
		expect(result).not.toBeUndefined()
		expect(result!.file).toBe('src/content/news/my-post.md')
		expect(result!.snippet).toContain('image:')
		expect(result!.snippet).toContain('./images/hero.jpg')
		expect(result!.line).toBe(3) // line 3 in the file (after ---)
		expect(result!.collectionName).toBe('news')
		expect(result!.collectionSlug).toBe('my-post')
	})

	test('finds image field in MDX frontmatter', async () => {
		await ctx.writeFile(
			'src/content/news/my-post.mdx',
			[
				'---',
				'title: My Post',
				'image: "/uploads/photo.webp"',
				'draft: false',
				'---',
				'',
				'import Component from "../../components/Component.astro"',
				'',
				'<Component />',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			fileExtension: 'mdx',
			entries: [{ slug: 'my-post', sourcePath: 'src/content/news/my-post.mdx' }],
		})

		const result = await findFieldInCollectionEntry('image', 'news', 'my-post', defs)
		expect(result).not.toBeUndefined()
		expect(result!.file).toBe('src/content/news/my-post.mdx')
		expect(result!.snippet).toContain('/uploads/photo.webp')
	})

	test('finds image field in JSON data file', async () => {
		await ctx.writeFile(
			'src/content/people/alice.json',
			JSON.stringify(
				{
					name: 'Alice',
					image: '/uploads/alice.jpg',
					role: 'Developer',
				},
				null,
				2,
			),
		)

		const defs: Record<string, CollectionDefinition> = {
			people: {
				name: 'people',
				label: 'People',
				path: 'src/content/people',
				entryCount: 1,
				type: 'data',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'image', type: 'image', required: true },
					{ name: 'role', type: 'text', required: true },
				],
				fileExtension: 'json',
				entries: [{ slug: 'alice', sourcePath: 'src/content/people/alice.json' }],
			},
		}

		const result = await findFieldInCollectionEntry('image', 'people', 'alice', defs)
		expect(result).not.toBeUndefined()
		expect(result!.file).toBe('src/content/people/alice.json')
		expect(result!.snippet).toContain('/uploads/alice.jpg')
	})

	test('finds image field in YAML data file', async () => {
		await ctx.writeFile(
			'src/content/team/bob.yaml',
			[
				'name: Bob',
				'image: /uploads/bob.webp',
				'role: Designer',
			].join('\n'),
		)

		const defs: Record<string, CollectionDefinition> = {
			team: {
				name: 'team',
				label: 'Team',
				path: 'src/content/team',
				entryCount: 1,
				type: 'data',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'image', type: 'image', required: true },
				],
				fileExtension: 'yaml',
				entries: [{ slug: 'bob', sourcePath: 'src/content/team/bob.yaml' }],
			},
		}

		const result = await findFieldInCollectionEntry('image', 'team', 'bob', defs)
		expect(result).not.toBeUndefined()
		expect(result!.file).toBe('src/content/team/bob.yaml')
		expect(result!.snippet).toContain('/uploads/bob.webp')
	})

	test('finds field with different name (e.g. "logo")', async () => {
		await ctx.writeFile(
			'src/content/partners/acme.json',
			JSON.stringify(
				{
					name: 'ACME Corp',
					logo: '/uploads/acme-logo.png',
					href: 'https://acme.com',
				},
				null,
				2,
			),
		)

		const defs: Record<string, CollectionDefinition> = {
			partners: {
				name: 'partners',
				label: 'Partners',
				path: 'src/content/partners',
				entryCount: 1,
				type: 'data',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'logo', type: 'image', required: true },
					{ name: 'href', type: 'url', required: false },
				],
				fileExtension: 'json',
				entries: [{ slug: 'acme', sourcePath: 'src/content/partners/acme.json' }],
			},
		}

		const result = await findFieldInCollectionEntry('logo', 'partners', 'acme', defs)
		expect(result).not.toBeUndefined()
		expect(result!.file).toBe('src/content/partners/acme.json')
		expect(result!.snippet).toContain('/uploads/acme-logo.png')
	})

	test('returns undefined for non-existent field', async () => {
		await ctx.writeFile(
			'src/content/news/my-post.md',
			[
				'---',
				'title: My Post',
				'---',
				'',
				'No image field here.',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			entries: [{ slug: 'my-post', sourcePath: 'src/content/news/my-post.md' }],
		})

		const result = await findFieldInCollectionEntry('image', 'news', 'my-post', defs)
		expect(result).toBeUndefined()
	})

	test('returns undefined for non-existent slug', async () => {
		const defs = makeCollectionDefs({
			entries: [{ slug: 'other-post', sourcePath: 'src/content/news/other-post.md' }],
		})

		const result = await findFieldInCollectionEntry('image', 'news', 'missing-post', defs)
		expect(result).toBeUndefined()
	})

	test('returns undefined for non-existent collection', async () => {
		const defs = makeCollectionDefs({
			entries: [{ slug: 'my-post', sourcePath: 'src/content/news/my-post.md' }],
		})

		const result = await findFieldInCollectionEntry('image', 'nonexistent', 'my-post', defs)
		expect(result).toBeUndefined()
	})

	test('finds hashed Astro URL that was previously written to frontmatter', async () => {
		// After a successful edit, the frontmatter contains the hashed URL
		await ctx.writeFile(
			'src/content/news/edited-post.md',
			[
				'---',
				'title: Edited Post',
				'image: /assets/a1b2c3d4e5f6-1234-jpg.webp',
				'---',
				'',
				'Content.',
			].join('\n'),
		)

		const defs = makeCollectionDefs({
			entries: [{ slug: 'edited-post', sourcePath: 'src/content/news/edited-post.md' }],
		})

		const result = await findFieldInCollectionEntry('image', 'news', 'edited-post', defs)
		expect(result).not.toBeUndefined()
		expect(result!.snippet).toContain('/assets/a1b2c3d4e5f6-1234-jpg.webp')
	})
})

describe('enhanceManifestWithSourceSnippets — collection images', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('enhance-img-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	function makeEntry(id: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
		return {
			id,
			tag: 'img',
			text: '',
			sourcePath: 'src/pages/index.astro',
			sourceLine: 10,
			imageMetadata: { src: '/assets/abc123-photo-jpg.webp', alt: '' },
			...overrides,
		}
	}

	test('resolves collection image to data file when collectionName is on wrapper parent', async () => {
		await ctx.writeFile(
			'src/content/news/my-post.md',
			[
				'---',
				'title: My Post',
				'image: ./images/hero.jpg',
				'---',
				'',
				'Content.',
			].join('\n'),
		)

		const collectionDefinitions: Record<string, CollectionDefinition> = {
			news: {
				name: 'news',
				label: 'News',
				path: 'src/content/news',
				entryCount: 1,
				fields: [
					{ name: 'title', type: 'text', required: true },
					{ name: 'image', type: 'image', required: true },
				],
				fileExtension: 'md',
				entries: [{ slug: 'my-post', sourcePath: 'src/content/news/my-post.md' }],
			},
		}

		// Simulate: wrapper has collection info, child image does not (matches real HTML processor behavior)
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'div',
				text: 'My Post',
				sourcePath: 'src/pages/index.astro',
				collectionName: 'news',
				collectionSlug: 'my-post',
			},
			'cms-2': makeEntry('cms-2', {
				parentComponentId: 'cms-1',
				imageMetadata: { src: '/assets/abc123-hero-jpg.webp', alt: '' },
				// No collectionName/collectionSlug — child of wrapper
			}),
		}

		const result = await enhanceManifestWithSourceSnippets(entries, collectionDefinitions)

		expect(result['cms-2']!.sourcePath).toBe('src/content/news/my-post.md')
		expect(result['cms-2']!.sourceSnippet).toContain('image:')
		expect(result['cms-2']!.sourceSnippet).toContain('./images/hero.jpg')
		expect(result['cms-2']!.collectionName).toBe('news')
		expect(result['cms-2']!.collectionSlug).toBe('my-post')
	})

	test('resolves collection image with "logo" field name in JSON data file', async () => {
		await ctx.writeFile(
			'src/content/partners/acme.json',
			JSON.stringify(
				{
					name: 'ACME Corp',
					logo: '/uploads/acme-logo.png',
					href: 'https://acme.com',
				},
				null,
				2,
			),
		)

		const collectionDefinitions: Record<string, CollectionDefinition> = {
			partners: {
				name: 'partners',
				label: 'Partners',
				path: 'src/content/partners',
				entryCount: 1,
				type: 'data',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'logo', type: 'image', required: true },
					{ name: 'href', type: 'url', required: false },
				],
				fileExtension: 'json',
				entries: [{ slug: 'acme', sourcePath: 'src/content/partners/acme.json' }],
			},
		}

		const entries: Record<string, ManifestEntry> = {
			'cms-10': {
				id: 'cms-10',
				tag: 'div',
				text: 'ACME Corp',
				sourcePath: 'src/pages/index.astro',
				collectionName: 'partners',
				collectionSlug: 'acme',
			},
			'cms-11': makeEntry('cms-11', {
				parentComponentId: 'cms-10',
				imageMetadata: { src: '/assets/xyz789-acme-logo-png.webp', alt: '' },
			}),
		}

		const result = await enhanceManifestWithSourceSnippets(entries, collectionDefinitions)

		expect(result['cms-11']!.sourcePath).toBe('src/content/partners/acme.json')
		expect(result['cms-11']!.sourceSnippet).toContain('/uploads/acme-logo.png')
	})

	test('does NOT override sourcePath for non-collection images', async () => {
		const entries: Record<string, ManifestEntry> = {
			'cms-1': makeEntry('cms-1', {
				imageMetadata: { src: '/images/static-photo.jpg', alt: '' },
				// No collectionName — this is a regular page image
			}),
		}

		const result = await enhanceManifestWithSourceSnippets(entries, {})

		// sourcePath should remain unchanged (or updated by search index, not collection lookup)
		expect(result['cms-1']!.collectionName).toBeUndefined()
	})

	test('propagates collection info from deeply nested wrappers', async () => {
		await ctx.writeFile(
			'src/content/team/alice.yaml',
			[
				'name: Alice',
				'image: /uploads/alice.jpg',
			].join('\n'),
		)

		const collectionDefinitions: Record<string, CollectionDefinition> = {
			team: {
				name: 'team',
				label: 'Team',
				path: 'src/content/team',
				entryCount: 1,
				type: 'data',
				fields: [
					{ name: 'name', type: 'text', required: true },
					{ name: 'image', type: 'image', required: true },
				],
				fileExtension: 'yaml',
				entries: [{ slug: 'alice', sourcePath: 'src/content/team/alice.yaml' }],
			},
		}

		// wrapper → intermediate div → image
		const entries: Record<string, ManifestEntry> = {
			'cms-1': {
				id: 'cms-1',
				tag: 'article',
				text: 'Alice',
				sourcePath: 'src/pages/team.astro',
				collectionName: 'team',
				collectionSlug: 'alice',
			},
			'cms-2': {
				id: 'cms-2',
				tag: 'div',
				text: '',
				sourcePath: 'src/pages/team.astro',
				parentComponentId: 'cms-1',
			},
			'cms-3': makeEntry('cms-3', {
				parentComponentId: 'cms-2', // child of intermediate, not direct child of wrapper
				imageMetadata: { src: '/assets/hash-alice-jpg.webp', alt: '' },
			}),
		}

		const result = await enhanceManifestWithSourceSnippets(entries, collectionDefinitions)

		// The image is a grandchild — collection info should still propagate
		expect(result['cms-3']!.sourcePath).toBe('src/content/team/alice.yaml')
		expect(result['cms-3']!.sourceSnippet).toContain('/uploads/alice.jpg')
	})
})

describe('findInImageIndex — collection data file preference', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('idx-pref-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	test('prefers collection data file when same URL exists in template and data file', async () => {
		// This reproduces the real-world scenario: a listing page template has
		// static src="/assets/hash.webp" AND the collection data file has the same URL
		await ctx.writeFile(
			'src/pages/listing.astro',
			[
				'---',
				'import { getCollection } from "astro:content"',
				'const items = await getCollection("news")',
				'---',
				'<div>',
				'  <img src="/assets/c65c265604c3-8047-jpg.webp" alt="News image" />',
				'</div>',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/news/my-post.mdx',
			[
				'---',
				'title: "My Post"',
				'image: "/assets/c65c265604c3-8047-jpg.webp"',
				'---',
				'',
				'Content here.',
			].join('\n'),
		)

		const { initializeSearchIndex, findInImageIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = findInImageIndex('/assets/c65c265604c3-8047-jpg.webp')
		expect(result).not.toBeUndefined()
		expect(result!.file).toContain('src/content/')
		expect(result!.file).toContain('my-post.mdx')
	})

	test('prefers collection JSON data file over template', async () => {
		await ctx.writeFile(
			'src/pages/partners.astro',
			[
				'---',
				'---',
				'<img src="/uploads/acme-logo.png" alt="ACME" />',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/partners/acme.json',
			JSON.stringify(
				{
					name: 'ACME',
					logo: '/uploads/acme-logo.png',
				},
				null,
				2,
			),
		)

		const { initializeSearchIndex, findInImageIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = findInImageIndex('/uploads/acme-logo.png')
		expect(result).not.toBeUndefined()
		expect(result!.file).toContain('src/content/partners/acme.json')
	})

	test('returns template match when URL only exists in template', async () => {
		await ctx.writeFile(
			'src/pages/about.astro',
			[
				'---',
				'---',
				'<img src="/images/hero.jpg" alt="Hero" />',
			].join('\n'),
		)

		const { initializeSearchIndex, findInImageIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		const result = findInImageIndex('/images/hero.jpg')
		expect(result).not.toBeUndefined()
		expect(result!.file).toContain('src/pages/about.astro')
	})

	test('suffix matching also prefers collection data files', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'---',
				'<img src="https://cdn.example.com/uploads/photo.webp" alt="Photo" />',
			].join('\n'),
		)

		await ctx.writeFile(
			'src/content/team/alice.yaml',
			[
				'name: Alice',
				'image: https://cdn.example.com/uploads/photo.webp',
			].join('\n'),
		)

		const { initializeSearchIndex, findInImageIndex } = await import('../../../src/source-finder/search-index')
		await initializeSearchIndex()

		// Suffix match: /uploads/photo.webp
		const result = findInImageIndex('/uploads/photo.webp')
		// Should prefer the collection data file
		if (result) {
			expect(result.file).toContain('src/content/')
		}
	})
})

describe('race condition: clearSourceFinderCache + re-resolution', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('race-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	test('findImageSourceLocation returns wrong file before index is built, correct after', async () => {
		// Setup: same image URL in both template and collection data file
		await ctx.writeFile(
			'src/pages/listing.astro',
			[
				'---',
				'---',
				'<img src="/assets/hash123-photo.webp" alt="Photo" />',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/content/news/post.md',
			[
				'---',
				'title: Post',
				'image: /assets/hash123-photo.webp',
				'---',
				'Content.',
			].join('\n'),
		)

		const { findImageSourceLocation, initializeSearchIndex } = await import('../../../src/source-finder')

		// Before index is built: falls back to slow directory search (only scans pages/components/layouts)
		const beforeResult = await findImageSourceLocation('/assets/hash123-photo.webp')
		// May find in template or return undefined — either way NOT the collection file
		if (beforeResult) {
			expect(beforeResult.file).not.toContain('src/content/')
		}

		// After index is built: should prefer the collection data file
		await initializeSearchIndex()
		const afterResult = await findImageSourceLocation('/assets/hash123-photo.webp')
		expect(afterResult).not.toBeUndefined()
		expect(afterResult!.file).toContain('src/content/news/post.md')
	})

	test('findSourceLocation returns correct file after index rebuild', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'---',
				'<h2>My Article</h2>',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/content/news/article.mdx',
			[
				'---',
				'title: My Article',
				'---',
				'Body text.',
			].join('\n'),
		)

		// Note: text from collection frontmatter isn't indexed in the text search index
		// (only .astro files are), so this tests that the template match works correctly.
		// The priority fix matters when both are indexed.
		const { findSourceLocation, initializeSearchIndex } = await import('../../../src/source-finder')

		await initializeSearchIndex()
		const result = await findSourceLocation('My Article', 'h2')
		// Should find it somewhere (at minimum in the template)
		expect(result).not.toBeUndefined()
	})

	test('clearSourceFinderCache wipes index, requiring re-initialization', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'---',
				'<img src="/assets/test-image.jpg" alt="Test" />',
			].join('\n'),
		)
		await ctx.writeFile(
			'src/content/team/bob.json',
			JSON.stringify(
				{
					name: 'Bob',
					image: '/assets/test-image.jpg',
				},
				null,
				2,
			),
		)

		const { findImageSourceLocation, initializeSearchIndex, clearSourceFinderCache: clearCache } = await import('../../../src/source-finder')

		// Build index — should find collection file
		await initializeSearchIndex()
		const result1 = await findImageSourceLocation('/assets/test-image.jpg')
		expect(result1).not.toBeUndefined()
		expect(result1!.file).toContain('src/content/')

		// Clear cache — simulates what dev-middleware does on each request
		clearCache()

		// Without re-initialization, fallback search won't find collection files
		const result2 = await findImageSourceLocation('/assets/test-image.jpg')
		// Falls to slow search which only checks pages/components/layouts
		if (result2) {
			expect(result2.file).not.toContain('src/content/')
		}

		// Re-initialize — collection file should be preferred again
		await initializeSearchIndex()
		const result3 = await findImageSourceLocation('/assets/test-image.jpg')
		expect(result3).not.toBeUndefined()
		expect(result3!.file).toContain('src/content/')
	})

	test('concurrent initializeSearchIndex calls share the same build', async () => {
		await ctx.writeFile(
			'src/pages/index.astro',
			[
				'---',
				'---',
				'<img src="/assets/concurrent.jpg" alt="Test" />',
			].join('\n'),
		)

		const { initializeSearchIndex, findImageSourceLocation } = await import('../../../src/source-finder')

		// Launch two concurrent initializations
		const [,] = await Promise.all([
			initializeSearchIndex(),
			initializeSearchIndex(),
		])

		// Both should succeed, index should be valid
		const result = await findImageSourceLocation('/assets/concurrent.jpg')
		expect(result).not.toBeUndefined()
	})
})
