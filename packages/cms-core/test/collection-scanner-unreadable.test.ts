import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// The glob walk rejects for a directory it cannot read, so a glob-loaded collection with one
// under its base is skipped instead of listed short. A directory whose files the scan throws
// away anyway (`_drafts`, `.obsidian`) must not cost the collection.
// Root reads any directory, so there is nothing to observe under it.
describe.skipIf(process.getuid?.() === 0)('scanCollections: an unreadable directory under a glob loader base', () => {
	let root: string
	let locked: string | undefined

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__scanner-unreadable-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(path.join(root, 'src/content'), { recursive: true })
		await write({
			'src/content.config.ts': `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const news = defineCollection({ loader: glob({ base: './data/news', pattern: '**/*.md' }) })
export const collections = { news }
`,
			'data/news/a.md': '---\ntitle: A\n---\n',
		})
	})

	afterEach(async () => {
		if (locked) await fs.chmod(locked, 0o755)
		locked = undefined
		await fs.rm(root, { recursive: true, force: true })
	})

	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	async function lock(relative: string): Promise<void> {
		await write({ [`${relative}/b.md`]: '---\ntitle: B\n---\n' })
		locked = path.join(root, relative)
		await fs.chmod(locked, 0o000)
	}

	test('one that may hold entries skips the collection, with a warning that names it', async () => {
		await lock('data/news/2024')
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const collections = await scanCollections(createNodeFs(root))
			// Not the one entry that happened to be readable.
			expect(collections.news).toBeUndefined()
			expect(String(warn.mock.calls[0]?.[1])).toContain('Cannot read directory "data/news/2024" (EACCES)')
		} finally {
			warn.mockRestore()
		}
	})

	for (const hidden of ['_drafts', '.obsidian']) {
		test(`one the scan ignores anyway (${hidden}) leaves the collection whole`, async () => {
			await lock(`data/news/${hidden}`)
			const collections = await scanCollections(createNodeFs(root))
			expect(collections.news?.entries?.map(entry => entry.slug)).toEqual(['a'])
		})
	}
})
