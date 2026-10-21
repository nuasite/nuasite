import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

describe('image alt text fields', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__image-alt-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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
import { defineCollection } from 'astro:content'

const articles = defineCollection({
	schema: n.object({
		title: n.text(),
		pic: n.image().optional(),
		picAlt: n.text().optional(),
		hero: n.image().optional(),
		heroAlt: n.url().optional(),
		banner: n.image().optional(),
		gallery: n.array(n.object({
			photo: n.image(),
			photoAlt: n.textarea().optional(),
		})).optional(),
	}),
})

export const collections = { articles }
`

	async function articleFields() {
		await write({
			'src/content.config.ts': CONFIG,
			'src/content/articles/first.md': '---\ntitle: First\npic: /uploads/a.png\n---\n',
		})
		return (await createCmsCore(createNodeFs(root)).scanCollections())['articles']!.fields
	}

	test('names the sibling <name>Alt text field of an image, before any entry fills it in', async () => {
		const fields = await articleFields()
		expect(fields.find(f => f.name === 'pic')?.altField).toBe('picAlt')
		// The alt field stays a field of its own: only the editor decides to show it with the image.
		expect(fields.find(f => f.name === 'picAlt')?.type).toBe('text')
	})

	test('pairs inside the objects of an array too', async () => {
		const gallery = (await articleFields()).find(f => f.name === 'gallery')
		expect(gallery?.fields?.find(f => f.name === 'photo')?.altField).toBe('photoAlt')
	})

	test('lists a declared field that no entry has yet', async () => {
		const banner = (await articleFields()).find(f => f.name === 'banner')
		expect(banner?.type).toBe('image')
		expect(banner?.required).toBe(false)
	})

	test('leaves an image without a text sibling, or with one of another type, unpaired', async () => {
		const fields = await articleFields()
		expect(fields.find(f => f.name === 'banner')?.altField).toBeUndefined()
		expect(fields.find(f => f.name === 'hero')?.altField).toBeUndefined()
	})
})
