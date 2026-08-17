import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * "+ Add" wrote its item straight to disk with no idea what the schema wanted, and a required key
 * inside that item is frontmatter the next build refuses. Across five production sites it was 13
 * of 14 build-breaking findings — the single biggest hole the content check found.
 *
 * Both first-party editors now build the item from the schema, but this path is reachable by any
 * client: an older editor, a script, the HTTP API. So the seeding also happens here, where every
 * one of them ends up.
 */
describe('entry-ops — appended repeater items', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__entry-repeater-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	/** Whatever `field` holds on disk, as a list — the assertions then read it without narrowing. */
	async function itemsOnDisk(field: string): Promise<unknown[]> {
		const entry = await createCmsCore(createNodeFs(root)).getEntry('people', 'ada')
		const value = entry?.frontmatter[field]
		expect(Array.isArray(value)).toBe(true)
		return Array.isArray(value) ? value : []
	}

	/** The item an `addArrayItem` of `{}` actually put on disk. */
	async function appended(field = 'stats'): Promise<unknown> {
		const result = await createCmsCore(createNodeFs(root)).addArrayItem({ collection: 'people', slug: 'ada', field, value: {} })
		expect(result.success).toBe(true)
		return (await itemsOnDisk(field)).at(-1)
	}

	const config = (statsItem: string) =>
		`import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

const people = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/people' }),
	schema: z.object({
		title: n.text(),
		stats: z.array(z.object(${statsItem})),
	}),
})

export const collections = { people }
`

	test('a client that appends {} gets the required keys the schema declares', async () => {
		await write({
			'src/content.config.ts': config('{ label: n.text(), value: n.number() }'),
			'src/content/people/ada.md': '---\ntitle: Ada\nstats: []\n---\n',
		})

		expect(await appended()).toEqual({ label: '', value: 0 })
	})

	// The other half of the rule. Seeding an optional key with '' breaks schemas that were happy
	// without it — an optional url or array field refuses '' — so an optional key stays absent.
	test('optional keys are left out rather than seeded', async () => {
		await write({
			'src/content.config.ts': config('{ label: n.text(), note: n.text().optional(), extra: z.array(z.string()).optional() }'),
			'src/content/people/ada.md': '---\ntitle: Ada\nstats: []\n---\n',
		})

		expect(await appended()).toEqual({ label: '' })
	})

	// Seeding must never overrule the client. A value someone chose is the whole point of the call.
	test('a value the client did send is kept, and only the missing keys are added', async () => {
		await write({
			'src/content.config.ts': config('{ label: n.text(), value: n.number() }'),
			'src/content/people/ada.md': '---\ntitle: Ada\nstats: []\n---\n',
		})

		await createCmsCore(createNodeFs(root)).addArrayItem({ collection: 'people', slug: 'ada', field: 'stats', value: { label: 'Age', value: 42 } })

		expect(await itemsOnDisk('stats')).toEqual([{ label: 'Age', value: 42 }])
	})

	// A collection the config does not describe has nothing to seed from, and the call still works —
	// seeding is a repair, not a precondition.
	test('a repeater the config does not declare is appended unchanged', async () => {
		await write({
			'src/content.config.ts': config('{ label: n.text() }'),
			'src/content/people/ada.md': '---\ntitle: Ada\nstats: []\nundeclared: []\n---\n',
		})

		expect(await appended('undeclared')).toEqual({})
	})

	// An array of scalars is not an object repeater; appending a string must stay a string.
	test('a scalar array item is not turned into an object', async () => {
		await write({
			'src/content.config.ts': config('{ label: n.text() }').replace(
				'stats: z.array(z.object({ label: n.text() })),',
				'stats: z.array(z.object({ label: n.text() })),\n\t\ttags: z.array(z.string()),',
			),
			'src/content/people/ada.md': '---\ntitle: Ada\nstats: []\ntags: []\n---\n',
		})

		await createCmsCore(createNodeFs(root)).addArrayItem({ collection: 'people', slug: 'ada', field: 'tags', value: 'release' })

		expect(await itemsOnDisk('tags')).toEqual(['release'])
	})
})
