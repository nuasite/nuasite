import { createCmsCore, createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A glob-loaded collection the config declares but whose folder is empty or missing used to be
// left out of the scan, so an editor could neither list it nor create its first entry there.
describe('scanCollections: a declared glob collection with no entries', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__scanner-empty-glob-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	const read = (relative: string): Promise<string> => fs.readFile(path.join(root, relative), 'utf-8')
	const nodeFs = () => createNodeFs(root)

	/** A content config declaring one glob-loaded collection with a `title` schema per `[key, pattern, base]`. */
	function config(...declared: Array<[key: string, pattern: string, base: string]>): string {
		const lines = declared.map(([key, pattern, base]) =>
			`\t'${key}': defineCollection({ loader: glob({ pattern: '${pattern}', base: '${base}' }), schema: z.object({ title: z.string() }) }),`
		)
		return `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
export const collections = {
${lines.join('\n')}
}
`
	}

	test('an empty folder is listed with its declared fields', async () => {
		await fs.mkdir(path.join(root, 'src/content/news'), { recursive: true })
		await write({ 'src/content.config.ts': config(['news', '**/*.md', './src/content/news']) })

		const news = (await scanCollections(nodeFs()))['news']!

		expect(news).toBeDefined()
		expect(news.entryCount).toBe(0)
		expect(news.entries).toEqual([])
		expect(news.path).toBe(path.join('src/content', 'news'))
		expect(news.fileExtension).toBe('md')
		expect(news.type).toBeUndefined()
		expect(news.fields.map(field => field.name)).toEqual(['title'])
	})

	test('a missing folder is listed too, at the loader base', async () => {
		await write({ 'src/content.config.ts': config(['team', '*.json', './src/data/team']) })

		const team = (await scanCollections(nodeFs()))['team']!

		expect(team.entryCount).toBe(0)
		expect(team.path).toBe(path.join('src/data', 'team'))
		expect(team.type).toBe('data')
		expect(team.fileExtension).toBe('json')
	})

	test('the file extension comes from the pattern', async () => {
		await write({
			'src/content.config.ts': config(
				['guides', '*.mdx', './src/content/guides'],
				['offices', '**/*.{yml,yaml}', './src/data/offices'],
				['anything', '**/*', './src/content/anything'],
			),
		})

		const collections = await scanCollections(nodeFs())

		expect(collections['guides']!.fileExtension).toBe('mdx')
		expect(collections['offices']!.fileExtension).toBe('yaml')
		expect(collections['offices']!.type).toBe('data')
		expect(collections['anything']!.fileExtension).toBe('md')
	})

	test('the first entry is created in the configured folder and then listed', async () => {
		await write({ 'src/content.config.ts': config(['news', '**/*.md', './src/data/news'], ['team', '*.json', './src/data/team']) })
		const core = createCmsCore(nodeFs())
		const before = await core.scanCollections()

		const news = await core.createEntry({
			collection: 'news',
			slug: 'first',
			frontmatter: { title: 'First' },
			fileExtension: before['news']!.fileExtension,
		})
		const team = await core.createEntry({
			collection: 'team',
			slug: 'alice',
			frontmatter: { title: 'Alice' },
			fileExtension: before['team']!.fileExtension,
		})

		expect(news).toEqual({ success: true, sourcePath: 'src/data/news/first.md' })
		expect(team).toEqual({ success: true, sourcePath: 'src/data/team/alice.json' })
		expect(await read('src/data/team/alice.json')).toBe('{\n  "title": "Alice"\n}\n')
		const after = await core.scanCollections()
		expect(after['news']!.entries!.map(entry => entry.sourcePath)).toEqual([path.join('src/data/news', 'first.md')])
		expect(after['team']!.entries!.map(entry => entry.slug)).toEqual(['alice'])
	})

	test('an index-style pattern puts the first entry in its own folder', async () => {
		await write({ 'src/content.config.ts': config(['docs', '*/index.md', './src/content/docs']) })
		const core = createCmsCore(nodeFs())
		const docs = (await core.scanCollections())['docs']!

		const result = await core.createEntry({ collection: 'docs', slug: 'intro', frontmatter: { title: 'Intro' }, fileExtension: docs.fileExtension })

		expect(result).toEqual({ success: true, sourcePath: 'src/content/docs/intro/index.md' })
	})

	test('files on the base the pattern does not load do not set the layout of the first entry', async () => {
		await write({
			// `pages` owns the flat files of the shared base; `guides` is empty and index-style.
			'src/data/docs/a.md': '---\ntitle: A\n---\n',
			'src/data/docs/README.md': '# Docs\n',
			'src/content.config.ts': config(['pages', 'a*.md', './src/data/docs'], ['guides', '*/index.md', './src/data/docs']),
		})
		const core = createCmsCore(nodeFs())
		const guides = (await core.scanCollections())['guides']!
		expect(guides.entryCount).toBe(0)

		const result = await core.createEntry({ collection: 'guides', slug: 'intro', frontmatter: { title: 'Intro' }, fileExtension: guides.fileExtension })

		expect(result).toEqual({ success: true, sourcePath: 'src/data/docs/intro/index.md' })
		const after = await core.scanCollections()
		expect(after['guides']!.entries!.map(entry => entry.sourcePath)).toEqual([path.join('src/data/docs', 'intro', 'index.md')])
		expect(after['pages']!.entryCount).toBe(1)
	})

	test('a collection with entries scans as before', async () => {
		await write({
			'src/content/blog/a.md': '---\ntitle: A\n---\n',
			'src/content/blog/b.md': '---\ntitle: B\n---\n',
			'src/data/team/alice.yaml': 'title: Alice\n',
			'src/content.config.ts': config(['blog', '**/*.md', './src/content/blog'], ['team', '*.yaml', './src/data/team']),
		})

		const collections = await scanCollections(nodeFs())

		expect(collections['blog']!.entryCount).toBe(2)
		expect(collections['blog']!.entries!.map(entry => entry.slug)).toEqual(['a', 'b'])
		expect(collections['blog']!.fileExtension).toBe('md')
		expect(collections['team']!.entryCount).toBe(1)
		expect(collections['team']!.fileExtension).toBe('yaml')
		expect(collections['team']!.type).toBe('data')
	})

	test('a pattern no entry the editor writes would match is not listed', async () => {
		await write({
			'src/content.config.ts': config(['settings', '*.toml', './src/data/settings'], ['negated', '!**/*.md', './src/data/negated']),
		})

		const collections = await scanCollections(nodeFs())

		expect(collections['settings']).toBeUndefined()
		expect(collections['negated']).toBeUndefined()
	})

	test('a pattern that would not load the created entry is not listed', async () => {
		await write({
			'src/content/jsem/index.md': '---\ntitle: Jsem\n---\n',
			'src/content.config.ts': config(
				// Shares its base with `jsem`: an entry created at the base would become a `jsem` entry.
				['jsem-otazky', 'otazky/*.md', './src/content/jsem'],
				['faq', 'faq-*.md', './src/data/faq'],
				['english', '**/*.en.md', './src/data/english'],
				['upper', '*.MD', './src/data/upper'],
				['one-name', 'e*.md', './src/data/one-name'],
				['spaced', ' **/*.md', './src/data/spaced'],
			),
		})

		const collections = await scanCollections(nodeFs())

		expect(collections['jsem']!.entryCount).toBe(1)
		for (const name of ['jsem-otazky', 'faq', 'english', 'upper', 'one-name', 'spaced']) expect(collections[name]).toBeUndefined()
	})

	test('a pattern the scan cannot run is not listed as empty', async () => {
		// The port reads `[^_]` literally, so it matches none of the files Astro loads here.
		await write({
			'src/data/posts/hello.md': '---\ntitle: Hello\n---\n',
			'src/content.config.ts': config(['posts', '**/[^_]*.md', './src/data/posts']),
		})

		expect((await scanCollections(nodeFs()))['posts']).toBeUndefined()
	})
})
