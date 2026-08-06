import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A collection declared in content.config.ts under a key that differs from its directory
// name (`heroSlides` over `content/hero-slides`) used to land in the map twice: once from
// the directory scan, once from the config pass. These lock the merge — and the child
// collection case (shared base, narrower pattern) that must *not* be merged.
describe('scanCollections — config keys vs. scanned directories', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__scanner-config-keys-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	/** Write root-relative files (parent dirs included). */
	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	test('a config key that differs from the directory name merges into one collection', async () => {
		await write({
			'src/content/hero-slides/first.md': '---\ntitle: First\n---\n',
			'src/content/hero-slides/second.md': '---\ntitle: Second\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const heroSlides = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/hero-slides' }),
	schema: n.object({ title: n.text({ label: 'Nadpis' }) }),
	cms: { display: 'tabs' },
})
export const collections = { heroSlides }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		// Once, under the config key — not also under the directory name.
		expect(Object.keys(collections)).toEqual(['heroSlides'])
		const definition = collections['heroSlides']!
		expect(definition.name).toBe('heroSlides')
		expect(definition.parentCollection).toBeUndefined()
		// Entries survive the merge: they come from the directory scan.
		expect(definition.entries!.map(e => e.slug).sort()).toEqual(['first', 'second'])
		expect(definition.entries!.map(e => e.sourcePath).sort()).toEqual([
			path.join('src/content/hero-slides', 'first.md'),
			path.join('src/content/hero-slides', 'second.md'),
		])
		// …and `defineCmsCollection` still applies, because it keys by the config name.
		expect(definition.layout).toEqual({ display: 'tabs' })
		expect(definition.fields.find(f => f.name === 'title')?.label).toBe('Nadpis')
	})

	test('a genuine child collection (shared base, narrower pattern) stays separate', async () => {
		await write({
			'src/content/jsem/uvod.md': '---\ntitle: Úvod\n---\n',
			'src/content/jsem/otazky/prvni.md': '---\ntitle: První\n---\n',
			'src/content/jsem/otazky/druha.md': '---\ntitle: Druhá\n---\n',
			'src/content.config.ts': `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const jsem = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/jsem' }),
})
const jsemOtazky = defineCollection({
	loader: glob({ pattern: 'otazky/*.md', base: './src/content/jsem' }),
})
export const collections = { jsem, 'jsem-otazky': jsemOtazky }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(Object.keys(collections).sort()).toEqual(['jsem', 'jsem-otazky'])
		expect(collections['jsem']!.entries!.map(e => e.slug)).toEqual(['uvod'])
		expect(collections['jsem']!.parentCollection).toBeUndefined()
		expect(collections['jsem-otazky']!.parentCollection).toBe('jsem')
		expect(collections['jsem-otazky']!.entries!.map(e => e.slug).sort()).toEqual(['otazky/druha', 'otazky/prvni'])
	})

	test('a child collection nests under the merged parent when the parent is declared first', async () => {
		await write({
			'src/content/jsem/uvod.md': '---\ntitle: Úvod\n---\n',
			'src/content/jsem/otazky/prvni.md': '---\ntitle: První\n---\n',
			'src/content.config.ts': `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const jsemPage = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/jsem' }),
})
const jsemOtazky = defineCollection({
	loader: glob({ pattern: 'otazky/*.md', base: './src/content/jsem' }),
})
export const collections = { jsemPage, 'jsem-otazky': jsemOtazky }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(Object.keys(collections).sort()).toEqual(['jsem-otazky', 'jsemPage'])
		expect(collections['jsem-otazky']!.parentCollection).toBe('jsemPage')
	})

	test('a child collection nests under the merged parent when the child is declared first', async () => {
		await write({
			'src/content/jsem/uvod.md': '---\ntitle: Úvod\n---\n',
			'src/content/jsem/otazky/prvni.md': '---\ntitle: První\n---\n',
			'src/content.config.ts': `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const jsemOtazky = defineCollection({
	loader: glob({ pattern: 'otazky/*.md', base: './src/content/jsem' }),
})
const jsemPage = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/jsem' }),
})
export const collections = { 'jsem-otazky': jsemOtazky, jsemPage }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(Object.keys(collections).sort()).toEqual(['jsem-otazky', 'jsemPage'])
		// The re-key rewrites the reference the child already took on the scanned name.
		expect(collections['jsem-otazky']!.parentCollection).toBe('jsemPage')
	})

	test('a narrower extension over the same base is a child, not a merge', async () => {
		await write({
			'src/content/docs/intro.md': '---\ntitle: Intro\n---\n',
			'src/content/docs/advanced.mdx': '---\ntitle: Advanced\n---\n',
			'src/content.config.ts': `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const docs = defineCollection({
	loader: glob({ pattern: '*.{md,mdx}', base: './src/content/docs' }),
})
const docsMdx = defineCollection({
	loader: glob({ pattern: '*.mdx', base: './src/content/docs' }),
})
export const collections = { docs, docsMdx }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(Object.keys(collections).sort()).toEqual(['docs', 'docsMdx'])
		expect(collections['docs']!.entries!.map(e => e.slug).sort()).toEqual(['advanced', 'intro'])
		expect(collections['docsMdx']!.entries!.map(e => e.slug)).toEqual(['advanced'])
		expect(collections['docsMdx']!.parentCollection).toBe('docs')
	})

	test('collections whose config key matches the directory name are unchanged', async () => {
		await write({
			'src/content/blog/hello.md': '---\ntitle: Hello\n---\n',
			'src/content/team/alice.json': '{"name":"Alice"}',
			'src/content.config.ts': `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { n } from '@nuasite/cms'
const blog = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/blog' }),
	schema: n.object({ title: n.text({ label: 'Titulek' }) }),
})
export const collections = { blog }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(Object.keys(collections).sort()).toEqual(['blog', 'team'])
		const blog = collections['blog']!
		expect(blog.name).toBe('blog')
		expect(blog.path).toBe(path.join('src/content', 'blog'))
		expect(blog.parentCollection).toBeUndefined()
		expect(blog.entries!.map(e => e.slug)).toEqual(['hello'])
		expect(blog.fields.find(f => f.name === 'title')?.label).toBe('Titulek')
		expect(collections['team']!.type).toBe('data')
	})
})
