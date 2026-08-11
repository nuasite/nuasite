import { createCmsCore, createNodeFs, parseConfigSource, slugifyHref } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// Derived fields (`categoryHref` from `category`) used to be recomputed in exactly one
// place: the preview editor's form state. Every other write path — the sidecar, the dash,
// an agent — left them holding whatever was there before. The recompute now lives in
// `cms-core`, under all of them, and the declaration that turns it on is part of the schema
// instead of a heuristic over three sampled values.
describe('derived fields — declaration, recompute, and the surviving inference', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__derived-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	function core(): ReturnType<typeof createCmsCore> {
		return createCmsCore(createNodeFs(root))
	}

	/**
	 * `articles` is markdown, `products` is data, `notes` carries the visible variant.
	 * Between them the schema covers every authoring form (shorthand, both transforms) and
	 * both `hidden` outcomes.
	 */
	const CONFIG = `import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const articles = defineCollection({
	schema: z.object({
		title: n.text(),
		category: n.text().optional(),
		categoryHref: n.text({ derivedFrom: 'category' }).optional(),
		categorySlug: n.text({ derivedFrom: { field: 'category', transform: 'slug' } }).optional(),
		titleCopy: n.text({ derivedFrom: { field: 'title', transform: 'copy' } }).optional(),
	}),
})

const products = defineCollection({
	schema: z.object({
		name: n.text(),
		line: n.text().optional(),
		lineHref: n.text({ derivedFrom: 'line' }).optional(),
	}),
})

const notes = defineCollection({
	schema: z.object({
		title: n.text(),
		topic: n.text(),
		topicHref: n.text({ derivedFrom: 'topic', hidden: false }),
	}),
})

export const collections = { articles, products, notes }
`

	// ------------------------------------------------------------------
	// AC1a / AC2 (parse half) — the authoring surface
	// ------------------------------------------------------------------

	describe('authoring surface', () => {
		test('the shorthand `derivedFrom: "category"` parses to the source name and no transform', () => {
			const field = parseConfigSource(CONFIG).get('articles')!.fields.find(f => f.name === 'categoryHref')!

			expect(field.layout?.derivedFrom).toBe('category')
			// Absent, not `'slugifyHref'` — the default lives in one place, the transform table.
			expect(field.layout?.derivedTransform).toBeUndefined()
		})

		test('the object form parses `field` + `transform`', () => {
			const fields = parseConfigSource(CONFIG).get('articles')!.fields

			expect(fields.find(f => f.name === 'categorySlug')!.layout).toMatchObject({
				derivedFrom: 'category',
				derivedTransform: 'slug',
			})
			expect(fields.find(f => f.name === 'titleCopy')!.layout).toMatchObject({
				derivedFrom: 'title',
				derivedTransform: 'copy',
			})
		})

		test('an unknown transform name keeps the derivation and falls back to the default', () => {
			const source = CONFIG.replace(`{ field: 'category', transform: 'slug' }`, `{ field: 'category', transform: 'shout' }`)

			const field = parseConfigSource(source).get('articles')!.fields.find(f => f.name === 'categorySlug')!

			expect(field.layout?.derivedFrom).toBe('category')
			expect(field.layout?.derivedTransform).toBeUndefined()
		})

		test('an object form without `field` declares nothing — there is no source to derive from', () => {
			const source = CONFIG.replace(`{ field: 'category', transform: 'slug' }`, `{ transform: 'slug' }`)

			const field = parseConfigSource(source).get('articles')!.fields.find(f => f.name === 'categorySlug')!

			expect(field.layout?.derivedFrom).toBeUndefined()
		})
	})

	// ------------------------------------------------------------------
	// AC1a / AC7 — what the scan reports
	// ------------------------------------------------------------------

	describe('scanned definition', () => {
		const ARTICLE_FILE = '---\ntitle: Aktuálně\ncategory: Aktuálně z nezisku\ncategoryHref: /aktualne-z-nezisku\n'
			+ 'categorySlug: aktualne-z-nezisku\ntitleCopy: Aktuálně\n---\n# Aktuálně\n'

		test('a declared derived field reports `derivedFrom` and is hidden by default', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/aktualne.md': ARTICLE_FILE })

			const field = (await core().scanCollections())['articles']!.fields.find(f => f.name === 'categoryHref')!

			expect(field.derivedFrom).toBe('category')
			expect(field.hidden).toBe(true)
		})

		test('the transform reaches the definition alongside the source name', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/aktualne.md': ARTICLE_FILE })

			const fields = (await core().scanCollections())['articles']!.fields

			expect(fields.find(f => f.name === 'categorySlug')).toMatchObject({ derivedFrom: 'category', derivedTransform: 'slug' })
			expect(fields.find(f => f.name === 'titleCopy')).toMatchObject({ derivedFrom: 'title', derivedTransform: 'copy' })
			// The shorthand carries no transform — consumers read that as `slugifyHref`.
			expect(fields.find(f => f.name === 'categoryHref')!.derivedTransform).toBeUndefined()
		})

		test('an explicit `hidden: false` on a derived field wins over the implied hiding', async () => {
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/notes/prvni.md': '---\ntitle: První\ntopic: Lidé\ntopicHref: /lide\n---\n',
			})

			const field = (await core().scanCollections())['notes']!.fields.find(f => f.name === 'topicHref')!

			expect(field.derivedFrom).toBe('topic')
			expect(field.hidden).toBe(false)
		})
	})

	// ------------------------------------------------------------------
	// AC8 / AC9 — declaration vs. the surviving inference
	// ------------------------------------------------------------------

	describe('declaration beats inference, inference still covers undeclared fields', () => {
		// Every `authorHref` here is exactly `slugifyHref(author)`, so the heuristic has a
		// perfect case for deriving it from `author`.
		const NOTE_FILES = {
			'src/content/notes/prvni.md': '---\ntitle: První\nauthor: Jana Nováková\nauthorHref: /jana-novakova\ntopic: Lidé\n---\n',
			'src/content/notes/druha.md': '---\ntitle: Druhá\nauthor: Petr Svoboda\nauthorHref: /petr-svoboda\ntopic: Lidé\n---\n',
		}

		const notesConfig = (authorHrefDeclaration: string) =>
			`import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const notes = defineCollection({
	schema: z.object({
		title: n.text(),
		author: n.text(),
		authorHref: ${authorHrefDeclaration},
		topic: n.text(),
	}),
})

export const collections = { notes }
`

		test('control: with no declaration the heuristic derives `authorHref` from `author`', async () => {
			await write({ 'src/content.config.ts': notesConfig('n.text()'), ...NOTE_FILES })

			const field = (await core().scanCollections())['notes']!.fields.find(f => f.name === 'authorHref')!

			expect(field.derivedFrom).toBe('author')
			expect(field.hidden).toBe(true)
		})

		test('a declaration pointing elsewhere wins — the heuristic never overwrites it', async () => {
			await write({ 'src/content.config.ts': notesConfig(`n.text({ derivedFrom: 'topic' })`), ...NOTE_FILES })

			const field = (await core().scanCollections())['notes']!.fields.find(f => f.name === 'authorHref')!

			// `detectDerivedHrefFields` runs after `applyParsedConfig` and skips any field that
			// already carries `derivedFrom`, so the config is the one that decides.
			expect(field.derivedFrom).toBe('topic')
		})

		test('undeclared fields behave exactly as before: no content config, inference still fires', async () => {
			await write({
				'src/content/blog/prvni.md': '---\ntitle: První\ncategory: Aktuálně z nezisku\ncategoryHref: /aktualne-z-nezisku\n---\n',
				'src/content/blog/druhy.md': '---\ntitle: Druhý\ncategory: Lidé\ncategoryHref: /lide\n---\n',
			})

			const field = (await core().scanCollections())['blog']!.fields.find(f => f.name === 'categoryHref')!

			expect(field.derivedFrom).toBe('category')
			expect(field.hidden).toBe(true)
			expect(field.derivedTransform).toBeUndefined()
		})

		test('an inferred derived field is not recomputed on write — only a declaration opts in', async () => {
			// The guess samples at most three values; letting it rewrite files would turn a
			// coincidence into data loss. Undeclared fields keep the pre-change behaviour.
			await write({
				'src/content/blog/prvni.md': '---\ntitle: První\ncategory: Aktuálně z nezisku\ncategoryHref: /aktualne-z-nezisku\n---\n',
				'src/content/blog/druhy.md': '---\ntitle: Druhý\ncategory: Lidé\ncategoryHref: /lide\n---\n',
			})

			const result = await core().updateEntry({ collection: 'blog', slug: 'prvni', frontmatter: { category: 'Zcela jiná rubrika' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/blog/prvni.md')).toContain('categoryHref: /aktualne-z-nezisku')
		})
	})

	// ------------------------------------------------------------------
	// AC1b / AC2 / AC3 / AC10 — the recompute on create
	// ------------------------------------------------------------------

	describe('createEntry', () => {
		test('markdown: the declared derived fields are computed from the source, each with its transform', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'articles',
				slug: 'aktualne',
				frontmatter: { title: 'Aktuálně z nezisku', category: 'Aktuálně z nezisku' },
				body: '# Aktuálně',
			})

			expect(result.success).toBe(true)
			const written = await read('src/content/articles/aktualne.md')
			// Shorthand → slugifyHref: leading slash, folded diacritics.
			expect(written).toContain('categoryHref: /aktualne-z-nezisku')
			// `slug` → the same fold without the leading slash.
			expect(written).toContain('categorySlug: aktualne-z-nezisku')
			// `copy` → the source value, untouched.
			expect(written).toContain('titleCopy: Aktuálně z nezisku')
		})

		test('markdown: an incoming derived value is overwritten by the computed one', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'articles',
				slug: 'stale',
				frontmatter: { title: 'Stale', category: 'Lidé', categoryHref: '/something-else' },
			})

			expect(result.success).toBe(true)
			expect(await read('src/content/articles/stale.md')).toContain('categoryHref: /lide')
		})

		test('json: the data branch computes the same values as the markdown branch', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'products',
				slug: 'desk',
				frontmatter: { name: 'Desk', line: 'Aktuálně z nezisku' },
				fileExtension: 'json',
			})

			expect(result.success).toBe(true)
			expect(JSON.parse(await read('src/content/products/desk.json')).lineHref).toBe('/aktualne-z-nezisku')
		})

		test('yaml: the data branch computes the derived value too', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({
				collection: 'products',
				slug: 'chair',
				frontmatter: { name: 'Chair', line: 'Lidé' },
				fileExtension: 'yaml',
			})

			expect(result.success).toBe(true)
			expect(await read('src/content/products/chair.yaml')).toContain('lineHref: /lide')
		})

		test('diacritics fold exactly as they always have: `Lidé` → `/lide`', async () => {
			// Guarding the shared helper directly as well: the declared path must not drift
			// from what the inference-era `slugifyHref` produced, or migrating a field rewrites data.
			expect(slugifyHref('Lidé')).toBe('/lide')

			await write({ 'src/content.config.ts': CONFIG })
			await core().createEntry({ collection: 'articles', slug: 'lide', frontmatter: { title: 'Lidé', category: 'Lidé' } })

			expect(await read('src/content/articles/lide.md')).toContain('categoryHref: /lide')
		})
	})

	// ------------------------------------------------------------------
	// AC3 / AC4 — the recompute on update
	// ------------------------------------------------------------------

	describe('updateEntry', () => {
		const ARTICLE_FILE = '---\ntitle: Aktuálně\ncategory: Lidé\ncategoryHref: /lide\ncategorySlug: lide\ntitleCopy: Aktuálně\n---\n# Aktuálně\n'

		test('markdown: a patch carrying only the source refreshes the derived field it never mentions', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/articles/aktualne.md': ARTICLE_FILE })

			const result = await core().updateEntry({
				collection: 'articles',
				slug: 'aktualne',
				frontmatter: { category: 'Aktuálně z nezisku' },
			})

			expect(result.success).toBe(true)
			const written = await read('src/content/articles/aktualne.md')
			expect(written).toContain('categoryHref: /aktualne-z-nezisku')
			expect(written).toContain('categorySlug: aktualne-z-nezisku')
		})

		test('markdown: the recompute reads the merged frontmatter, so an unrelated patch keeps the derived value in step', async () => {
			// `categoryHref` is stale on disk; the merged result is what gets written, so the
			// save that only touches the title still lands a correct derived value.
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/articles/aktualne.md': '---\ntitle: Aktuálně\ncategory: Lidé\ncategoryHref: /zastarale\n---\n',
			})

			const result = await core().updateEntry({ collection: 'articles', slug: 'aktualne', frontmatter: { title: 'Nový titulek' } })

			expect(result.success).toBe(true)
			const written = await read('src/content/articles/aktualne.md')
			expect(written).toContain('categoryHref: /lide')
			expect(written).toContain('titleCopy: Nový titulek')
		})

		test('json: the data branch recomputes on update as well', async () => {
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/products/desk.json': '{\n  "name": "Desk",\n  "line": "Lidé",\n  "lineHref": "/lide"\n}\n',
			})

			const result = await core().updateEntry({ collection: 'products', slug: 'desk', frontmatter: { line: 'Aktuálně z nezisku' } })

			expect(result.success).toBe(true)
			expect(JSON.parse(await read('src/content/products/desk.json')).lineHref).toBe('/aktualne-z-nezisku')
		})

		test('yaml: the data branch recomputes on update as well', async () => {
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/products/chair.yaml': 'name: Chair\nline: Lidé\nlineHref: /lide\n',
			})

			const result = await core().updateEntry({ collection: 'products', slug: 'chair', frontmatter: { line: 'Aktuálně z nezisku' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/products/chair.yaml')).toContain('lineHref: /aktualne-z-nezisku')
		})
	})

	// ------------------------------------------------------------------
	// AC5 — a source that isn't there leaves the derived value alone
	// ------------------------------------------------------------------

	describe('missing or non-string source', () => {
		test('a missing source leaves the stored derived value untouched rather than blanking it', async () => {
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/articles/aktualne.md': '---\ntitle: Aktuálně\ncategoryHref: /rucne-nastaveno\n---\n',
			})

			const result = await core().updateEntry({ collection: 'articles', slug: 'aktualne', frontmatter: { title: 'Nový titulek' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/articles/aktualne.md')).toContain('categoryHref: /rucne-nastaveno')
		})

		test('a non-string source (a number) leaves the derived value untouched', async () => {
			await write({
				'src/content.config.ts': CONFIG,
				'src/content/products/desk.json': '{\n  "name": "Desk",\n  "line": 42,\n  "lineHref": "/rada-42"\n}\n',
			})

			const result = await core().updateEntry({ collection: 'products', slug: 'desk', frontmatter: { name: 'Standing desk' } })

			expect(result.success).toBe(true)
			expect(JSON.parse(await read('src/content/products/desk.json')).lineHref).toBe('/rada-42')
		})

		test('createEntry writes no derived key at all when the source is absent', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({ collection: 'articles', slug: 'bez-rubriky', frontmatter: { title: 'Bez rubriky' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/articles/bez-rubriky.md')).not.toContain('categoryHref')
		})
	})

	// ------------------------------------------------------------------
	// AC6 — the recompute runs before required validation
	// ------------------------------------------------------------------

	describe('ordering against required-field validation', () => {
		test('a required, *visible* derived field passes validation because it was computed first', async () => {
			// `topicHref` is required and `hidden: false`, so `missingRequiredFields` really
			// does check it. The caller never sends it — the recompute fills it in.
			await write({ 'src/content.config.ts': CONFIG })
			const parsed = parseConfigSource(CONFIG).get('notes')!.fields.find(f => f.name === 'topicHref')!
			expect(parsed.required).toBe(true)
			expect(parsed.layout?.hidden).toBe(false)

			const result = await core().createEntry({ collection: 'notes', slug: 'prvni', frontmatter: { title: 'První', topic: 'Lidé' } })

			expect(result.success).toBe(true)
			expect(await read('src/content/notes/prvni.md')).toContain('topicHref: /lide')
		})

		test('a required derived field whose source is missing still fails validation — nothing was computable', async () => {
			await write({ 'src/content.config.ts': CONFIG })

			const result = await core().createEntry({ collection: 'notes', slug: 'prvni', frontmatter: { title: 'První' } })

			expect(result.success).toBe(false)
			expect(result.error).toContain('topic')
		})

		test('updateEntry: blanking the source of a required visible derived field is rejected', async () => {
			await write({ 'src/content.config.ts': CONFIG, 'src/content/notes/prvni.md': '---\ntitle: První\ntopic: Lidé\ntopicHref: /lide\n---\n' })
			const before = await read('src/content/notes/prvni.md')

			const result = await core().updateEntry({ collection: 'notes', slug: 'prvni', frontmatter: { topic: '' } })

			expect(result.success).toBe(false)
			expect(await read('src/content/notes/prvni.md')).toBe(before)
		})
	})
})
