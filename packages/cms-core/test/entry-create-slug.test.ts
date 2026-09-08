import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// An entry's file name *is* its address, and a collection that declares a `slug` field stores that
// address twice. The create forms derive the file name from the title and left the frontmatter copy
// empty, so an event landed at `vecirek-ve-vile.md` carrying `slug:` — and anything reading the
// frontmatter for a URL (a `pathname` rule, a field declared `derivedFrom: 'slug'`) had nothing to
// read. Filling it belongs here, under every editor, for the same reason the derive does.
describe('createEntry fills a declared slug field from the file name', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__create-slug-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	const read = (relative: string): Promise<string> => fs.readFile(path.join(root, relative), 'utf-8')
	const core = (): ReturnType<typeof createCmsCore> => createCmsCore(createNodeFs(root))

	/** `events` is the shape that prompted this; `pages` declares a slug the author fills in; `posts` has none. */
	const CONFIG = `import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const events = defineCollection({
	schema: z.object({
		title: n.text(),
		slug: n.text({ hidden: true }).optional(),
		url_path: n.text({ derivedFrom: 'slug' }).optional(),
	}),
})

const pages = defineCollection({
	schema: z.object({
		title: n.text(),
		slug: n.text().optional(),
	}),
})

const posts = defineCollection({
	schema: z.object({
		title: n.text(),
	}),
})

export const collections = { events, pages, posts }
`

	test('the hidden slug the form cannot fill is written, and the field derived from it follows', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({
			collection: 'events',
			slug: 'vecirek-ve-vile',
			frontmatter: { title: 'Večírek ve VILE' },
			body: '# Večírek',
		})

		expect(result.success).toBe(true)
		const written = await read('src/content/events/vecirek-ve-vile.md')
		expect(written).toContain('slug: vecirek-ve-vile')
		// The whole reason the fill runs *before* the derive: `url_path` reads the value being written.
		expect(written).toContain('url_path: /vecirek-ve-vile')
	})

	test('the slug written is the one the file got, not the one the caller sent', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({ collection: 'events', slug: 'Večírek ve VILE', frontmatter: { title: 'Večírek' } })

		expect(result.success).toBe(true)
		expect(await read('src/content/events/vecirek-ve-vile.md')).toContain('slug: vecirek-ve-vile')
	})

	test('a slug the author typed is left exactly as it is', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({
			collection: 'pages',
			slug: 'o-nas',
			frontmatter: { title: 'O nás', slug: 'kdo-jsme' },
		})

		expect(result.success).toBe(true)
		expect(await read('src/content/pages/o-nas.md')).toContain('slug: kdo-jsme')
	})

	test('a collection that declares no slug field gets no slug key invented for it', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({ collection: 'posts', slug: 'ahoj', frontmatter: { title: 'Ahoj' } })

		expect(result.success).toBe(true)
		expect(await read('src/content/posts/ahoj.md')).not.toContain('slug:')
	})

	test('an update never repoints the address — renaming an entry is its own operation', async () => {
		await write({
			'src/content.config.ts': CONFIG,
			'src/content/pages/o-nas.md': '---\ntitle: O nás\nslug: kdo-jsme\n---\n',
		})

		const result = await core().updateEntry({ collection: 'pages', slug: 'o-nas', frontmatter: { title: 'O nás, nově' } })

		expect(result.success).toBe(true)
		expect(await read('src/content/pages/o-nas.md')).toContain('slug: kdo-jsme')
	})
})
