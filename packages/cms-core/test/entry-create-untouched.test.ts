import { createCmsCore, createNodeFs, normalizeCreateWrite } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * What a create form left untouched is not written.
 *
 * Every create form seeds from `blankFieldValue`: an untouched text field arrives as `''`, an
 * untouched object as `{}`. Only the in-page editor filtered those out. The collections admin and
 * the dashboard wrote them as-is, so an optional object nobody filled in reached disk as `{}`,
 * the schema rejected it for its required members, and Astro failed the whole site build.
 */
describe('entry-ops — untouched create values', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__entry-create-untouched-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	const CONFIG = `import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

const settings = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/settings' }),
	schema: z.object({
		title: n.text(),
		summary: n.textarea().optional(),
		promo: z.object({ heading: n.text(), link: n.url() }).optional(),
		meta: z.object({ author: n.text().optional() }),
	}),
})

export const collections = { settings }
`

	const create = async (frontmatter: Record<string, unknown>) => {
		await fs.mkdir(path.join(root, 'src'), { recursive: true })
		await fs.writeFile(path.join(root, 'src/content.config.ts'), CONFIG)
		const core = createCmsCore(createNodeFs(root))
		const result = await core.createEntry({ collection: 'settings', slug: 'cs', frontmatter })
		const entry = await core.getEntry('settings', 'cs')
		return { result, frontmatter: entry?.frontmatter }
	}

	test('an optional object nobody filled in is not written, nor is an empty text field', async () => {
		const { result, frontmatter } = await create({ title: 'Settings', summary: '', promo: { heading: '', link: '' }, meta: {} })

		expect(result.success).toBe(true)
		expect(frontmatter).toEqual({ title: 'Settings', meta: {} })
	})

	test('a partly filled object keeps what was filled and loses only the blanks', async () => {
		const { result, frontmatter } = await create({ title: 'Settings', promo: { heading: 'Complaints', link: '' }, meta: { author: '' } })

		expect(result.success).toBe(true)
		expect(frontmatter).toEqual({ title: 'Settings', promo: { heading: 'Complaints' }, meta: {} })
	})
})

describe('normalizeCreateWrite', () => {
	const fields = [
		{ name: 'promo', required: false, fields: [{ name: 'heading', required: true }] },
		{ name: 'meta', required: true, fields: [{ name: 'author', required: false }] },
	]

	test('false, 0 and [] are values and stay', () => {
		expect(normalizeCreateWrite(fields, { draft: false, views: 0, tags: [] })).toEqual({ draft: false, views: 0, tags: [] })
	})

	test('an object the config does not declare is treated as optional', () => {
		expect(normalizeCreateWrite(fields, { extra: { note: '' } })).toEqual({})
	})

	test('a required object left empty stays, for the required-field guard to judge', () => {
		expect(normalizeCreateWrite(fields, { meta: { author: undefined } })).toEqual({ meta: {} })
	})
})
