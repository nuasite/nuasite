import { createCmsCore, createNodeFs, type FrontmatterCache, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A save rescans every collection; the memo keeps that rescan from re-parsing the YAML of
// every entry that did not change. Each cache record is replaced exactly when its entry is
// parsed, so record identity tells a reused parse from a fresh one.
describe('scanCollections — frontmatter memo', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__frontmatter-memo-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	async function scan(cache: FrontmatterCache) {
		return await scanCollections(createNodeFs(root), 'src/content', new Map(), { frontmatterCache: cache })
	}

	function titles(collections: Awaited<ReturnType<typeof scan>>, name: string): Record<string, string | undefined> {
		return Object.fromEntries((collections[name]?.entries ?? []).map(entry => [entry.slug, entry.title]))
	}

	test('reuses the parse of an unchanged entry and re-parses a changed one', async () => {
		await write({
			'src/content/blog/a.md': '---\ntitle: A\n---\nbody a\n',
			'src/content/blog/b.md': '---\ntitle: B\n---\nbody b\n',
		})
		const cache: FrontmatterCache = new Map()
		await scan(cache)
		const a = cache.get('src/content/blog/a.md')
		const b = cache.get('src/content/blog/b.md')
		expect(a?.data).toEqual({ title: 'A' })

		await write({ 'src/content/blog/b.md': '---\ntitle: B edited\n---\nbody b\n' })
		const collections = await scan(cache)

		expect(cache.get('src/content/blog/a.md')).toBe(a!)
		expect(cache.get('src/content/blog/b.md')).not.toBe(b!)
		expect(cache.get('src/content/blog/b.md')?.data).toEqual({ title: 'B edited' })
		expect(titles(collections, 'blog')).toEqual({ a: 'A', b: 'B edited' })
	})

	test('a body-only edit keeps the parse; the entry still lists', async () => {
		await write({ 'src/content/blog/a.md': '---\ntitle: A\n---\nfirst\n' })
		const cache: FrontmatterCache = new Map()
		await scan(cache)
		const before = cache.get('src/content/blog/a.md')

		await write({ 'src/content/blog/a.md': '---\ntitle: A\n---\nsecond\n' })
		const collections = await scan(cache)

		expect(cache.get('src/content/blog/a.md')).toBe(before!)
		expect(titles(collections, 'blog')).toEqual({ a: 'A' })
	})

	test('a deleted entry leaves both the list and the memo', async () => {
		await write({
			'src/content/blog/a.md': '---\ntitle: A\n---\n',
			'src/content/blog/b.md': '---\ntitle: B\n---\n',
		})
		const cache: FrontmatterCache = new Map()
		await scan(cache)

		await fs.rm(path.join(root, 'src/content/blog/b.md'))
		const collections = await scan(cache)

		expect(titles(collections, 'blog')).toEqual({ a: 'A' })
		expect([...cache.keys()]).toEqual(['src/content/blog/a.md'])
	})

	test('an entry that loses its frontmatter leaves the memo', async () => {
		await write({ 'src/content/blog/a.md': '---\ntitle: A\n---\n', 'src/content/blog/b.md': '---\ntitle: B\n---\n' })
		const cache: FrontmatterCache = new Map()
		await scan(cache)

		await write({ 'src/content/blog/b.md': 'no frontmatter any more\n' })
		const collections = await scan(cache)

		expect(titles(collections, 'blog')).toEqual({ a: 'A', b: undefined })
		expect(cache.has('src/content/blog/b.md')).toBe(false)
	})

	test("mutating one scan's entry data does not leak into the next scan", async () => {
		await write({ 'src/content/blog/a.md': '---\ntitle: A\ntags:\n  - x\n---\n' })
		const cache: FrontmatterCache = new Map()
		// Both the scan that parses and a scan served from the memo.
		for (const scanned of [await scan(cache), await scan(cache)]) {
			const data = scanned.blog?.entries?.[0]?.data
			if (!data || !Array.isArray(data.tags)) throw new Error('expected scanned tags')
			data.title = 'mutated'
			data.tags.push('y')
			const next = await scan(cache)
			expect(next.blog?.entries?.[0]?.data).toEqual({ title: 'A', tags: ['x'] })
		}
	})
})

describe('CmsCore — collection list after a save', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__frontmatter-memo-core-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(path.join(root, 'src/content/blog'), { recursive: true })
		await fs.writeFile(path.join(root, 'src/content/blog/a.md'), '---\ntitle: A\n---\nbody a\n')
		await fs.writeFile(path.join(root, 'src/content/blog/b.md'), '---\ntitle: B\n---\nbody b\n')
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	test('updated, created and deleted entries show in the next scan', async () => {
		const core = createCmsCore(createNodeFs(root))
		const list = async () => Object.fromEntries(((await core.scanCollections()).blog?.entries ?? []).map(e => [e.slug, e.title]))
		expect(await list()).toEqual({ a: 'A', b: 'B' })

		expect((await core.updateEntry({ collection: 'blog', slug: 'a', frontmatter: { title: 'A saved' } })).success).toBe(true)
		expect(await list()).toEqual({ a: 'A saved', b: 'B' })

		expect((await core.createEntry({ collection: 'blog', slug: 'c', frontmatter: { title: 'C' } })).success).toBe(true)
		expect((await core.deleteEntry('blog', 'b')).success).toBe(true)
		expect(await list()).toEqual({ a: 'A saved', c: 'C' })
	})
})
