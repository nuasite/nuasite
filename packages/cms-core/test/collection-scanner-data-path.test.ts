import { createCmsCore, createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A data collection (JSON/YAML) declared with a glob loader whose `base` is not
// `<contentDir>/<name>` used to report `path: <contentDir>/<name>` (a directory that need not
// exist) while its entries' `sourcePath` pointed at the real base. These lock `path` to the
// directory that holds the entries, in the spelling the entries' `sourcePath` uses.
describe('scanCollections: `path` of a collection with a custom loader base', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__scanner-data-path-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
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

	const exists = (relative: string): Promise<boolean> => fs.access(path.join(root, relative)).then(() => true, () => false)

	/** A content config declaring one glob-loaded collection per `[key, pattern, base]`. */
	function config(...declared: Array<[key: string, pattern: string, base: string]>): string {
		const lines = declared.map(([key, pattern, base]) => `\t'${key}': defineCollection({ loader: glob({ pattern: '${pattern}', base: '${base}' }) }),`)
		return `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
export const collections = {
${lines.join('\n')}
}
`
	}

	test('a data collection outside the content dir reports its loader base', async () => {
		await write({
			'src/data/team/alice.json': '{"name":"Alice"}',
			'src/data/team/bob.json': '{"name":"Bob"}',
			'src/content.config.ts': config(['team', '*.json', './src/data/team']),
		})

		const collections = await scanCollections(createNodeFs(root))

		const team = collections['team']!
		expect(team.type).toBe('data')
		expect(team.path).toBe(path.join('src/data', 'team'))
		expect(team.entries!.map(e => e.sourcePath).sort()).toEqual([
			path.join('src/data/team', 'alice.json'),
			path.join('src/data/team', 'bob.json'),
		])
		// The default location was never a directory of this project.
		expect(await exists('src/content/team')).toBe(false)
	})

	test('entries nested in subdirectories stay under the reported path', async () => {
		await write({
			'src/data/offices/prague/main.yaml': 'name: Prague\n',
			'src/data/offices/brno/main.yaml': 'name: Brno\n',
			'src/content.config.ts': config(['offices', '**/*.yaml', './src/data/offices']),
		})

		const collections = await scanCollections(createNodeFs(root))

		const offices = collections['offices']!
		expect(offices.path).toBe(path.join('src/data', 'offices'))
		expect(offices.entries!.map(e => e.slug).sort()).toEqual(['brno/main', 'prague/main'])
		for (const entry of offices.entries!) {
			expect(entry.sourcePath.startsWith(offices.path + path.sep)).toBe(true)
		}
	})

	test('a base spelled with `./`, a trailing slash or a `..` segment names the same directory', async () => {
		await write({
			'src/data/plain/a.yml': 'name: A\n',
			'src/data/slash/b.yml': 'name: B\n',
			'src/data/both/c.yml': 'name: C\n',
			'src/data/dotted/d.yml': 'name: D\n',
			'src/content.config.ts': config(
				['plain', '*.yml', 'src/data/plain'],
				['slash', '*.yml', 'src/data/slash/'],
				['both', '*.yml', './src/data/both/'],
				['dotted', '*.yml', './src/content/../data/dotted'],
			),
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(collections['plain']!.path).toBe(path.join('src/data', 'plain'))
		expect(collections['slash']!.path).toBe(path.join('src/data', 'slash'))
		expect(collections['both']!.path).toBe(path.join('src/data', 'both'))
		expect(collections['dotted']!.path).toBe(path.join('src/data', 'dotted'))
		expect(collections['dotted']!.entries!.map(e => e.sourcePath)).toEqual([path.join('src/data/dotted', 'd.yml')])
	})

	test('a markdown collection built from its loader reports the spelling its entries use', async () => {
		await write({
			'src/data/posts/first.md': '---\ntitle: First\n---\n',
			// At the default location, but nested entries only, so the loader scan builds it too.
			'src/content/diary/2026/hello.md': '---\ntitle: Hello\n---\n',
			'src/content.config.ts': config(['posts', '*.md', './src/data/posts/'], ['diary', '**/*.md', './src/content/diary/']),
		})

		const collections = await scanCollections(createNodeFs(root))

		const posts = collections['posts']!
		expect(posts.path).toBe(path.join('src/data', 'posts'))
		expect(posts.entries!.map(e => e.sourcePath)).toEqual([path.join('src/data/posts', 'first.md')])
		expect(collections['diary']!.path).toBe(path.join('src/content', 'diary'))
	})

	test('a data collection sharing its base with a markdown collection reports the shared directory', async () => {
		await write({
			'src/content/jsem/uvod.md': '---\ntitle: Úvod\n---\n',
			'src/content/jsem/fakta/prvni.yaml': 'name: První\n',
			'src/content/jsem/fakta/druhy.yaml': 'name: Druhý\n',
			'src/content.config.ts': config(['jsem', '*.md', './src/content/jsem'], ['jsem-fakta', 'fakta/*.yaml', './src/content/jsem']),
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(Object.keys(collections).sort()).toEqual(['jsem', 'jsem-fakta'])
		const fakta = collections['jsem-fakta']!
		expect(fakta.type).toBe('data')
		expect(fakta.parentCollection).toBe('jsem')
		// The base, not the subdirectory the pattern happens to select and not `src/content/jsem-fakta`.
		expect(fakta.path).toBe(path.join('src/content', 'jsem'))
		expect(fakta.entries!.map(e => e.sourcePath).sort()).toEqual([
			path.join('src/content/jsem', 'fakta/druhy.yaml'),
			path.join('src/content/jsem', 'fakta/prvni.yaml'),
		])
		expect(collections['jsem']!.path).toBe(path.join('src/content', 'jsem'))
	})

	test('a data collection whose base equals the default location is unchanged', async () => {
		await write({
			// Found by the directory scan.
			'src/content/team/alice.json': '{"name":"Alice"}',
			// Nested entries only, so the directory scan finds nothing and the loader scan builds it.
			'src/content/note/2026/hello.yaml': 'title: Hello\n',
			'src/content/memo/2026/hello.yaml': 'title: Hello\n',
			'src/content.config.ts': config(
				['team', '*.json', './src/content/team'],
				['note', '**/*.yaml', './src/content/note'],
				['memo', '**/*.yaml', './src/content/memo/'],
			),
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(collections['team']!.path).toBe(path.join('src/content', 'team'))
		expect(collections['note']!.path).toBe(path.join('src/content', 'note'))
		expect(collections['memo']!.path).toBe(path.join('src/content', 'memo'))
	})

	test('a data directory re-keyed under its config name keeps its path', async () => {
		await write({
			'src/content/hero-slides/first.json': '{"title":"First"}',
			'src/content/hero-slides/cs/druhy.json': '{"title":"Druhý"}',
			'src/content.config.ts': config(
				['heroSlides', '*.json', './src/content/hero-slides'],
				['heroSlidesCs', 'cs/*.json', './src/content/hero-slides'],
			),
		})

		const collections = await scanCollections(createNodeFs(root))

		// `heroSlides` is the scanned directory under its config key; `heroSlidesCs` is a slice of it.
		expect(Object.keys(collections).sort()).toEqual(['heroSlides', 'heroSlidesCs'])
		expect(collections['heroSlides']!.path).toBe(path.join('src/content', 'hero-slides'))
		expect(collections['heroSlides']!.entries!.map(e => e.slug)).toEqual(['first'])
		expect(collections['heroSlidesCs']!.path).toBe(path.join('src/content', 'hero-slides'))
		expect(collections['heroSlidesCs']!.parentCollection).toBe('heroSlides')
	})

	test('two config keys over one outside base stay two collections', async () => {
		await write({
			'src/data/team/alice.json': '{"name":"Alice"}',
			'src/data/team/prague/bob.json': '{"name":"Bob"}',
			'src/content.config.ts': config(['team', '*.json', './src/data/team'], ['teamAll', '**/*.json', './src/data/team']),
		})

		const collections = await scanCollections(createNodeFs(root))

		// Only a directory the content-dir scan covered is re-keyed; a loader-built collection is not.
		expect(Object.keys(collections).sort()).toEqual(['team', 'teamAll'])
		expect(collections['team']!.entries!.map(e => e.slug)).toEqual(['alice'])
		expect(collections['teamAll']!.entries!.map(e => e.slug).sort()).toEqual(['alice', 'prague/bob'])
		expect(collections['team']!.path).toBe(path.join('src/data', 'team'))
		expect(collections['teamAll']!.path).toBe(path.join('src/data', 'team'))
	})

	test('an entry is created, read and deleted in the directory `path` names', async () => {
		await write({
			'src/data/team/alice.json': '{"name":"Alice"}',
			'src/content.config.ts': config(['team', '*.json', './src/data/team']),
		})
		const core = createCmsCore(createNodeFs(root))

		const created = await core.createEntry({ collection: 'team', slug: 'bob', frontmatter: { name: 'Bob' }, fileExtension: 'json' })
		expect(created.success).toBe(true)

		const team = (await core.scanCollections())['team']!
		expect(created.sourcePath).toBe(path.join(team.path, 'bob.json'))
		expect(await exists('src/data/team/bob.json')).toBe(true)
		expect(team.entries!.map(e => e.slug).sort()).toEqual(['alice', 'bob'])
		expect((await core.getEntry('team', 'bob'))?.frontmatter).toEqual({ name: 'Bob' })

		expect((await core.deleteEntry('team', 'bob')).success).toBe(true)
		expect(await exists('src/data/team/bob.json')).toBe(false)
		// Nothing was written to the default location on the way.
		expect(await exists('src/content/team')).toBe(false)
	})

	test('a base spelled with a `..` segment reads and writes where the scan reports it', async () => {
		await write({
			'src/data/team/alice.json': '{"name":"Alice"}',
			'src/content.config.ts': config(['team', '*.json', './src/content/../data/team/']),
		})
		const core = createCmsCore(createNodeFs(root))

		const created = await core.createEntry({ collection: 'team', slug: 'bob', frontmatter: { name: 'Bob' }, fileExtension: 'json' })
		expect(created.success).toBe(true)

		const team = (await core.scanCollections())['team']!
		expect(created.sourcePath).toBe(path.join(team.path, 'bob.json'))
		expect((await core.getEntry('team', 'alice'))?.sourcePath).toBe(path.join(team.path, 'alice.json'))
	})

	test('a collection based at the project root writes there, not into the content dir', async () => {
		await write({
			'alice.json': '{"name":"Alice"}',
			'src/content.config.ts': config(['team', '*.json', './']),
		})
		const core = createCmsCore(createNodeFs(root))

		const before = (await core.scanCollections())['team']!
		expect(before.path).toBe('.')
		expect(before.entries!.map(e => e.sourcePath)).toEqual(['alice.json'])

		const created = await core.createEntry({ collection: 'team', slug: 'bob', frontmatter: { name: 'Bob' }, fileExtension: 'json' })
		expect(created.success).toBe(true)
		expect(created.sourcePath).toBe('bob.json')
		expect(await exists('bob.json')).toBe(true)
		expect(await exists('src/content/team')).toBe(false)
		expect((await core.getEntry('team', 'bob'))?.frontmatter).toEqual({ name: 'Bob' })
	})
})
