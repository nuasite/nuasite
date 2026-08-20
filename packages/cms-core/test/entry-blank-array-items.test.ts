import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * A blank item inside a list is the one thing an editor may not write.
 *
 * A *field* can be absent, so an editor that clears one writes `undefined` and the key is simply
 * omitted. An *item* has nowhere to go: `JSON.stringify` turns the same `undefined` into `null`
 * on the way to the sidecar, and `null` is then serialized as a real list entry. On a production
 * site one unfilled row appended by "+ Add" and saved produced `tags: [ …, null ]`, which
 * `astro sync` refuses — and because Astro validates a collection as a whole, the entry took the
 * entire site build with it for two days.
 *
 * The rule therefore lives at the server, in `entry-ops.ts`, not in a widget: every editor that
 * reaches the sidecar is covered by it, including versions older than the rule itself.
 */
describe('entry-ops — blank list items', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__entry-blank-items-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	const CONFIG = `import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection, reference } from 'astro:content'
import { glob } from 'astro/loaders'

const articles = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/articles' }),
	schema: z.object({
		title: n.text(),
		tags: z.array(reference('tags')).optional(),
	}),
})

export const collections = { articles }
`

	const fixture = async (frontmatter = 'title: Ada\n') => {
		await write({
			'src/content.config.ts': CONFIG,
			'src/content/articles/ada.md': `---\n${frontmatter}---\n`,
		})
	}

	const frontmatterOnDisk = async (slug = 'ada'): Promise<Record<string, unknown>> => {
		const entry = await createCmsCore(createNodeFs(root)).getEntry('articles', slug)
		return entry?.frontmatter ?? {}
	}

	// The exact write the incident produced: the third row of a `reference()` list was added and
	// never filled in, so it arrived as `null`.
	test('a null item in a saved list never reaches disk', async () => {
		await fixture()

		const result = await createCmsCore(createNodeFs(root)).updateEntry({
			collection: 'articles',
			slug: 'ada',
			frontmatter: { tags: ['komentar', 'lide', null] },
		})

		expect(result.success).toBe(true)
		expect((await frontmatterOnDisk()).tags).toEqual(['komentar', 'lide'])
		expect(await fs.readFile(path.join(root, 'src/content/articles/ada.md'), 'utf8')).not.toContain('null')
	})

	test('an empty string and an undefined item go the same way', async () => {
		await fixture()

		await createCmsCore(createNodeFs(root)).updateEntry({
			collection: 'articles',
			slug: 'ada',
			frontmatter: { tags: ['komentar', '', undefined, 'lide'] },
		})

		expect((await frontmatterOnDisk()).tags).toEqual(['komentar', 'lide'])
	})

	// `false`, `0`, `[]` and `{}` are values a list may hold. Dropping them would silently delete
	// content, which is a worse failure than the one this rule prevents.
	test('falsy values that are not blank survive', async () => {
		await fixture()

		await createCmsCore(createNodeFs(root)).updateEntry({
			collection: 'articles',
			slug: 'ada',
			frontmatter: { flags: [false, 0, [], {}] },
		})

		expect((await frontmatterOnDisk()).flags).toEqual([false, 0, [], {}])
	})

	test('a blank item nested inside an object or a repeater item is dropped too', async () => {
		await fixture()

		await createCmsCore(createNodeFs(root)).updateEntry({
			collection: 'articles',
			slug: 'ada',
			frontmatter: {
				seo: { keywords: ['a', null] },
				stats: [{ label: 'x', sources: ['s', ''] }],
			},
		})

		const written = await frontmatterOnDisk()
		expect(written.seo).toEqual({ keywords: ['a'] })
		expect(written.stats).toEqual([{ label: 'x', sources: ['s'] }])
	})

	test('a created entry is cleaned the same way as an updated one', async () => {
		await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/ada.md': '---\ntitle: Ada\n---\n' })

		const result = await createCmsCore(createNodeFs(root)).createEntry({
			collection: 'articles',
			slug: 'bee',
			frontmatter: { title: 'Bee', tags: ['komentar', null] },
		})

		expect(result.success).toBe(true)
		expect((await frontmatterOnDisk('bee')).tags).toEqual(['komentar'])
	})

	// Only the incoming patch is cleaned. Cleaning the merged record would rewrite lists this edit
	// never touched, and a save must change what the editor changed and nothing else.
	test('a blank item already on disk in an untouched field is left alone', async () => {
		await fixture('title: Ada\nlegacy:\n  - a\n  - null\n')

		await createCmsCore(createNodeFs(root)).updateEntry({
			collection: 'articles',
			slug: 'ada',
			frontmatter: { tags: ['komentar'] },
		})

		expect((await frontmatterOnDisk()).legacy).toEqual(['a', null])
	})

	// `addArrayItem` refuses instead of dropping: a client that asked for an append should not be
	// told it happened when nothing was written.
	test('appending a blank item through the API is refused, not silently ignored', async () => {
		await fixture('title: Ada\ntags:\n  - komentar\n')

		const result = await createCmsCore(createNodeFs(root)).addArrayItem({
			collection: 'articles',
			slug: 'ada',
			field: 'tags',
			value: null,
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain('empty item')
		expect((await frontmatterOnDisk()).tags).toEqual(['komentar'])
	})
})
