// Locks in that `n.markdown()` in a content config is scanned as the `markdown`
// field type (so the CMS renders the rich markdown editor for it, not a plain
// textarea). Self-contained temp project.
import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CONFIG_SOURCE = `
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { n } from '@nuasite/cms'

const note = defineCollection({
	loader: glob({ pattern: '**/*.yaml', base: './content/note' }),
	schema: n.object({ title: n.text(), summary: n.textarea(), body: n.markdown() }),
})

export const collections = { note }
`

const cleanups: string[] = []
afterEach(async () => {
	for (const dir of cleanups.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

describe('markdown field type', () => {
	test('n.markdown() is scanned as a `markdown` field (distinct from textarea)', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-core-md-'))
		cleanups.push(root)
		await fs.mkdir(path.join(root, 'src'), { recursive: true })
		await fs.mkdir(path.join(root, 'content', 'note'), { recursive: true })
		await fs.writeFile(path.join(root, 'src', 'content.config.ts'), CONFIG_SOURCE)
		await fs.writeFile(path.join(root, 'content', 'note', 'hello.yaml'), 'title: Hi\nsummary: s\nbody: "## Heading"\n')

		const collections = await scanCollections(createNodeFs(root), 'src/content', new Map())
		const fields = collections.note?.fields ?? []
		const typeOf = (name: string) => fields.find(f => f.name === name)?.type

		expect(typeOf('body')).toBe('markdown')
		expect(typeOf('summary')).toBe('textarea')
	})
})
