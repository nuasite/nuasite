import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// Entry titles used to be derived twice, differently: the markdown branch read
// `frontmatter.title` and nothing else, the data branch read `name` first and `title`
// second. Both now go through one helper with a `title` → `name` → `label` fallback,
// overridable per collection via `defineCmsCollection({ cms: { titleField } })`.
describe('scanCollections — entry titles', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__entry-title-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	/** Write root-relative files (parent dirs included). */
	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	/** Titles of one collection's entries, keyed by slug. */
	async function titlesOf(collectionName: string): Promise<Record<string, string | undefined>> {
		const collections = await scanCollections(createNodeFs(root))
		const definition = collections[collectionName]
		if (!definition) throw new Error(`collection "${collectionName}" not scanned`)
		return Object.fromEntries((definition.entries ?? []).map(entry => [entry.slug, entry.title]))
	}

	describe('markdown collections', () => {
		test('falls back through title → name → label', async () => {
			await write({
				'src/content/testimonials/both.md': '---\ntitle: From title\nname: From name\n---\n',
				'src/content/testimonials/only-name.md': '---\nname: Alena Hábltová\n---\n',
				'src/content/testimonials/only-label.md': '---\nlabel: From label\n---\n',
				'src/content/testimonials/nothing.md': '---\nperex: no title-ish field here\n---\n',
			})

			expect(await titlesOf('testimonials')).toEqual({
				'both': 'From title',
				'only-name': 'Alena Hábltová',
				'only-label': 'From label',
				'nothing': undefined,
			})
		})

		test('`titleField` overrides both the fallback chain and a present `title`', async () => {
			await write({
				'src/content/testimonials/first.md': '---\ntitle: Ignored\nname: Also ignored\nheading: Zebra\n---\n',
				'src/content/testimonials/second.md': '---\ntitle: Ignored too\nheading: Anděl\n---\n',
				'src/content.config.ts': `import { defineCmsCollection } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const testimonials = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/testimonials' }),
	cms: { titleField: 'heading' },
})
export const collections = { testimonials }
`,
			})

			const collections = await scanCollections(createNodeFs(root))
			const definition = collections['testimonials']!
			expect(definition.titleField).toBe('heading')
			// Re-derived from `heading`, and re-sorted on the new titles.
			expect(definition.entries!.map(e => e.title)).toEqual(['Anděl', 'Zebra'])
		})

		test('`titleField` pointing at a missing field leaves the entry untitled rather than falling back', async () => {
			await write({
				'src/content/testimonials/first.md': '---\ntitle: Not the declared field\n---\n',
				'src/content.config.ts': `import { defineCmsCollection } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const testimonials = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/testimonials' }),
	cms: { titleField: 'heading' },
})
export const collections = { testimonials }
`,
			})

			expect(await titlesOf('testimonials')).toEqual({ first: undefined })
		})
	})

	describe('data collections', () => {
		// Intended behavior change: the data branch used to prefer `name` over `title`.
		// Unifying both branches on one helper makes `title` win; collections that relied
		// on `name`-first can pin it back with `cms: { titleField: 'name' }`.
		test('`title` wins over `name` (changed from the old name-first order)', async () => {
			await write({
				'src/content/team/alice.json': '{"name":"Alice","title":"Head of Engineering"}',
			})

			expect(await titlesOf('team')).toEqual({ alice: 'Head of Engineering' })
		})

		test('falls back through title → name → label', async () => {
			await write({
				'src/content/team/only-name.json': '{"name":"Alice"}',
				'src/content/team/only-label.yaml': 'label: From label\n',
				'src/content/team/nothing.json': '{"role":"Engineer"}',
			})

			expect(await titlesOf('team')).toEqual({
				'only-name': 'Alice',
				'only-label': 'From label',
				'nothing': undefined,
			})
		})

		test('`titleField` overrides both the fallback chain and `title`', async () => {
			await write({
				'src/content/team/alice.json': '{"name":"Alice","title":"Ignored","heading":"Alice Nováková"}',
				'src/content.config.ts': `import { defineCmsCollection } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const team = defineCmsCollection({
	loader: glob({ pattern: '*.json', base: './src/content/team' }),
	cms: { titleField: 'heading' },
})
export const collections = { team }
`,
			})

			const collections = await scanCollections(createNodeFs(root))
			expect(collections['team']!.titleField).toBe('heading')
			expect(collections['team']!.entries!.map(e => e.title)).toEqual(['Alice Nováková'])
		})

		test('`titleField: "name"` restores the old name-first order for a collection that wants it', async () => {
			await write({
				'src/content/team/alice.json': '{"name":"Alice","title":"Head of Engineering"}',
				'src/content.config.ts': `import { defineCmsCollection } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const team = defineCmsCollection({
	loader: glob({ pattern: '*.json', base: './src/content/team' }),
	cms: { titleField: 'name' },
})
export const collections = { team }
`,
			})

			expect(await titlesOf('team')).toEqual({ alice: 'Alice' })
		})
	})

	// The two branches share one helper; the observable contract is that identical
	// fields produce identical titles no matter which file format carries them.
	test('markdown and data derive the same title from the same fields', async () => {
		await write({
			'src/content/posts/both.md': '---\ntitle: From title\nname: From name\n---\n',
			'src/content/posts/only-name.md': '---\nname: From name\n---\n',
			'src/content/posts/only-label.md': '---\nlabel: From label\n---\n',
			'src/content/records/both.json': '{"title":"From title","name":"From name"}',
			'src/content/records/only-name.json': '{"name":"From name"}',
			'src/content/records/only-label.json': '{"label":"From label"}',
		})

		const collections = await scanCollections(createNodeFs(root))
		const markdown = Object.fromEntries((collections['posts']!.entries ?? []).map(e => [e.slug, e.title]))
		const data = Object.fromEntries((collections['records']!.entries ?? []).map(e => [e.slug, e.title]))

		expect(markdown).toEqual(data)
		expect(markdown).toEqual({
			'both': 'From title',
			'only-name': 'From name',
			'only-label': 'From label',
		})
	})
})
