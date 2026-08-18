import { createCmsCore, createNodeFs, parseConfigSource } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A required field silently written empty broke a production build once: an article
// saved with `topic: ''`, no URL derivable from it, 404 in preview and a red deploy.
// The invariant lives here, under every consumer (preview editor, agent, sidecar) —
// but only over `required` that a schema actually declared. See the long note on
// `missingRequiredFields` in `handlers/entry-ops.ts` for why the provenance matters.
describe('entry-ops — required-field validation', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__entry-required-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	async function read(relative: string): Promise<string> {
		return fs.readFile(path.join(root, relative), 'utf-8')
	}

	async function exists(relative: string): Promise<boolean> {
		try {
			await fs.access(path.join(root, relative))
			return true
		} catch {
			return false
		}
	}

	function core(): ReturnType<typeof createCmsCore> {
		return createCmsCore(createNodeFs(root))
	}

	/**
	 * `articles` is markdown, `products` is data. Between them the schema covers every
	 * shape the check has to distinguish: plain required scalars, an `.optional()` field,
	 * a `hidden` required field, and the container types whose "empty" is a real value.
	 */
	const CONFIG = `import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const articles = defineCollection({
	schema: z.object({
		title: n.text(),
		topic: n.text(),
		draft: n.boolean(),
		views: n.number(),
		tags: z.array(z.string()),
		meta: z.object({ author: n.text() }),
		perex: n.textarea().optional(),
		internalRef: n.text({ hidden: true }),
	}),
})

const products = defineCollection({
	schema: z.object({
		name: n.text(),
		sku: n.text(),
	}),
})

export const collections = { articles, products }
`

	/** Satisfies every schema-required `articles` field the form can actually reach. */
	const VALID_ARTICLE = {
		title: 'Launch day',
		topic: 'launch',
		draft: false,
		views: 0,
		tags: [] as string[],
		meta: {},
	}

	const VALID_ARTICLE_FILE = '---\ntitle: Launch day\ntopic: launch\ndraft: false\nviews: 0\ntags: []\nmeta: {}\n---\n# Launch day\n'

	// ------------------------------------------------------------------
	// AC1 — createEntry rejects and writes nothing
	// ------------------------------------------------------------------

	test('createEntry writes the entry when every schema-required field is filled (control)', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({ collection: 'articles', slug: 'launch-day', frontmatter: VALID_ARTICLE, body: 'Body' })

		expect(result).toMatchObject({ success: true, sourcePath: 'src/content/articles/launch-day.md' })
		expect(await exists('src/content/articles/launch-day.md')).toBe(true)
	})

	test('createEntry rejects a blank required field and leaves nothing on disk', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({
			collection: 'articles',
			slug: 'launch-day',
			frontmatter: { ...VALID_ARTICLE, topic: '' },
			body: 'Body',
		})

		expect(result.success).toBe(false)
		expect(await exists('src/content/articles/launch-day.md')).toBe(false)
	})

	test('createEntry rejects a required field that is missing entirely, and one that is null', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const { topic: _omitted, ...withoutTopic } = VALID_ARTICLE
		const absent = await core().createEntry({ collection: 'articles', slug: 'absent', frontmatter: withoutTopic })
		const nulled = await core().createEntry({ collection: 'articles', slug: 'nulled', frontmatter: { ...VALID_ARTICLE, topic: null } })

		expect(absent.success).toBe(false)
		expect(nulled.success).toBe(false)
		expect(await exists('src/content/articles/absent.md')).toBe(false)
		expect(await exists('src/content/articles/nulled.md')).toBe(false)
	})

	// ------------------------------------------------------------------
	// AC8 — the message names the offending field
	// ------------------------------------------------------------------

	test('the error names the offending field rather than saying "validation failed"', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({ collection: 'articles', slug: 'launch-day', frontmatter: { ...VALID_ARTICLE, topic: '' } })

		expect(result.success).toBe(false)
		expect(result.error).toContain('topic')
		expect(result.error).toBe('Field "topic" is required')
	})

	test('the error lists every blank required field when more than one is empty', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({
			collection: 'articles',
			slug: 'launch-day',
			frontmatter: { ...VALID_ARTICLE, title: '', topic: '' },
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain('title')
		expect(result.error).toContain('topic')
	})

	// ------------------------------------------------------------------
	// AC2 — updateEntry rejects and leaves the file untouched
	// ------------------------------------------------------------------

	test('updateEntry blanking a required field is rejected and the file stays byte-identical', async () => {
		await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/launch-day.md': VALID_ARTICLE_FILE })
		const before = await read('src/content/articles/launch-day.md')

		const result = await core().updateEntry({ collection: 'articles', slug: 'launch-day', frontmatter: { topic: '' } })

		expect(result.success).toBe(false)
		expect(result.error).toContain('topic')
		expect(await read('src/content/articles/launch-day.md')).toBe(before)
	})

	test('updateEntry rejects a body-only edit of a file that is already missing a required field', async () => {
		// The merged result is what lands on disk, so a pre-existing hole blocks the write
		// even though the patch itself carries nothing wrong.
		await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/broken.md': '---\ntitle: Broken\n---\n# Broken\n' })
		const before = await read('src/content/articles/broken.md')

		const result = await core().updateEntry({ collection: 'articles', slug: 'broken', body: '# Rewritten' })

		expect(result.success).toBe(false)
		expect(result.error).toContain('topic')
		expect(await read('src/content/articles/broken.md')).toBe(before)
	})

	test('updateEntry validates the merged result, not the incoming patch', async () => {
		// The patch omits `topic` entirely; the file already carries it, so the merged
		// frontmatter is complete and the write goes through.
		await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/launch-day.md': VALID_ARTICLE_FILE })

		const result = await core().updateEntry({ collection: 'articles', slug: 'launch-day', frontmatter: { title: 'Launch day (edited)' } })

		expect(result.success).toBe(true)
		const written = await read('src/content/articles/launch-day.md')
		expect(written).toContain('title: Launch day (edited)')
		expect(written).toContain('topic: launch')
	})

	// ------------------------------------------------------------------
	// AC3 — data entries (.json / .yaml), both branches
	// ------------------------------------------------------------------

	describe('data entries', () => {
		test('createEntry (json) rejects a blank required field and writes nothing', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'products',
				slug: 'desk',
				frontmatter: { name: 'Desk', sku: '' },
				fileExtension: 'json',
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain('sku')
			expect(await exists('src/content/products/desk.json')).toBe(false)
		})

		test('createEntry (yaml) rejects a blank required field and writes nothing', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'products',
				slug: 'chair',
				frontmatter: { name: '', sku: 'CH-1' },
				fileExtension: 'yaml',
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain('name')
			expect(await exists('src/content/products/chair.yaml')).toBe(false)
		})

		test('createEntry (json) writes when the data entry is complete (control)', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'products',
				slug: 'desk',
				frontmatter: { name: 'Desk', sku: 'DK-1' },
				fileExtension: 'json',
			})

			expect(result).toMatchObject({ success: true, sourcePath: 'src/content/products/desk.json' })
		})

		test('updateEntry (json) blanking a required field is rejected and the file stays byte-identical', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/products/desk.json': '{\n  "name": "Desk",\n  "sku": "DK-1"\n}\n' })
			const before = await read('src/content/products/desk.json')

			const result = await core().updateEntry({ collection: 'products', slug: 'desk', frontmatter: { sku: '' } })

			expect(result.success).toBe(false)
			expect(result.error).toContain('sku')
			expect(await read('src/content/products/desk.json')).toBe(before)
		})

		test('updateEntry (yaml) blanking a required field is rejected and the file stays byte-identical', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/products/chair.yaml': 'name: Chair\nsku: CH-1\n' })
			const before = await read('src/content/products/chair.yaml')

			const result = await core().updateEntry({ collection: 'products', slug: 'chair', frontmatter: { name: null } })

			expect(result.success).toBe(false)
			expect(result.error).toContain('name')
			expect(await read('src/content/products/chair.yaml')).toBe(before)
		})

		test('updateEntry (json) validates the merged object, so a partial patch still passes', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/products/desk.json': '{\n  "name": "Desk",\n  "sku": "DK-1"\n}\n' })

			const result = await core().updateEntry({ collection: 'products', slug: 'desk', frontmatter: { name: 'Standing desk' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/products/desk.json')).toBe('{\n  "name": "Standing desk",\n  "sku": "DK-1"\n}\n')
		})
	})

	// ------------------------------------------------------------------
	// AC4 — inferred `required` is never enforced (the trap)
	// ------------------------------------------------------------------

	describe('collections absent from the content config keep inferred `required` unenforced', () => {
		test('a new entry may omit a field that every existing entry carries (no content config at all)', async () => {
			await write({
				'src/content/testimonials/first.md': '---\ntitle: First\nauthor: Alena\nquote: Skvělé\n---\n',
			})

			// Premise: with a single scanned entry the scanner infers *everything* as required.
			// Enforcing that would make the collection impossible to extend.
			const scanned = await core().scanCollections()
			expect(scanned['testimonials']!.fields.find(f => f.name === 'quote')?.required).toBe(true)

			const result = await core().createEntry({ collection: 'testimonials', slug: 'second', frontmatter: { title: 'Second' }, body: 'Body' })

			expect(result).toMatchObject({ success: true, sourcePath: 'src/content/testimonials/second.md' })
			expect(await read('src/content/testimonials/second.md')).toContain('title: Second')
		})

		test('a content config that declares other collections does not gate an unlisted one', async () => {
			// The gate keys on the *collection* being in the config, not on a config existing.
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/testimonials/first.md': '---\ntitle: First\nauthor: Alena\nquote: Skvělé\n---\n',
			})

			const result = await core().createEntry({ collection: 'testimonials', slug: 'second', frontmatter: { title: 'Second' } })

			expect(result.success).toBe(true)
			expect(await exists('src/content/testimonials/second.md')).toBe(true)
		})

		test('updateEntry on an unlisted collection may blank a field the scanner inferred as required', async () => {
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/testimonials/first.md': '---\ntitle: First\nauthor: Alena\nquote: Skvělé\n---\n',
			})

			const result = await core().updateEntry({ collection: 'testimonials', slug: 'first', frontmatter: { quote: '' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/testimonials/first.md')).toContain('quote: ""')
		})
	})

	// ------------------------------------------------------------------
	// AC5 — `.optional()` is never enforced
	// ------------------------------------------------------------------

	test('an `.optional()` field is not validated even when every scanned entry carries it', async () => {
		await write({
			'src/content.config.ts': CONFIG,
			'src/content/articles/launch-day.md': VALID_ARTICLE_FILE.replace('meta: {}\n', 'meta: {}\nperex: Present everywhere\n'),
		})

		// Every scanned entry has `perex`, so inference alone would call it required.
		const parsed = parseConfigSource(CONFIG)
		expect(parsed.get('articles')!.fields.find(f => f.name === 'perex')!.required).toBe(false)

		const created = await core().createEntry({ collection: 'articles', slug: 'no-perex', frontmatter: VALID_ARTICLE })
		expect(created.success).toBe(true)

		const emptied = await core().updateEntry({ collection: 'articles', slug: 'launch-day', frontmatter: { perex: '' } })
		expect(emptied.success).toBe(true)
	})

	// A field factory is one declaration reused across collections, so the `.optional()` it
	// applies is as real as an inline one. While the parser could not see into the helper the
	// guard read the field as required and refused writes the schema accepts.
	test('an `.optional()` hidden inside a same-file helper is not enforced either', async () => {
		const config = `import { n } from '@nuasite/cms'
import { defineCollection } from 'astro:content'

const optionalTag = () => n.enum(['news', 'tips']).optional()

const notes = defineCollection({
	schema: n.object({
		title: n.text(),
		tag: optionalTag(),
	}),
})

export const collections = { notes }
`
		await write({ 'src/content.config.ts': config, 'src/content/notes/first.md': '---\ntitle: First\ntag: news\n---\n' })

		// Premise: the helper's `.optional()` reaches the parsed field.
		expect(parseConfigSource(config).get('notes')!.fields.find(f => f.name === 'tag')).toMatchObject({
			type: 'select',
			options: ['news', 'tips'],
			required: false,
		})

		const created = await core().createEntry({ collection: 'notes', slug: 'second', frontmatter: { title: 'Second' } })
		expect(created.success).toBe(true)

		const emptied = await core().updateEntry({ collection: 'notes', slug: 'first', frontmatter: { tag: '' } })
		expect(emptied.success).toBe(true)

		// The sibling the helper does not touch is still guarded.
		const blanked = await core().updateEntry({ collection: 'notes', slug: 'first', frontmatter: { title: '' } })
		expect(blanked.success).toBe(false)
		expect(blanked.error).toContain('title')
	})

	// ------------------------------------------------------------------
	// AC6 — empty array / empty object / `false` / `0` are values
	// ------------------------------------------------------------------

	test('`[]`, `{}`, `false` and `0` satisfy a required field', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({
			collection: 'articles',
			slug: 'falsy',
			frontmatter: { title: 'Falsy', topic: 'edge-cases', draft: false, views: 0, tags: [], meta: {} },
		})

		expect(result.success).toBe(true)
		const written = await read('src/content/articles/falsy.md')
		expect(written).toContain('draft: false')
		expect(written).toContain('views: 0')
		expect(written).toContain('tags: []')
		expect(written).toContain('meta: {}')
	})

	test('a required nested key inside an otherwise-present object is not walked into', async () => {
		// `meta.author` is required in the schema, but only the top-level `meta` is checked:
		// an inner hole says nothing about whether the parent was meant to be filled in.
		await write({ 'src/content.config.ts': CONFIG })

		const result = await core().createEntry({ collection: 'articles', slug: 'shallow', frontmatter: { ...VALID_ARTICLE, meta: { author: '' } } })

		expect(result.success).toBe(true)
	})

	// ------------------------------------------------------------------
	// AC7 — `hidden` required fields are skipped
	// ------------------------------------------------------------------

	test('a `hidden` required field is not validated — the form offers no way to fill it', async () => {
		await write({ 'src/content.config.ts': CONFIG })

		// Premise: `internalRef` really is required *and* hidden in the schema.
		const internalRef = parseConfigSource(CONFIG).get('articles')!.fields.find(f => f.name === 'internalRef')!
		expect(internalRef.required).toBe(true)
		expect(internalRef.layout?.hidden).toBe(true)

		// `VALID_ARTICLE` omits `internalRef` throughout; assert that explicitly here.
		expect('internalRef' in VALID_ARTICLE).toBe(false)
		const created = await core().createEntry({ collection: 'articles', slug: 'hidden-ok', frontmatter: VALID_ARTICLE })
		expect(created.success).toBe(true)

		const blanked = await core().updateEntry({ collection: 'articles', slug: 'hidden-ok', frontmatter: { internalRef: '' } })
		expect(blanked.success).toBe(true)
	})
})
