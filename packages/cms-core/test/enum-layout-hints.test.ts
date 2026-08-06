import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A closed option list and a human label used to be mutually exclusive: `n.enum` was the only
// way to declare a closed set, and it was the only marker without an options object — so the
// fields an editor most wants closed (rubrika) showed up under their bare field name.
// Hints ride in the *second* argument here, because the value list owns the first.
describe('scanCollections — n.enum carries layout hints', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__enum-hints-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	async function scanField(name: string) {
		return (await scanCollections(createNodeFs(root)))['posts']?.fields.find(f => f.name === name)
	}

	// The whole point of the issue: the label reaches the field definition *and* the enum stays
	// the closed select issue 05 made it. This assertion is what fails if the parser never reads
	// the second argument — the runtime signature alone would accept the hints and drop them.
	test('label and help reach the field definition without loosening the select', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\n---\n',
			'src/content/posts/b.md': '---\ntitle: B\nrubrika: tipy\n---\n',
			'src/content.config.ts': config(
				`n.object({ title: n.text(), rubrika: n.enum(['zpravy', 'tipy'], { label: 'Rubrika', help: 'Kam článek patří' }) })`,
			),
		})

		const field = await scanField('rubrika')
		expect(field?.label).toBe('Rubrika')
		expect(field?.help).toBe('Kam článek patří')
		expect(field?.type).toBe('select')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	// Not just label/help — the whole LayoutHints surface has to behave the same on an enum as
	// it does on the markers that take it in the first argument.
	test('the full LayoutHints surface lands the same as on n.text', async () => {
		const hints = `{ label: 'L', help: 'H', group: 'Meta', sidebar: true, width: 'half', order: -2, hidden: true }`
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\nstitek: x\n---\n',
			'src/content.config.ts': config(
				`n.object({ title: n.text(), rubrika: n.enum(['zpravy', 'tipy'], ${hints}), stitek: n.text(${hints}) })`,
			),
		})

		const rubrika = await scanField('rubrika')
		const stitek = await scanField('stitek')
		const layoutOf = (f: typeof rubrika) => ({
			label: f?.label,
			help: f?.help,
			group: f?.group,
			position: f?.position,
			width: f?.width,
			order: f?.order,
			hidden: f?.hidden,
		})

		expect(layoutOf(rubrika)).toEqual({
			label: 'L',
			help: 'H',
			group: 'Meta',
			position: 'sidebar',
			width: 'half',
			order: -2,
			hidden: true,
		})
		expect(layoutOf(rubrika)).toEqual(layoutOf(stitek))
	})

	// A nested enum with no entry data goes down the other path onto a field definition
	// (`parsedFieldToFieldDefinition`), so the hints have to survive that one too.
	test('hints survive on a nested enum no entry fills in yet', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nmeta:\n  note: x\n---\n',
			'src/content.config.ts': config(
				`n.object({ title: n.text(), meta: n.object({ note: n.text(), rubrika: n.enum(['zpravy', 'tipy'], { label: 'Rubrika' }) }) })`,
			),
		})

		const field = (await scanField('meta'))?.fields?.find(f => f.name === 'rubrika')
		expect(field?.label).toBe('Rubrika')
		expect(field?.type).toBe('select')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	test('n.enum with no second argument is unchanged — no layout, still a closed select', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\n---\n',
			'src/content.config.ts': config(`n.object({ title: n.text(), rubrika: n.enum(['zpravy', 'tipy']) })`),
		})

		const field = await scanField('rubrika')
		expect(field?.label).toBeUndefined()
		expect(field?.help).toBeUndefined()
		expect(field?.group).toBeUndefined()
		expect(field?.width).toBeUndefined()
		expect(field?.order).toBeUndefined()
		expect(field?.hidden).toBeUndefined()
		// `position` is the scanner's own default for a non-sidebar field type — not something
		// the hint path touches. Without a `sidebar` hint it has to stay exactly that.
		expect(field?.position).toBe('header')
		expect(field?.type).toBe('select')
		expect(field?.options).toEqual(['zpravy', 'tipy'])
		expect(field?.optionsClosed).toBe(true)
	})

	// Bare Zod can't be given our hints, and its own second argument (error params) shares no key
	// with the layout shape — so it must read exactly as it did before, not crash on the lookup.
	test('bare z.enum is unchanged, with or without a Zod params argument', async () => {
		await write({
			'src/content/posts/a.md': '---\ntitle: A\nrubrika: zpravy\nstav: draft\n---\n',
			'src/content.config.ts': `import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
const posts = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/posts' }),
	schema: z.object({
		title: z.string(),
		rubrika: z.enum(['zpravy', 'tipy']),
		stav: z.enum(['draft', 'live'], { message: 'Neplatný stav' }),
	}),
})
export const collections = { posts }
`,
		})

		for (const [name, options] of [['rubrika', ['zpravy', 'tipy']], ['stav', ['draft', 'live']]] as const) {
			const field = await scanField(name)
			expect(field?.type).toBe('select')
			expect(field?.options).toEqual([...options])
			expect(field?.optionsClosed).toBe(true)
			expect(field?.label).toBeUndefined()
			expect(field?.help).toBeUndefined()
		}
	})
})
