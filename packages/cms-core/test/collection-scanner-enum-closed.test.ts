import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A select field can get its options from two very different places, and editors have to
// tell them apart: a declared `(z|n).enum([…])` is a closed set the entry must stay inside,
// while options the scan infers from the entries it happened to see are only suggestions —
// treating those as closed would let the first typo in the data become the schema.
describe('scanCollections — optionsClosed marks schema enums, not inferred options', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__enum-closed-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	function config(schema: string): string {
		return `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const posts = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/posts' }),
	schema: ${schema},
})
export const collections = { posts }
`
	}

	test('a declared n.enum becomes a closed select', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\n---\n',
			'src/content/posts/b.md': '---\ntitle: B\nrubrika: tipy\n---\n',
			'src/content.config.ts': config(`n.object({ title: n.text(), rubrika: n.enum(['zpravy', 'tipy']) })`),
		})

		const field = (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === 'rubrika')
		expect(field?.type).toBe('select')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	test('a declared z.enum becomes a closed select too', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\n---\n',
			'src/content.config.ts': `import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
const posts = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/posts' }),
	schema: z.object({ title: z.string(), rubrika: z.enum(['zpravy', 'tipy']) }),
})
export const collections = { posts }
`,
		})

		const field = (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === 'rubrika')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	// The enum's options win over whatever the entries hold — including a value the schema
	// dropped. The stale value is not added back as an option, but it is not erased from the
	// entry either; keeping it out of the list is exactly what makes it show as `(current)`.
	test('an entry value outside the declared enum does not widen the closed list', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zruseno\n---\n',
			'src/content/posts/b.md': '---\ntitle: B\nrubrika: tipy\n---\n',
			'src/content.config.ts': config(`n.object({ title: n.text(), rubrika: n.enum(['zpravy', 'tipy']) })`),
		})

		const field = (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === 'rubrika')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	// A nested enum no entry fills in yet is built straight from the parsed schema
	// (`parsedFieldToFieldDefinition`) instead of being merged onto an inferred field —
	// the other way options reach a field definition, and just as closed.
	test('a nested schema enum with no entry data yet is still closed', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nmeta:\n  note: x\n---\n',
			'src/content.config.ts': config(
				`n.object({ title: n.text(), meta: n.object({ note: n.text(), rubrika: n.enum(['zpravy', 'tipy']) }) })`,
			),
		})

		const meta = (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === 'meta')
		const field = meta?.fields?.find(f => f.name === 'rubrika')
		expect(field?.type).toBe('select')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	test('options inferred from entry data stay open — no content config at all', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\n---\n',
			'src/content/posts/b.md': '---\ntitle: B\nrubrika: zpravy\n---\n',
			'src/content/posts/c.md': '---\ntitle: C\nrubrika: tipy\n---\n',
			'src/content/posts/d.md': '---\ntitle: D\nrubrika: tipy\n---\n',
		})

		const field = (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === 'rubrika')
		expect(field?.type).toBe('select')
		expect(field?.options).toEqual(['tipy', 'zpravy'])
		expect(field?.optionsClosed).toBeUndefined()
	})

	// A declared *string* field whose values happen to repeat: the scan still offers the seen
	// values, but the schema never closed the set, so free text has to keep working.
	test('a declared free-text field with repeating values stays open', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\n---\n',
			'src/content/posts/b.md': '---\ntitle: B\nrubrika: zpravy\n---\n',
			'src/content/posts/c.md': '---\ntitle: C\nrubrika: tipy\n---\n',
			'src/content/posts/d.md': '---\ntitle: D\nrubrika: tipy\n---\n',
			'src/content.config.ts': config('n.object({ title: n.text(), rubrika: n.text() })'),
		})

		const field = (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === 'rubrika')
		expect(field?.optionsClosed).toBeUndefined()
	})
})
