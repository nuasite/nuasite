import {
	type CmsFileSystem,
	collectionScanReport,
	createCmsCore,
	createNodeFs,
	type ParseCache,
	parseContentConfig,
	readContentConfig,
	scanCollections,
} from '@nuasite/cms-core'
import type { CollectionDefinition, CollectionScanReport, UnresolvedCollection } from '@nuasite/cms-types'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// A scan used to answer with the collections it could read and say nothing about the rest:
// a declared collection it could not follow, or whose read threw, was simply not in the map,
// and one read from a content directory of its name was taken on trust. The report next to a
// scan names the ones it cannot vouch for. Each case below pins both halves: what the scan
// returns (unchanged) and what the report says about it.
describe('scanCollections — scan report', () => {
	let root: string
	let warn: ReturnType<typeof spyOn>

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__scan-report-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
		// A skipped collection is still logged; keep the expected warnings out of the test output.
		warn = spyOn(console, 'warn').mockImplementation(() => {})
	})

	afterEach(async () => {
		warn.mockRestore()
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

	const IMPORTS = `import { defineCollection } from 'astro:content'
import { file, glob } from 'astro/loaders'
import { z } from 'astro/zod'
`

	/** A content config whose `collections` export is the given object-literal body. */
	function config(collections: string, preamble = ''): string {
		return `${IMPORTS}${preamble}\nexport const collections = { ${collections} }\n`
	}

	/** `defineCollection({ loader: glob({ base, pattern }) })` */
	function globLoaded(base: string, pattern: string): string {
		return `defineCollection({ loader: glob({ base: ${JSON.stringify(base)}, pattern: ${JSON.stringify(pattern)} }) })`
	}

	/** `name: defineCollection({ loader: glob({ base, pattern }) })` */
	function globbed(name: string, base: string, pattern: string): string {
		return `${JSON.stringify(name)}: ${globLoaded(base, pattern)}`
	}

	async function scan(
		over: CmsFileSystem = createNodeFs(root),
		contentDir?: string,
	): Promise<{ collections: Record<string, CollectionDefinition>; report: CollectionScanReport }> {
		const collections = await scanCollections(over, contentDir, undefined, { report: true })
		const report = collectionScanReport(collections)
		if (!report) throw new Error('the scan returned no report')
		return { collections, report }
	}

	/** The source files each scanned collection lists, for a result that should not have changed. */
	function listed(collections: Record<string, CollectionDefinition>): Record<string, string[]> {
		return Object.fromEntries(Object.values(collections).map(c => [c.name, c.entries!.map(e => e.sourcePath).sort()]))
	}

	const ENTRY = '---\ntitle: Entry\n---\n'
	const BROKEN_ENTRY = '---\ntitle: [unclosed\n---\n'
	const NOTHING: CollectionScanReport = { contentConfig: 'ok', unresolved: [] }

	describe('a site the scan reads whole reports nothing', () => {
		test('the usual shapes', async () => {
			await write({
				// Declared without a loader, read from its content directory.
				'src/content/blog/first.md': ENTRY,
				// Not declared at all; the directory walk lists it.
				'src/content/team/alice.json': '{ "name": "Alice" }',
				// Declared with a glob loader outside the content directory, nested files included.
				'data/news/one.md': ENTRY,
				'data/news/2024/two.md': ENTRY,
				// Declared under a key that differs from its directory, with a child collection inside it.
				'src/content/hero-slides/first.md': ENTRY,
				'src/content/hero-slides/notes/a.md': ENTRY,
				// Bundles: an entry per directory, each with an asset the pattern does not select.
				'src/content/cases/one/index.md': ENTRY,
				'src/content/cases/one/cover.jpg': 'jpg',
				// Loaded from the project root by a pattern that says where.
				'data/site/home.md': ENTRY,
				'src/content.config.ts': config(`
					blog: defineCollection({ schema: z.object({ title: z.string() }) }),
					${globbed('news', './data/news', '**/*.md')},
					${globbed('heroSlides', './src/content/hero-slides', '*.md')},
					${globbed('slideNotes', './src/content/hero-slides', 'notes/*.md')},
					${globbed('cases', './src/content/cases', '*/index.{md,mdx}')},
					${globbed('site', '.', 'data/site/*.md')},
				`),
			})

			const { collections, report } = await scan()

			expect(Object.keys(collections).sort()).toEqual(['blog', 'cases', 'heroSlides', 'news', 'site', 'slideNotes', 'team'])
			expect(report).toEqual(NOTHING)
		})

		test('files a pattern matches that are not entries: an image, a dotfile', async () => {
			await write({
				'data/blog/one.md': ENTRY,
				'data/blog/cover.jpg': 'jpg',
				'data/blog/.hidden.md': ENTRY,
				'data/blog/.obsidian/workspace.json': '{}',
				'src/content.config.ts': config(globbed('blog', './data/blog', '**/*')),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ blog: ['data/blog/one.md'] })
			expect(report).toEqual(NOTHING)
		})

		test('a pattern the scan cannot run, when every entry file under its base is listed anyway', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				'src/content/posts/a.md': ENTRY,
				'src/content/posts/b.md': ENTRY,
				// Astro's own idiom for leaving `_` files out, in the default location and under another key.
				'src/content.config.ts': config(`
					${globbed('blog', './src/content/blog', '**/[^_]*.md')},
					${globbed('blogPosts', './src/content/posts', '**/[^_]*.md')},
				`),
			})

			const { collections, report } = await scan()

			// `blogPosts` is not a scanned name: the walk lists its files as `posts`. They are listed all the same.
			expect(listed(collections)).toEqual({
				blog: ['src/content/blog/first.md'],
				posts: ['src/content/posts/a.md', 'src/content/posts/b.md'],
			})
			expect(report).toEqual(NOTHING)
		})

		test('one declaration under two keys, listed once', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				'src/content.config.ts': `${IMPORTS}const posts = ${globLoaded('./src/content/blog', '*.md')}
export const collections = { blog: posts, news: posts }
`,
			})

			expect((await scan()).report).toEqual(NOTHING)
		})
	})

	test('the report rides next to the scan result, not inside it', async () => {
		await write({
			'src/content/blog/first.md': ENTRY,
			'src/content.config.ts': config(`authors: defineCollection({ loader: file('data/authors.json') })`),
		})

		const collections = await scanCollections(createNodeFs(root), undefined, undefined, { report: true })

		// What every existing caller reads is what it always was: definitions keyed by name.
		expect(Object.keys(collections)).toEqual(['blog'])
		expect(JSON.stringify(collections)).not.toContain('authors')
		// The report belongs to that one record: a copy has none, which reads as "not reported".
		expect(collectionScanReport(collections)?.unresolved.map(u => u.name)).toEqual(['authors'])
		expect(collectionScanReport({ ...collections })).toBeUndefined()
		// A scan that was not asked for one has none either, and does no listing for it.
		const nodeFs = createNodeFs(root)
		const glob = spyOn(nodeFs, 'glob')
		expect(collectionScanReport(await scanCollections(nodeFs))).toBeUndefined()
		expect(glob).not.toHaveBeenCalled()
		// A core hands out the same report for what its own scan returned.
		const core = createCmsCore(createNodeFs(root))
		expect(core.collectionScanReport?.(await core.scanCollections())?.unresolved.map(u => u.name)).toEqual(['authors'])
	})

	test('a report that cannot be built does not fail the scan', async () => {
		await write({ 'src/content/blog/first.md': ENTRY })
		const nodeFs = createNodeFs(root)
		// Only the report asks whether a file exists here: there is no config and no subdirectory.
		const failing: CmsFileSystem = { ...nodeFs, exists: () => Promise.reject(new Error('EIO')) }

		const collections = await scanCollections(failing, undefined, undefined, { report: true })

		expect(Object.keys(collections)).toEqual(['blog'])
		expect(collectionScanReport(collections)).toBeUndefined()
	})

	describe('unsupported loader: the scan cannot tell what the collection loads', () => {
		test('a loader it cannot follow is listed with whatever location is a literal', async () => {
			await write({
				'data/authors.json': '[{ "id": "jane" }]',
				'data/posts/one.md': ENTRY,
				'src/content.config.ts': config(
					`
					authors: defineCollection({ loader: file('./data/authors.json'), schema: z.object({ id: z.string() }) }),
					feed: defineCollection({ loader: feedLoader({ base: './data/posts', pattern: '*.md' }) }),
					remote: defineCollection({ loader: remoteLoader('https://example.com/feed') }),
					fetched: defineCollection({ loader: fetchLoader({ pattern: 'data/posts/*.md' }) }),
					keyed: defineCollection({ [loaderKey]: glob({ base: './data/posts', pattern: '*.md' }) }),
					optioned: defineCollection({ loader: glob({ [baseKey]: './data/posts', pattern: '*.md' }) }),
					posts: defineCollection({ loader: glob({ base: postsDir(), pattern: '**/*.md' }) }),
					notes: defineCollection({ loader: glob({ base: './data/posts', pattern: patterns.notes }) }),
					pages: makeCollection({ loader: glob({ base: './data/posts', pattern: '*.md' }) }),
					products,
					shop: defineCollection({ ...shopOptions }),
					anything: defineCollection({ loader: glob({ base: './', pattern: ['**/*.md', '!node_modules/**'] }) }),
					classed: defineCollection({ loader: glob({ pattern: 'data/[a-z]*/*.md' }) }),
					method: defineCollection({ loader() { return [] } }),
					accessor: defineCollection({ get loader() { return feedLoader() } }),
				`,
					`import { products } from './products'`,
				),
			})

			const nodeFs = createNodeFs(root)
			const glob = spyOn(nodeFs, 'glob')
			const { collections, report } = await scan(nodeFs)

			expect(collections).toEqual({})
			expect(glob.mock.calls.map(([pattern]) => pattern)).not.toContain('**/*')
			expect(report).toEqual({
				contentConfig: 'ok',
				unresolved: [
					// A loader written as a method or an accessor is a loader, not the lack of one.
					{ name: 'accessor', reason: 'unsupported-loader' },
					// Patterns the scan cannot run, over the project root: the whole project is not walked to find out.
					{ name: 'anything', reason: 'unsupported-loader', base: '.' },
					{ name: 'authors', reason: 'unsupported-loader', file: 'data/authors.json' },
					{ name: 'classed', reason: 'unsupported-loader', base: '.', pattern: 'data/[a-z]*/*.md' },
					// Any other call is a custom loader, whatever it is handed.
					{ name: 'feed', reason: 'unsupported-loader' },
					{ name: 'fetched', reason: 'unsupported-loader' },
					// A computed key may be `loader` or `base` as well as anything else, unless it is a string.
					{ name: 'keyed', reason: 'unsupported-loader' },
					{ name: 'method', reason: 'unsupported-loader' },
					// The pattern is unknown, so `data/posts/one.md` may be its entry, and it is not listed.
					{ name: 'notes', reason: 'unsupported-loader', base: 'data/posts' },
					{ name: 'optioned', reason: 'unsupported-loader' },
					// A helper may do anything with the options it is handed.
					{ name: 'pages', reason: 'unsupported-loader' },
					{ name: 'posts', reason: 'unsupported-loader', pattern: '**/*.md' },
					{ name: 'products', reason: 'unsupported-loader' },
					{ name: 'remote', reason: 'unsupported-loader' },
					// A spread may carry a loader in, so this is not taken for a declaration without one.
					{ name: 'shop', reason: 'unsupported-loader' },
				],
			})
		})

		test('a content directory of the declared name does not vouch for it', async () => {
			await write({
				'src/content/team/alice.json': '{ "name": "Alice" }',
				'src/content/authors/readme.md': ENTRY,
				'data/authors.json': '[{ "id": "jane" }]',
				'src/content.config.ts': config(`
					team: defineCollection({ loader: teamLoader() }),
					authors: defineCollection({ loader: file('data/authors.json') }),
				`),
			})

			const { collections, report } = await scan()

			// Both are scanned, from the directory. What their loaders load is another matter.
			expect(Object.keys(collections).sort()).toEqual(['authors', 'team'])
			expect(report.unresolved).toEqual([
				{ name: 'authors', reason: 'unsupported-loader', file: 'data/authors.json' },
				{ name: 'team', reason: 'unsupported-loader' },
			])
		})

		test('a literal that a spread may replace is not a literal', async () => {
			await write({
				'data/stale/only.md': ENTRY,
				'data/docs/a.md': ENTRY,
				'src/content.config.ts': config(
					`
					docs: defineCollection({ loader: glob({ base: './data/stale', pattern: '*.md', ...docsOptions }) }),
					guides: defineCollection({ loader: glob({ base: './data/stale', pattern: '*.md' }), ...shared }),
					later: defineCollection({ ...shared, loader: glob({ base: './data/docs', pattern: '*.md' }) }),
				`,
					`const docsOptions = { base: './data/docs' }\nconst shared = { loader: glob({ base: './data/docs', pattern: '*.md' }) }`,
				),
			})

			const { collections, report } = await scan()

			// The scan itself still goes by the literals, as before.
			expect(listed(collections)).toEqual({ docs: ['data/stale/only.md'], guides: ['data/stale/only.md'], later: ['data/docs/a.md'] })
			// A loader named after a spread is the one that counts, so `later` is vouched for.
			expect(report.unresolved).toEqual([
				{ name: 'docs', reason: 'unsupported-loader' },
				{ name: 'guides', reason: 'unsupported-loader' },
			])
		})

		test.each([
			['a character class', '**/[^_]*.md'],
			['an extglob', '**/*.+(md|mdx)'],
			['a negated extglob', '!(draft).md'],
			['an escape', '**/*\\.md'],
			['a brace inside a brace', '**/*.{md,{mdx,markdown}}'],
			['a brace range', '{1..2}/*.md'],
			['a wildcard inside a brace', '{on*,tw*}.md'],
			['a trailing slash', '**/*.md/'],
			['a file wildcard followed by a final globstar', '*.md/**'],
			['a negation behind ./', './!draft.md'],
			['an empty brace alternative', '*.md/{,x}'],
			['a final globstar behind a dot segment', '*.md/**/.'],
		])('a pattern with %s matches nothing here and is not taken for an empty collection', async (_label, pattern) => {
			await write({
				'data/blog/one.md': ENTRY,
				'data/blog/1/two.md': ENTRY,
				'src/content.config.ts': config(globbed('blog', './data/blog', pattern)),
			})

			const { collections, report } = await scan()

			expect(collections).toEqual({})
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unsupported-loader', base: 'data/blog', pattern }])
		})

		test('a brace without a comma is a name to Astro, and the file it names is not what the scan lists', async () => {
			await write({
				'data/blog/one.md': ENTRY,
				'data/blog/{one}.md': ENTRY,
				'src/content.config.ts': config(globbed('blog', './data/blog', '{one}.md')),
			})

			const { collections, report } = await scan()

			// The port takes the brace for a list of one.
			expect(listed(collections)).toEqual({ blog: ['data/blog/one.md'] })
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unsupported-loader', base: 'data/blog', pattern: '{one}.md' }])
		})

		test('such a pattern over a content directory is not vouched for when a file under it is not listed', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				// The walk reads `<slug>.md` and `<slug>/index.md`; whether the pattern selects this one is unknown.
				'src/content/blog/2024/second.md': ENTRY,
				'src/content.config.ts': config(globbed('blog', './src/content/blog', '**/[^_]*.md')),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ blog: ['src/content/blog/first.md'] })
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unsupported-loader', base: 'src/content/blog', pattern: '**/[^_]*.md' }])
		})

		test('a wildcard inside a brace that the scan half-runs is not vouched for either', async () => {
			await write({
				'data/blog/one.md': ENTRY,
				'data/blog/two.mdx': ENTRY,
				// A key in quotes and brackets is still that key: this one is read and vouched for.
				'data/posts/one.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('blog', './data/blog', '*.{md,md?}')},
					posts: defineCollection({ ['loader']: glob({ ['base']: './data/posts', pattern: '*.md' }) }),
				`),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ blog: ['data/blog/one.md'], posts: ['data/posts/one.md'] })
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unsupported-loader', base: 'data/blog', pattern: '*.{md,md?}' }])
		})

		test('a pattern that leads out of its base is not bounded by it', async () => {
			await write({
				'data/blog/one.md': ENTRY,
				'data/other/two.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('blog', './data/blog', '../blog/*.md')},
					other: defineCollection({ loader: glob({ base: './data/blog', pattern: '../other/' + star }) }),
					holed: defineCollection({ loader: glob({ base: './data/blog', pattern: ['*.md', more] }) }),
					braced: defineCollection({ loader: glob({ base: './data/blog', pattern: '..{/blog,x}/*.md' }) }),
					alternative: defineCollection({ loader: glob({ base: './data/blog', pattern: '{a,..}/blog/*.md' }) }),
					later: defineCollection({ loader: glob({ base: './data/blog', pattern: ['*.md', '../blog/*.md'] }) }),
				`),
			})

			const nodeFs = createNodeFs(root)
			const glob = spyOn(nodeFs, 'glob')
			const { collections, report } = await scan(nodeFs)

			// The scan joins base and pattern and lists `blog`, as before. The report does not
			// take the files under the base for all there is to check.
			expect(listed(collections)).toEqual({ blog: ['data/blog/one.md'] })
			expect(glob.mock.calls.filter(([, options]) => options?.followSymlinks)).toEqual([])
			expect(report.unresolved).toEqual([
				// A brace next to the dots may be what makes them a segment.
				{ name: 'alternative', reason: 'unsupported-loader', base: 'data/blog', pattern: '{a,..}/blog/*.md' },
				{ name: 'blog', reason: 'unsupported-loader', base: 'data/blog', pattern: '../blog/*.md' },
				{ name: 'braced', reason: 'unsupported-loader', base: 'data/blog', pattern: '..{/blog,x}/*.md' },
				// A pattern that cannot be read may lead out of the base just the same, and one
				// unread member of a list is enough.
				{ name: 'holed', reason: 'unsupported-loader', base: 'data/blog' },
				// Every pattern of a list is looked at, not only the first.
				{ name: 'later', reason: 'unsupported-loader', base: 'data/blog' },
				{ name: 'other', reason: 'unsupported-loader', base: 'data/blog' },
			])
		})

		// Astro resolves `base` as a URL against the project root. None of these is the relative
		// directory it spells, so looking there and finding nothing would prove nothing.
		test.each([
			['an absolute path', '/srv/site/data/blog'],
			['a file URL', 'file:///srv/site/data/blog/'],
			['a percent escape', './data/my%20posts'],
			['a query', './data/blog?draft'],
			['a fragment', './data/blog#old'],
			['a brace', './data/{en,cs}'],
			['an opening brace', './data/{en'],
			['a closing brace', './data/en}'],
			['a wildcard', './data/*'],
			['a question mark', './data/blo?'],
			['a backslash', '.\\data\\blog'],
			['a leading space', ' ./data/blog'],
			['a trailing space', './data/blog '],
			['a tab', './data/\tblog'],
			['a line break', './data/blog\n'],
		])('a base with %s is not looked under', async (_label, base) => {
			await write({ 'data/blog/one.md': ENTRY, 'src/content.config.ts': config(globbed('blog', base, '*.md')) })

			const nodeFs = createNodeFs(root)
			const glob = spyOn(nodeFs, 'glob')
			const { report } = await scan(nodeFs)

			// Once by the scan, as before, and not again by the report.
			expect(glob.mock.calls.filter(([, options]) => options?.followSymlinks)).toEqual([])
			expect(report.unresolved.map(u => [u.name, u.reason])).toEqual([['blog', 'unsupported-loader']])
		})

		// Spellings Astro's URL reading and the scan's path reading resolve to one directory.
		test.each([
			['no leading dot', 'data/blog'],
			['a trailing slash', './data/blog/'],
			['a doubled slash', './data//blog'],
			['a dot segment', './data/./blog'],
			['a segment taken back', './data/old/../blog'],
		])('a base with %s is looked under', async (_label, base) => {
			await write({ 'data/blog/one.md': ENTRY, 'src/content.config.ts': config(globbed('blog', base, '*.md')) })

			const nodeFs = createNodeFs(root)
			const glob = spyOn(nodeFs, 'glob')
			const { collections, report } = await scan(nodeFs)

			expect(listed(collections)).toEqual({ blog: ['data/blog/one.md'] })
			expect(glob.mock.calls.filter(([, options]) => options?.followSymlinks).map(([pattern]) => pattern)).toEqual(['data/blog/*.md'])
			expect(report).toEqual({ contentConfig: 'ok', unresolved: [] })
		})

		test('a dot directory named by a pattern the scan cannot run or read is still a candidate', async () => {
			await write({
				'data/wk/.config/a.json': '{ "title": "A" }',
				'data/site/.config/a.json': '{ "title": "A" }',
				'data/other/.cache/a.json': '{ "title": "A" }',
				'data/list/.config/a.json': '{ "title": "A" }',
				'data/plain/.cache/a.json': '{ "title": "A" }',
				'src/content.config.ts': config(`
					list: defineCollection({ loader: glob({ base: './data/list', pattern: ['*.json', '.config/*.json'] }) }),
					plain: defineCollection({ loader: glob({ base: './data/plain', pattern: ['*.json', '!draft.json'] }) }),
					${globbed('wk', './data/wk', '.config/[a-z]*.json')},
					site: defineCollection({ loader: glob({ base: './data/site', pattern: segments.join('/') }) }),
					${globbed('other', './data/other', '[a-z]*.json')},
				`),
			})

			const { collections, report } = await scan()

			expect(collections).toEqual({})
			// `other` and `plain` name no dot segment, so a dot directory is not what Astro's glob
			// would match for them. `list` names one in a list of patterns, which is read though it
			// is not run. What `site` names cannot be read at all.
			expect(report.unresolved).toEqual([
				{ name: 'list', reason: 'unsupported-loader', base: 'data/list' },
				{ name: 'site', reason: 'unsupported-loader', base: 'data/site' },
				{ name: 'wk', reason: 'unsupported-loader', base: 'data/wk', pattern: '.config/[a-z]*.json' },
			])
		})
	})

	// Astro's glob keeps `*` and `**` from matching a leading dot. A character class or an
	// extglob matches one like any other character: in the last segment a dotfile, in an
	// earlier one a dot directory. The scan runs neither, so what they may take is a candidate.
	const DOT_PATHS: Array<[label: string, pattern: string | string[], files: string[], reported: boolean]> = [
		["the docs' idiom over a dotfile in a subdirectory", '**/[^_]*.md', ['guide/index.md', 'guide/.wip.md'], true],
		['the same with a brace of extensions', '**/[^_]*.{md,mdx}', ['guide/index.md', 'guide/.wip.mdx'], true],
		['the same in a list of patterns', ['**/[^_]*.md', '!**/drafts/**'], ['guide/index.md', 'guide/.wip.md'], true],
		['a negated extglob over a dotfile', '**/!(_*).md', ['guide/index.md', 'guide/.wip.md'], true],
		['a class in the last segment and a dot directory: not loaded', '**/[^_]*.md', ['.obsidian/note.md', '.obsidian/.x.md'], false],
		['a class in a directory segment over a dot directory', '[^_]*/**/*.md', ['.hid/h.md'], true],
		['a class in a directory segment and a dotfile: not loaded', '[^_]*/*.md', ['guide/index.md', 'guide/.wip.md'], false],
		['an extglob in a directory segment over a dot directory', '!(_*)/*.md', ['.hid/h.md'], true],
		['a class in a brace that spans a slash, over a dot directory', '{[^_]*/,}*.md', ['.hid/h.md'], true],
		['a class in a brace that spans a slash, over a dotfile', '{[^_]*.md,sub/index.md}', ['guide/index.md', 'guide/.wip.md'], true],
		['an escaped dot', 'guide/\\.wip.md', ['guide/index.md', 'guide/.wip.md'], true],
		['a dot in a class', '{*,[.]hid/*}.md', ['.hid/h.md'], true],
		['a dot in an extglob', '@(.hid|x)/*.md', ['.hid/h.md'], true],
		['a pattern the scan runs over a dotfile: not loaded', '**/*.md', ['guide/index.md', 'guide/.wip.md'], false],
	]
	test.each(DOT_PATHS)('dot paths under %s', async (_label, pattern, files, reported) => {
		await write({
			'src/content/blog/a.md': ENTRY,
			...Object.fromEntries(files.map(file => [`src/content/blog/${file}`, ENTRY])),
			'src/content.config.ts': config(`blog: defineCollection({ loader: glob({ base: './src/content/blog', pattern: ${JSON.stringify(pattern)} }) })`),
		})

		const { collections, report } = await scan()

		// The directory walk reads `a.md` and `guide/index.md`, and nothing that starts with a dot below the top.
		expect(listed(collections)['blog']!.filter(file => file.includes('/.'))).toEqual([])
		expect(report.unresolved.map(u => [u.name, u.reason])).toEqual(reported ? [['blog', 'unsupported-loader']] : [])
	})

	describe('unlisted entries: files the collection loads are not entries of the scan', () => {
		test('a data collection with no parsable file stays listed, empty, and is reported', async () => {
			await write({ 'src/content/team/alice.json': '{ nope', 'src/content/team/bob.yaml': 'name: [unclosed' })

			const { collections, report } = await scan()

			expect(collections['team']).toMatchObject({ entryCount: 2, entries: [] })
			expect(report.unresolved).toEqual([{ name: 'team', reason: 'unlisted-entries', base: 'src/content/team' }])
		})

		test('a collection that lost some of its entries is reported too', async () => {
			await write({
				'data/team/alice.json': '{ "name": "Alice" }',
				'data/team/bob.json': '{ nope',
				'src/content.config.ts': config(globbed('team', './data/team', '*.json')),
			})

			const { collections, report } = await scan()

			expect(collections['team']!.entryCount).toBe(2)
			expect(collections['team']!.entries!.map(e => e.slug)).toEqual(['alice'])
			expect(report.unresolved).toEqual([{ name: 'team', reason: 'unlisted-entries', base: 'data/team', pattern: '*.json' }])
		})

		test('a markdown file that cannot be read is a lost entry, not a failed scan', async () => {
			await write({ 'src/content/blog/first.md': ENTRY, 'src/content/blog/second.md': ENTRY })
			const nodeFs = createNodeFs(root)
			const unreadable: CmsFileSystem = {
				...nodeFs,
				readFile: file => file.endsWith('second.md') ? Promise.reject(new Error('EACCES')) : nodeFs.readFile(file),
			}

			const { collections, report } = await scan(unreadable)

			expect(collections['blog']!.entries!.map(e => e.slug)).toEqual(['first'])
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unlisted-entries', base: 'src/content/blog' }])
		})

		// The walk of a content directory reads `<slug>.<ext>` and `<slug>/index.<ext>`, markdown
		// before data. A loader that selects more is answered by the walk all the same.
		const WALKED: Array<[label: string, pattern: string, files: Record<string, string>, read: string[]]> = [
			['files nested deeper than the walk reads', '**/*.md', { 'a.md': ENTRY, 'guide/intro.md': ENTRY, 'guide/deep/x.md': ENTRY }, ['a.md']],
			['a sibling of an index file', '**/*.md', { 'a/index.md': ENTRY, 'a/more.md': ENTRY }, ['a/index.md']],
			['an index file behind a flat file of its name', '**/*.md', { 'a.md': ENTRY, 'a/index.md': ENTRY }, ['a.md']],
			['data files next to markdown ones', '*.{md,yaml}', { 'a.md': ENTRY, 'b.yaml': 'title: B\n' }, ['a.md']],
			['nested data files', '**/*.yaml', { 'a.yaml': 'name: A\n', 'eu/b.yaml': 'name: B\n' }, ['a.yaml']],
		]
		test.each(WALKED)('a content directory read in place of its loader: %s', async (_label, pattern, files, read) => {
			await write({
				...Object.fromEntries(Object.entries(files).map(([name, content]) => [`src/content/docs/${name}`, content])),
				'src/content.config.ts': config(globbed('docs', './src/content/docs', pattern)),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ docs: read.map(name => `src/content/docs/${name}`) })
			expect(report.unresolved).toEqual([{ name: 'docs', reason: 'unlisted-entries', base: 'src/content/docs', pattern }])
		})

		test('a directory re-keyed under its config name is checked against that loader', async () => {
			await write({
				'src/content/hero-slides/a.md': ENTRY,
				'src/content/hero-slides/x/b.md': ENTRY,
				'src/content.config.ts': config(globbed('heroSlides', './src/content/hero-slides', '**/*.md')),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ heroSlides: ['src/content/hero-slides/a.md'] })
			expect(report.unresolved).toEqual([
				{ name: 'heroSlides', reason: 'unlisted-entries', base: 'src/content/hero-slides', pattern: '**/*.md' },
			])
		})

		test('a loader that points elsewhere, answered from a stale content directory', async () => {
			await write({
				'src/content/blog/stale.md': ENTRY,
				'data/posts/a.md': ENTRY,
				'data/posts/b.md': ENTRY,
				'src/content.config.ts': config(globbed('blog', './data/posts', '**/*.md')),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ blog: ['src/content/blog/stale.md'] })
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unlisted-entries', base: 'data/posts', pattern: '**/*.md' }])
		})

		test('files the scan does not take for entries: `_` paths and formats it does not read', async () => {
			await write({
				'data/docs/a.md': ENTRY,
				'data/docs/_draft.md': ENTRY,
				'data/drafts/_only.md': ENTRY,
				'data/notes/a.md': ENTRY,
				'data/notes/b.markdown': ENTRY,
				'data/settings/site.toml': 'title = "Site"',
				'data/mixed/a.md': ENTRY,
				'data/mixed/b.json': '{ "title": "B" }',
				'.data/hidden/a.md': ENTRY,
				'.data/hidden/_draft.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('hidden', './.data/hidden', '*.md')},
					${globbed('docs', './data/docs', '**/*.md')},
					${globbed('drafts', './data/drafts', '*.md')},
					${globbed('notes', './data/notes', '*.{md,markdown}')},
					${globbed('settings', './data/settings', '*.toml')},
					${globbed('mixed', './data/mixed', '*.{md,json}')},
				`),
			})

			const { collections, report } = await scan()

			// Astro's glob loads a `_` file its pattern matches; the scan keeps skipping it.
			expect(listed(collections)).toEqual({
				docs: ['data/docs/a.md'],
				hidden: ['.data/hidden/a.md'],
				mixed: ['data/mixed/a.md'],
				notes: ['data/notes/a.md'],
			})
			expect(report.unresolved).toEqual([
				{ name: 'docs', reason: 'unlisted-entries', base: 'data/docs', pattern: '**/*.md' },
				// Not among the scanned collections at all, and not empty either.
				{ name: 'drafts', reason: 'unlisted-entries', base: 'data/drafts', pattern: '*.md' },
				// A dot in the base is where the loader looks, not a dotfile it skips.
				{ name: 'hidden', reason: 'unlisted-entries', base: '.data/hidden', pattern: '*.md' },
				{ name: 'mixed', reason: 'unlisted-entries', base: 'data/mixed', pattern: '*.{md,json}' },
				{ name: 'notes', reason: 'unlisted-entries', base: 'data/notes', pattern: '*.{md,markdown}' },
				{ name: 'settings', reason: 'unlisted-entries', base: 'data/settings', pattern: '*.toml' },
			])
		})

		test.each([
			['in a brace', '{.drafts,sub}/*.md', '.drafts/two.md'],
			['below a directory', 'sub/.hidden/*.md', 'sub/.hidden/two.md'],
		])('a pattern that names a dot directory %s has it counted', async (_label, pattern, hidden) => {
			await write({
				'data/blog/one.md': ENTRY,
				'data/blog/sub/one.md': ENTRY,
				[`data/blog/${hidden}`]: ENTRY,
				'src/content.config.ts': config(globbed('blog', './data/blog', pattern)),
			})

			const { collections, report } = await scan()

			expect(Object.values(listed(collections)).flat().filter(file => file.includes('/.'))).toEqual([])
			expect(report.unresolved).toEqual([{ name: 'blog', reason: 'unlisted-entries', base: 'data/blog', pattern }])
		})

		test('a glob without a base loads from the project root', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				'data/posts/one.mdx': ENTRY,
				'data/posts/_two.mdx': ENTRY,
				'src/content.config.ts': config(`
					blog: defineCollection({ loader: glob({ pattern: 'src/content/blog/*.md' }) }),
					posts: defineCollection({ loader: glob({ pattern: 'data/posts/*.mdx' }) }),
				`),
			})

			const { collections, report } = await scan()

			// The scan does not follow a loader without a base: `blog` is listed by the walk, `posts` by nothing.
			expect(listed(collections)).toEqual({ blog: ['src/content/blog/first.md'] })
			expect(report.unresolved).toEqual([{ name: 'posts', reason: 'unlisted-entries', base: '.', pattern: 'data/posts/*.mdx' }])
		})

		test('an mdx file the scan skipped is an entry like any other', async () => {
			await write({
				'data/posts/one.md': ENTRY,
				'data/posts/_two.mdx': ENTRY,
				'src/content.config.ts': config(globbed('posts', './data/posts', '*.{md,mdx}')),
			})

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ posts: ['data/posts/one.md'] })
			expect(report.unresolved).toEqual([{ name: 'posts', reason: 'unlisted-entries', base: 'data/posts', pattern: '*.{md,mdx}' }])
		})

		// Astro's glob follows symbolic links; the scan's walk leaves them out.
		test('files reached through a symbolic link the scan did not follow', async () => {
			await write({
				'shared/linked.md': ENTRY,
				'shared/more/x.md': ENTRY,
				'shared/bundle/index.md': ENTRY,
				'data/files/a.md': ENTRY,
				'data/dirs/a.md': ENTRY,
				'data/loop/a.md': ENTRY,
				'src/content/pages/a.md': ENTRY,
				'src/content/legacy/a.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('files', './data/files', '**/*.md')},
					${globbed('dirs', './data/dirs', '**/*.md')},
					${globbed('loop', './data/loop', '**/*.md')},
					${globbed('pages', './src/content/pages', '**/*.md')},
					legacy: defineCollection({ schema: z.object({ title: z.string() }) }),
				`),
			})
			await fs.symlink(path.join(root, 'shared/linked.md'), path.join(root, 'data/files/linked.md'))
			await fs.symlink('../../shared/more', path.join(root, 'data/dirs/more'))
			await fs.symlink('.', path.join(root, 'data/loop/self'))
			await fs.symlink('../../../shared/bundle', path.join(root, 'src/content/pages/bundle'))
			await fs.symlink('../../../shared/more', path.join(root, 'src/content/legacy/more'))

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({
				dirs: ['data/dirs/a.md'],
				files: ['data/files/a.md'],
				legacy: ['src/content/legacy/a.md'],
				loop: ['data/loop/a.md'],
				pages: ['src/content/pages/a.md'],
			})
			expect(report.unresolved).toEqual([
				{ name: 'dirs', reason: 'unlisted-entries', base: 'data/dirs', pattern: '**/*.md' },
				{ name: 'files', reason: 'unlisted-entries', base: 'data/files', pattern: '**/*.md' },
				{ name: 'legacy', reason: 'unlisted-entries', base: 'src/content/legacy' },
				// A link back into its own directory is entered once: Astro loads `self/a.md` too.
				{ name: 'loop', reason: 'unlisted-entries', base: 'data/loop', pattern: '**/*.md' },
				{ name: 'pages', reason: 'unlisted-entries', base: 'src/content/pages', pattern: '**/*.md' },
			])
		})

		test('links the scan does read, and links that lead nowhere, are not reported', async () => {
			await write({
				'shared/blog/a.md': ENTRY,
				'shared/linked.md': ENTRY,
				'src/content/pages/a.md': ENTRY,
				'data/news/a.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('blog', './data/blog', '**/*.md')},
					${globbed('pages', './src/content/pages', '*.md')},
					${globbed('news', './data/news', '**/*.md')},
				`),
			})
			// The base itself is a link, a flat file in a content directory is one, and one is broken.
			await fs.symlink('../shared/blog', path.join(root, 'data/blog'))
			await fs.symlink('../../../shared/linked.md', path.join(root, 'src/content/pages/linked.md'))
			await fs.symlink('./nowhere.md', path.join(root, 'data/news/dangling.md'))

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({
				blog: ['data/blog/a.md'],
				news: ['data/news/a.md'],
				pages: ['src/content/pages/a.md', 'src/content/pages/linked.md'],
			})
			expect(report).toEqual(NOTHING)
		})

		test('a declaration without a loader, checked against its content directory', async () => {
			await write({
				'content/docs/a.md': ENTRY,
				'content/docs/guide/intro.md': ENTRY,
				// Only nested: the walk reads nothing, so `guides` is not scanned at all.
				'content/guides/start/intro.md': ENTRY,
				// The pre-loader form leaves `_` files out, and an image is not an entry.
				'content/notes/one.md': ENTRY,
				'content/notes/_drafts/two.md': ENTRY,
				'content/gallery/cover.jpg': 'jpg',
				// A data collection of this form is not known from a markdown one, so data files count.
				'content/team/alice.json': '{ "name": "Alice" }',
				'content/team/eu/bob.json': '{ "name": "Bob" }',
				'src/content.config.ts': config(`
					docs: defineCollection({ schema: z.object({ title: z.string() }) }),
					guides: defineCollection({ schema: z.object({ title: z.string() }) }),
					notes: defineCollection({ schema: z.object({ title: z.string() }) }),
					gallery: defineCollection({ schema: z.object({ title: z.string() }) }),
					team: defineCollection({ type: 'data', schema: z.object({ name: z.string() }) }),
				`),
			})

			// A content directory other than the default, spelled the way a CLI flag might.
			const { collections, report } = await scan(createNodeFs(root), './content/')

			expect(Object.keys(collections).sort()).toEqual(['docs', 'notes', 'team'])
			expect(report.unresolved).toEqual([
				{ name: 'docs', reason: 'unlisted-entries', base: 'content/docs' },
				{ name: 'guides', reason: 'unlisted-entries', base: 'content/guides' },
				{ name: 'team', reason: 'unlisted-entries', base: 'content/team' },
			])
		})
	})

	describe('empty collection', () => {
		test('a declared collection that loads no files is resolved and empty: in neither list', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				// Base directory is there but holds nothing the pattern matches.
				'data/news/.gitkeep': '',
				'data/news/readme.txt': 'not an entry',
				// A content directory kept in git with nothing in it yet.
				'src/content/events/.gitkeep': '',
				// A pattern the scan cannot run, over a directory with nothing it could select.
				'data/drafts/.gitkeep': '',
				// A lone negation matches nothing, in Astro as here.
				'data/negated/one.md': ENTRY,
				'src/content.config.ts': config(`
					blog: defineCollection({ schema: z.object({ title: z.string() }) }),
					${globbed('news', './data/news', '**/*.md')},
					${globbed('negated', './data/negated', '!**/*.md')},
					${globbed('missing', './data/not-there', '*.{md,mdx}')},
					${globbed('drafts', './data/drafts', '**/[^_]*.md')},
					events: defineCollection({ schema: z.object({ title: z.string() }) }),
					later: defineCollection({ schema: z.object({ title: z.string() }) }),
				`),
			})

			const { collections, report } = await scan()

			// As before: an empty collection is not in the scan result…
			expect(Object.keys(collections)).toEqual(['blog'])
			// …and it is not unresolved either. A consumer tells the two apart by the list a name is in.
			expect(report).toEqual(NOTHING)
		})
	})

	describe('scan failed', () => {
		test('a content directory whose read threw is listed, declared or not', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				// One entry with frontmatter that is not YAML takes the whole collection down.
				'src/content/blog/second.md': BROKEN_ENTRY,
				'src/content/notes/a.md': BROKEN_ENTRY,
				'src/content/team/alice.json': '{ "name": "Alice" }',
				'src/content.config.ts': config(`blog: defineCollection({ schema: z.object({ title: z.string() }) })`),
			})

			const { collections, report } = await scan()

			expect(Object.keys(collections)).toEqual(['team'])
			expect(report.unresolved).toEqual([
				{ name: 'blog', reason: 'scan-failed', base: 'src/content/blog' },
				{ name: 'notes', reason: 'scan-failed', base: 'src/content/notes' },
			])
		})

		test('a failed content directory is named where the content directory is', async () => {
			await write({ 'content/notes/a.md': BROKEN_ENTRY, 'content/blog/first.md': ENTRY })

			const { collections, report } = await scan(createNodeFs(root), './content/')

			expect(Object.keys(collections)).toEqual(['blog'])
			expect(report).toEqual({ contentConfig: 'missing', unresolved: [{ name: 'notes', reason: 'scan-failed', base: 'content/notes' }] })
		})

		test('a glob collection whose read threw is listed with its base and pattern', async () => {
			await write({
				'data/news/one.md': BROKEN_ENTRY,
				'src/content.config.ts': config(`
					${globbed('news', './data/news', '*.md')},
					${globbed('shared', '../shared', '*.md')},
				`),
			})

			const { collections, report } = await scan()

			expect(collections).toEqual({})
			expect(report.unresolved).toEqual([
				{ name: 'news', reason: 'scan-failed', base: 'data/news', pattern: '*.md' },
				// A base outside the project root is refused by the filesystem port.
				{ name: 'shared', reason: 'scan-failed', base: '../shared', pattern: '*.md' },
			])
		})

		// Root reads any directory, so there is nothing to observe under it.
		test.skipIf(process.getuid?.() === 0)('a directory that cannot be read is a failed scan, not an empty collection', async () => {
			await write({
				'data/news/one.md': ENTRY,
				'data/news/2024/two.md': ENTRY,
				'data/locked/one.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('news', './data/news', '**/*.md')},
					${globbed('locked', './data/locked', '*.md')},
				`),
			})
			const unreadable = [path.join(root, 'data/news/2024'), path.join(root, 'data/locked')]
			for (const directory of unreadable) await fs.chmod(directory, 0o000)

			try {
				const { collections, report } = await scan()

				expect(collections).toEqual({})
				expect(report.unresolved).toEqual([
					{ name: 'locked', reason: 'scan-failed', base: 'data/locked', pattern: '*.md' },
					{ name: 'news', reason: 'scan-failed', base: 'data/news', pattern: '**/*.md' },
				])
			} finally {
				for (const directory of unreadable) await fs.chmod(directory, 0o755)
			}
		})

		test('a collection with too much behind its links is a failed look, not a part of an answer', async () => {
			await write({
				'data/news/one.md': ENTRY,
				'shared/more/2024/two.md': ENTRY,
				'data/plain/a/b/c/one.md': ENTRY,
				'src/content/wiki/home.md': ENTRY,
				'src/content.config.ts': config(`
					${globbed('news', './data/news', '**/*.md')},
					${globbed('plain', './data/plain', '**/*.md')},
					wiki: defineCollection({ schema: z.object({ title: z.string() }) }),
				`),
			})
			await fs.symlink('../../shared/more', path.join(root, 'data/news/more'))
			await fs.symlink('../../../shared/more', path.join(root, 'src/content/wiki/more'))
			const nodeFs = createNodeFs(root)
			const limits: Array<number | undefined> = []
			// The report bounds what its own listing follows links into; the scan's is as it was.
			const bounded: CmsFileSystem = {
				...nodeFs,
				glob: (pattern, options) => {
					limits.push(options?.maxLinkedDirectories)
					return options?.maxLinkedDirectories === undefined
						? nodeFs.glob(pattern, options)
						: nodeFs.glob(pattern, { ...options, maxLinkedDirectories: 1 })
				},
			}

			const { collections, report } = await scan(bounded)

			expect(listed(collections)).toEqual({ news: ['data/news/one.md'], plain: ['data/plain/a/b/c/one.md'], wiki: ['src/content/wiki/home.md'] })
			expect(limits).toEqual([undefined, undefined, 20_000, 20_000, 20_000])
			// `more` and `more/2024` are two directories behind a link. The four of `plain` are the
			// tree itself, which is as large as it is.
			expect(report.unresolved).toEqual([
				{ name: 'news', reason: 'scan-failed', base: 'data/news', pattern: '**/*.md' },
				{ name: 'wiki', reason: 'scan-failed', base: 'src/content/wiki' },
			])
		})

		test('a loader the scan cannot look at, answered from a content directory of its name', async () => {
			await write({
				'src/content/shared/a.md': ENTRY,
				'src/content.config.ts': config(globbed('shared', '../shared', '**/[^_]*.md')),
			})

			const { collections, report } = await scan()

			// Astro resolves such a base against the root; the scan does not look there at all.
			expect(Object.keys(collections)).toEqual(['shared'])
			expect(report.unresolved).toEqual([{ name: 'shared', reason: 'unsupported-loader', base: '../shared', pattern: '**/[^_]*.md' }])
		})

		test('a directory whose walk threw is not listed when its declared loader read it', async () => {
			await write({
				'src/content/blog/first.mdx': ENTRY,
				// Outside the declared pattern, so only the directory walk trips over it.
				'src/content/blog/second.md': BROKEN_ENTRY,
				'src/content.config.ts': config(globbed('blog', './src/content/blog', '*.mdx')),
			})

			const { collections, report } = await scan()

			expect(collections['blog']!.entries!.map(e => e.slug)).toEqual(['first'])
			expect(report.unresolved).toEqual([])
		})

		test('a directory declared under another key fails once, under the config key', async () => {
			await write({
				'src/content/hero-slides/first.md': BROKEN_ENTRY,
				'src/content.config.ts': config(globbed('heroSlides', './src/content/hero-slides', '*.md')),
			})

			const { report } = await scan()

			expect(report.unresolved).toEqual([{ name: 'heroSlides', reason: 'scan-failed', base: 'src/content/hero-slides', pattern: '*.md' }])
		})

		test('…and is still listed next to a collection that merely loads from it', async () => {
			await write({
				'src/content/hero-slides/first.md': BROKEN_ENTRY,
				'src/content/hero-slides/site.toml': 'title = "Site"',
				'src/content.config.ts': config(globbed('slideSettings', './src/content/hero-slides', '*.toml')),
			})

			const { report } = await scan()

			expect(report.unresolved).toEqual([
				{ name: 'hero-slides', reason: 'scan-failed', base: 'src/content/hero-slides' },
				{ name: 'slideSettings', reason: 'unlisted-entries', base: 'src/content/hero-slides', pattern: '*.toml' },
			])
		})
	})

	// As nua configures Astro (`legacy.collectionsBackwardsCompat`), a content directory the
	// config leaves out is a collection of its markdown files at any depth, unless some
	// declared collection has a loader.
	describe('a content directory nothing declares', () => {
		const ORPHANS = {
			'src/content/snippets/banner.txt': 'not an entry',
			'src/content/images/cover.svg': '<svg />',
			'src/content/wiki/home.md': ENTRY,
			'src/content/wiki/deep/page.md': ENTRY,
			'src/content/wiki/_drafts/idea.md': ENTRY,
			'src/content/guide/start.md': ENTRY,
			'src/content/guide/deep/more.mdx': ENTRY,
			// Not a collection to Astro or to the scan.
			'src/content/_partials/deep/note.md': ENTRY,
			// Astro takes markdown from such a directory, so its nested data files are not missed.
			'src/content/team/alice.json': '{ "name": "Alice" }',
			'src/content/team/eu/bob.json': '{ "name": "Bob" }',
		}

		test.each([
			['no declared collection has a loader', `blog: defineCollection({ schema: z.object({ title: z.string() }) })`],
			['the config declares nothing', ``],
			['the only loader is one that may not be there', `blog: defineCollection({ ...blogOptions })`],
			['the only loader is a method, which the reader does not take for one', `blog: defineCollection({ loader() { return [] } })`],
			['the config is only partly read', `...generated`],
			['`collections` is exported by name after its declaration', `}\nexport { collections }\nconst unused = {`],
		])('is checked like a declaration without a loader when %s', async (_label, declared) => {
			await write({ ...ORPHANS, 'src/content/blog/first.md': ENTRY, 'src/content.config.ts': config(declared) })

			const { collections, report } = await scan()

			expect(listed(collections)['wiki']).toEqual(['src/content/wiki/home.md'])
			expect(report.unresolved.filter(u => u.name !== 'blog')).toEqual([
				{ name: 'guide', reason: 'unlisted-entries', base: 'src/content/guide' },
				{ name: 'wiki', reason: 'unlisted-entries', base: 'src/content/wiki' },
			])
		})

		// Root reads any directory, so there is nothing to observe under it.
		test.skipIf(process.getuid?.() === 0)('with a directory below it that cannot be read, is a failed scan', async () => {
			await write({
				'src/content/wiki/home.md': ENTRY,
				'src/content/wiki/locked/page.md': ENTRY,
				'src/content.config.ts': config(``),
			})
			const locked = path.join(root, 'src/content/wiki/locked')
			await fs.chmod(locked, 0o000)

			try {
				const { collections, report } = await scan()

				expect(listed(collections)).toEqual({ wiki: ['src/content/wiki/home.md'] })
				expect(report.unresolved).toEqual([{ name: 'wiki', reason: 'scan-failed', base: 'src/content/wiki' }])
			} finally {
				await fs.chmod(locked, 0o755)
			}
		})

		test.each([
			['a declared collection has a loader', {
				'src/content.config.ts': config(`blog: defineCollection({ loader: glob({ base: './src/content/blog', pattern: '*.md' }) })`),
			}, 'ok'],
			['a declared collection has a loader the scan cannot follow', {
				'src/content.config.ts': config(`blog: defineCollection({ loader: file('data/blog.json') })`),
			}, 'ok'],
			['there is no content config', {}, 'missing'],
			// Astro takes no collections from a config that does not export any, declared or not.
			['the config exports no `collections`', { 'src/content.config.ts': `export const other = {}\n` }, 'ok'],
			['the config declares `collections` without exporting it', { 'src/content.config.ts': `const collections = {}\n` }, 'ok'],
		])('is left alone, as Astro leaves it, when %s', async (_label, configFile, contentConfig) => {
			await write({ ...ORPHANS, 'src/content/blog/first.md': ENTRY, ...configFile })

			const { collections, report } = await scan()

			expect(listed(collections)['wiki']).toEqual(['src/content/wiki/home.md'])
			expect<string>(report.contentConfig).toBe(contentConfig)
			expect(report.unresolved.filter(u => u.name !== 'blog')).toEqual([])
		})
	})

	describe('content config', () => {
		const NEWS = { 'data/news/one.md': ENTRY }
		const NEWS_LOADED = globLoaded('./data/news', '*.md')
		const NEWS_UNLISTED: UnresolvedCollection = { name: 'news', reason: 'unlisted-entries', base: 'data/news', pattern: '*.md' }

		test('a config that does not parse is one top-level condition; the directory walk still answers', async () => {
			await write({
				...NEWS,
				'src/content/blog/first.md': ENTRY,
				'src/content.config.ts': `export const collections = {\n\tnews: ${NEWS_LOADED},\n`,
			})

			const { collections, report } = await scan()

			expect(Object.keys(collections)).toEqual(['blog'])
			// `news` cannot be named: nothing of the config was read.
			expect(report).toEqual({ contentConfig: 'unreadable', unresolved: [] })
		})

		test.each(['src/content.config.mjs', 'src/content.config.js', 'src/content.config.mts', 'src/content/config.mjs'])(
			'a config Astro reads and this reader does not (%s) is unreadable, not missing',
			async configPath => {
				await write({ ...NEWS, [configPath]: config(`news: ${NEWS_LOADED}`) })

				const { collections, report } = await scan()

				expect(collections).toEqual({})
				expect(report).toEqual({ contentConfig: 'unreadable', unresolved: [] })
			},
		)

		test('a project without a content config says so', async () => {
			await write({ 'src/content/blog/first.md': ENTRY })

			expect((await scan()).report).toEqual({ contentConfig: 'missing', unresolved: [] })
		})

		// The reader looks under `src`. With another source directory, Astro's config is elsewhere.
		// `srcDir` is read off the code of the Astro config, so it has to be unmistakable there.
		const APP_CONFIG = { 'app/content.config.ts': config(`news: ${NEWS_LOADED}`) }
		const SRC_CONFIG = { 'src/content.config.ts': config(`news: ${NEWS_LOADED}`) }
		const SRC_DIR: Array<[label: string, astroConfig: string, files: Record<string, string>, contentConfig: string]> = [
			['a config under the source directory the Astro config names', `srcDir: './app',`, APP_CONFIG, 'unreadable'],
			['a legacy config under it', `"srcDir": 'app/',`, { 'app/content/config.mjs': config(`news: ${NEWS_LOADED}`) }, 'unreadable'],
			['a source directory in backticks', 'srcDir: `./app`,', APP_CONFIG, 'unreadable'],
			['the default in backticks', 'srcDir: `./src`,', SRC_CONFIG, 'ok'],
			['the default spelled out', `srcDir: './src',`, SRC_CONFIG, 'ok'],
			['the default spelled out and no config', `srcDir: './src/',`, {}, 'missing'],
			// Nothing under the named directory settles nothing: the word may be another plugin's.
			['no config under the named directory: src is judged as usual', `plugins: [pwa({ srcDir: 'public' })],`, SRC_CONFIG, 'ok'],
			['no config under it or under src', `"srcDir": './app',`, {}, 'missing'],
			['a source directory that is not a literal', `srcDir: process.env.SRC,`, APP_CONFIG, 'unreadable'],
			['a template with a hole in it', 'srcDir: `./${dir}`,', SRC_CONFIG, 'unreadable'],
			['a literal that is only part of the value', `srcDir: './src' + '-app',`, SRC_CONFIG, 'unreadable'],
			['a value that goes on in the next line', `srcDir: './app'\n\t\t+ '2',`, SRC_CONFIG, 'unreadable'],
			['a method called on the literal in the next line', `srcDir: './app2'\n\t\t.slice(0, 5),`, SRC_CONFIG, 'unreadable'],
			['a shorthand', `srcDir,`, SRC_CONFIG, 'unreadable'],
			['a key that is a variable of that name', `[srcDir]: './src',`, SRC_CONFIG, 'unreadable'],
			['the name as a computed key', `['srcDir']: './app',`, APP_CONFIG, 'unreadable'],
			['the name as a computed key in backticks', '[`srcDir`]: `./app`,', APP_CONFIG, 'unreadable'],
			['the default behind a cast', `srcDir: './src' as const,`, SRC_CONFIG, 'ok'],
			['the name spelled with an escape', `src\\u0044ir: './app',`, APP_CONFIG, 'unreadable'],
			['a literal mention next to one that is not', `plugins: [pwa({ srcDir: './src' })], srcDir: dir,`, SRC_CONFIG, 'unreadable'],
			["another plugin's option before Astro's own", `plugins: [pwa({ srcDir: 'src' })], srcDir: './app',`, SRC_CONFIG, 'unreadable'],
			['two mentions that agree, and a config under the directory', `plugins: [pwa({ srcDir: './app' })], srcDir: './app',`, APP_CONFIG, 'unreadable'],
			['two mentions that agree, and nothing under the directory', `plugins: [pwa({ srcDir: './app' })], srcDir: './app',`, SRC_CONFIG, 'ok'],
			// A comment is not code: it sets nothing, and it does not disagree with anything.
			['a mention in a comment only', `// srcDir: './app',`, { ...APP_CONFIG, ...SRC_CONFIG }, 'ok'],
			['a mention in a comment next to the real one', `/* srcDir: './src' */ srcDir: './app',`, APP_CONFIG, 'unreadable'],
			['the name as a string that is not a key', `label: 'srcDir',`, { ...APP_CONFIG, ...SRC_CONFIG }, 'ok'],
			['a source directory outside the project', `srcDir: '../outside/app',`, SRC_CONFIG, 'unreadable'],
			['an absolute source directory', `srcDir: '/srv/site/app',`, SRC_CONFIG, 'unreadable'],
			// `root` is what every loader's base is resolved against. The scan takes it to be the project root.
			['a root that is the project root', `root: '.',`, SRC_CONFIG, 'ok'],
			['a root that is the project root, with a slash', `"root": './',`, SRC_CONFIG, 'ok'],
			['a root moved elsewhere', `root: './site',`, SRC_CONFIG, 'unreadable'],
			['a root that is not a literal', `root: new URL('.', import.meta.url),`, SRC_CONFIG, 'unreadable'],
			['a root whose value goes on in the next line', `root: '.'\n\t\t+ '/site',`, SRC_CONFIG, 'unreadable'],
			['a root in shorthand', `root,`, SRC_CONFIG, 'unreadable'],
			["a root among another plugin's options", `vite: { root: './site' },`, SRC_CONFIG, 'unreadable'],
			['a member of that name', `base: site.root,`, SRC_CONFIG, 'unreadable'],
			// Astro's `root` is a string, so a key given an object is another option of that name.
			['a root given an object', `i18n: { locales: { root: { label: 'English' } } },`, SRC_CONFIG, 'ok'],
			['a source directory given an object', `plugins: [pwa({ srcDir: { dir: './app' } })],`, { ...APP_CONFIG, ...SRC_CONFIG }, 'ok'],
			['a root mentioned in a comment', `// relative to the project root\n\troot: '.',`, SRC_CONFIG, 'ok'],
			['a moved root and no content config', `root: './site',`, {}, 'unreadable'],
		]
		test.each(SRC_DIR)('%s', async (_label, astroConfig, files, contentConfig) => {
			await write({ ...NEWS, 'astro.config.mjs': `export default {\n\t${astroConfig}\n\tintegrations: [],\n}\n`, ...files })

			expect<string>((await scan()).report.contentConfig).toBe(contentConfig)
		})

		test.each(['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'])(
			'the source directory is read from %s',
			async astroConfig => {
				await write({ ...NEWS, ...APP_CONFIG, [astroConfig]: `export default { srcDir: './app' }\n` })

				expect<string>((await scan()).report.contentConfig).toBe('unreadable')
			},
		)

		// Astro takes the first of `.mjs`, `.js`, `.ts`, `.mts` there is.
		test.each([
			['astro.config.mjs', 'astro.config.js'],
			['astro.config.js', 'astro.config.ts'],
			['astro.config.ts', 'astro.config.mts'],
		])('with %s and %s, the first decides', async (first, second) => {
			await write({ ...NEWS, ...APP_CONFIG, ...SRC_CONFIG, [first]: `export default {}\n`, [second]: `export default { srcDir: './app' }\n` })
			expect<string>((await scan()).report.contentConfig).toBe('ok')

			await write({ [first]: `export default { srcDir: './app' }\n`, [second]: `export default {}\n` })
			expect<string>((await scan()).report.contentConfig).toBe('unreadable')
		})

		test.each([
			['a variable of that name', `const srcDir = './src'\nexport default {}\n`],
			['a member assigned', `const config = {}\nconfig.srcDir = './app'\nexport default config\n`],
			['a member assigned by its name as a string', `const config = {}\nconfig['root'] = './site'\nexport default config\n`],
			['a variable named root', `const root = process.cwd()\nexport default {}\n`],
			['a parameter named root', `export default make(root => ({}))\n`],
			['a config that does not parse', `export default { srcDir: './src' \n`],
		])('an Astro config with %s leaves the place unknown', async (_label, astroConfig) => {
			await write({ ...NEWS, ...SRC_CONFIG, 'astro.config.mjs': astroConfig })

			expect<string>((await scan()).report.contentConfig).toBe('unreadable')
		})

		test('a config that declares nothing is read', async () => {
			await write({ 'src/content/blog/first.md': ENTRY, 'src/content.config.ts': `export const collections = {}\n` })

			expect((await scan()).report).toEqual(NOTHING)
		})

		// The export is there and the reader cannot see all of it: other collections may exist.
		const AUTHORS = `authors: defineCollection({ loader: file('data/authors.json') })`
		const AUTHORS_UNKNOWN: UnresolvedCollection = { name: 'authors', reason: 'unsupported-loader', file: 'data/authors.json' }
		const PARTIAL: Array<[label: string, source: string, named: UnresolvedCollection[]]> = [
			['built by a call', `export const collections = buildCollections({ ${AUTHORS} })`, []],
			['re-exported from another module', `export { collections } from './collections'`, []],
			['another binding exported under its name', `const all = { ${AUTHORS} }\nexport { all as collections }`, []],
			['re-exported from another module, next to a local of that name', `const collections = { ${AUTHORS} }\nexport { collections } from './c'`, [
				AUTHORS_UNKNOWN,
			]],
			['another binding exported under its name, next to a local of that name', `const collections = {}\nexport { all as collections }`, []],
			['left to a star export', `export * from './collections'`, []],
			['an imported binding', `import { collections } from './collections'\nexport { collections }`, []],
			['a `let`', `export let collections = { ${AUTHORS} }`, []],
			['destructured', `export const { collections } = setup()`, []],
			['a literal with a spread', `export const collections = { ...generated, ${AUTHORS} }`, [AUTHORS_UNKNOWN]],
			['a literal with a computed key', `export const collections = { [name]: ${NEWS_LOADED}, ${AUTHORS} }`, [AUTHORS_UNKNOWN]],
			['a literal with a method', `export const collections = { extra() {}, ${AUTHORS} }`, [AUTHORS_UNKNOWN]],
		]
		test.each(PARTIAL)('`collections` %s is partial, and what can be named still is', async (_label, source, named) => {
			await write({ ...NEWS, 'src/content.config.ts': IMPORTS + source })

			expect((await scan()).report).toEqual({ contentConfig: 'partial', unresolved: named })
		})

		// What it holds by the time Astro reads it may be more than the declaration says.
		test.each([
			['added to with Object.assign', `export const collections = { ${AUTHORS} }\nObject.assign(collections, more)`],
			['assigned a member', `export const collections: Record<string, unknown> = { ${AUTHORS} }\ncollections.docs = docs`],
			['with a member deleted', `export const collections: Record<string, unknown> = { ${AUTHORS} }\ndelete collections.authors`],
			['handed to a function', `export const collections = { ${AUTHORS} }\nregister(collections)`],
			['put into an object handed to a function', `export const collections = { ${AUTHORS} }\nregister({ collections })`],
			['read out into a name that is then changed', `export const collections = { ${AUTHORS} }\nconst all = collections\nall.docs = docs`],
			['held by a variable that is changed', `const all = { ${AUTHORS} }\nextend(all)\nexport const collections = all`],
			['read with Object.values', `export const collections = { ${AUTHORS} }\nexport const all = Object.values(collections)`],
			['tested with `in`', `export const collections = { ${AUTHORS} }\nexport const has = 'authors' in collections`],
			['read by member', `export const collections = { ${AUTHORS} }\nexport const authors = collections.authors`],
			['looped over', `export const collections = { ${AUTHORS} }\nfor (const name in collections) register(name)`],
			['mentioned in a function', `export const collections = { ${AUTHORS} }\nexport const all = () => collections`],
			['next to an `eval`', `export const collections = { ${AUTHORS} }\neval('1')`],
		])('`collections` %s is partial', async (_label, source) => {
			await write({ ...NEWS, 'src/content.config.ts': IMPORTS + source })

			const { report } = await scan()

			expect(report.contentConfig).toBe('partial')
			// A variable that cannot be trusted is not read at all; a literal still is.
			expect(report.unresolved).toEqual(source.includes('const all = {') ? [] : [AUTHORS_UNKNOWN])
		})

		// Reading is not changing.
		test('naming `collections` in a type, an export, a read of its keys or as a property changes nothing', async () => {
			await write({
				...NEWS,
				'src/content.config.ts': `${IMPORTS}const collections = { ${AUTHORS} }
export { collections }
export default collections
export type CollectionName = keyof typeof collections
export const names = Object.keys(collections)
export const meta = { collections: 1, other: site.collections }
`,
			})

			expect((await scan()).report).toEqual({ contentConfig: 'ok', unresolved: [AUTHORS_UNKNOWN] })
		})

		// A name is followed only when every mention of it in the file is one of a few uses that
		// can neither change its value nor hand it to code that can. `blog` is declared over
		// `data/blog`, which the scan lists whole.
		const ALT = `glob({ base: './data/other', pattern: '*.md' })`
		const mentioning = (extra: string, collections = '{ blog }'): string =>
			`${IMPORTS}const OPTIONS = { base: './data/blog', pattern: '*.md', list: ['a'] }
const blog = defineCollection({ loader: glob(OPTIONS) })
${extra}
export const collections = ${collections}
`
		const BLOG_UNKNOWN: UnresolvedCollection = { name: 'blog', reason: 'unsupported-loader' }

		test.each([
			['nothing else', ''],
			['an export', 'export { blog }'],
			['an export under another name', 'export { blog as posts, OPTIONS as options }'],
			['a default export', 'export default blog'],
			['a type', 'export type Blog = typeof blog\nexport type Options = typeof OPTIONS'],
			['a read of its keys', 'export const keys = Object.keys(blog).concat(Object.keys(OPTIONS))'],
			['an alias that is only exported', 'const same = blog\nexport { same }'],
			['a second collection of the same options', 'export const posts = defineCollection({ loader: glob(OPTIONS) })'],
			['a string of its options read into a declaration', 'export const dir = OPTIONS.base\nexport const md = OPTIONS.pattern as string'],
			['a string of its options handed to a call', 'console.log(OPTIONS.base, OPTIONS?.pattern)\nlog?.(OPTIONS.base)\nnew URL(OPTIONS.base, site)'],
			[
				'a string of its options in a logical or a conditional expression',
				"export const dir = OPTIONS.base || 'x'\nexport const md = OPTIONS.pattern ? 1 : 0",
			],
			[
				'a string of its options in a template, a property, an array and a comparison',
				"export const meta = { dir: OPTIONS.base, all: [OPTIONS.pattern], label: `in ${OPTIONS.base}`, md: OPTIONS.pattern === '*.md' ? 1 : 0 }",
			],
			['a property and a member of its name', 'export const meta = { blog: 1, OPTIONS: 2, other: site.blog, more: site.OPTIONS }'],
			['a wrapper that changes nothing', 'export const typed = { again: blog as unknown } satisfies object'],
			["another module's export of its name", "import { blog as other } from './other'\nexport { other as OPTIONS }"],
		])('`blog` is what it was declared as next to %s', async (_label, extra) => {
			await write({ 'data/blog/a.md': ENTRY, 'src/content.config.ts': mentioning(extra) })

			const { collections, report } = await scan()

			expect(listed(collections)).toEqual({ blog: ['data/blog/a.md'] })
			expect(report).toEqual(NOTHING)
		})

		test.each([
			['a member written', `blog.loader = ${ALT}`],
			['a member written behind a cast', `;(blog as any).loader = ${ALT}`],
			['a member written by a computed name', `blog['loader'] = ${ALT}`],
			['a member deleted', 'delete blog.loader'],
			['a member counted up', 'blog.version++'],
			['a member read', 'export const kind = blog.type'],
			['a computed key of its name', 'export const meta = { [blog]: 1 }'],
			['a computed member of its name', 'export const part = site[blog]'],
			['a `keys` method of something else', 'export const keys = site.keys(blog)'],
			['a method called on it', `blog.setLoader(${ALT})`],
			['a call that takes it', 'tweak(blog)'],
			['a call that takes it, kept in a constant', 'const kept = tweak(blog)'],
			['Object.assign', `Object.assign(blog, { loader: ${ALT} })`],
			['Object.values', 'export const parts = Object.values(blog)'],
			['Object.entries', 'export const parts = Object.entries(blog)'],
			['a second argument to Object.keys', 'export const keys = Object.keys(site, blog)'],
			['an optional call that takes it', 'tweak?.(blog)'],
			['a constructor that takes it', 'new Tweak(blog)'],
			['a second argument to a loader call', `export const posts = defineCollection({ loader: ${ALT} }, blog)`],
			['a loader call nothing reads', 'defineCollection(blog)'],
			['a loader call handed on', 'tweak(defineCollection(blog))'],
			['an object handed to a call', 'tweak({ blog })'],
			['an array', `;[blog].forEach(c => { c.loader = ${ALT} })`],
			['a spread', 'export const copy = { ...blog }'],
			['a loop over an array of it', `for (const c of [blog]) c.loader = ${ALT}`],
			['a loop that assigns to a member', `for (blog.loader of [${ALT}]) {}`],
			['a destructuring assignment to a member', `;({ loader: blog.loader } = { loader: ${ALT} })`],
			['an array destructuring assignment to a member', `;[blog.loader] = [${ALT}]`],
			['a destructuring of it', 'const { loader } = blog'],
			['a conditional', `const posts = Date.now() > 0 ? blog : null\nposts.loader = ${ALT}`],
			['a logical expression', `const posts = blog ?? null\nposts.loader = ${ALT}`],
			['a sequence', `const posts = (0, blog)\nposts.loader = ${ALT}`],
			['a template', 'export const label = `${blog}`'],
			['a tagged template', 'tweak`${blog}`'],
			['an `in` test', "export const has = 'loader' in blog"],
			['a `typeof` that is not a type', 'export const kind = typeof blog'],
			['a function that mentions it', `function tweak() { blog.loader = ${ALT} }\ntweak()`],
			['an arrow that returns it', `const get = () => blog\nget().loader = ${ALT}`],
			['a default of a parameter', `function tweak(c = blog) { c.loader = ${ALT} }\ntweak()`],
			['a parameter of its name', 'export function describe(blog: { id: string }) { return blog }'],
			['a local of its name', 'export function sorted() { const blog = [2, 1]; return blog }'],
			['a local of its name that nothing mentions', 'export function sorted() { const blog = [2, 1] }'],
			['a `throw`', `try { throw blog } catch (c: any) { c.loader = ${ALT} }`],
			['an assignment to another name', `let posts\nposts = blog\nposts.loader = ${ALT}`],
			['a `let` that holds it', `let posts = blog\nposts.loader = ${ALT}`],
			['an alias that is changed', `const posts = blog\nposts.loader = ${ALT}`],
			['an alias of an alias that is handed on', 'const posts = blog\nconst again = posts\ntweak(again)'],
			['an object that holds it and is changed', `const holder = { held: blog }\nholder.held.loader = ${ALT}`],
			['an object that holds it and is read into', 'const holder = { held: blog }\nexport const held = holder.held'],
			['its options written', "OPTIONS.base = './data/other'"],
			['a method called on its options', "OPTIONS.move('./data/other')"],
			['a method called on a string of its options', "export const md = OPTIONS.pattern.endsWith('.md')"],
			['a list of its options read', 'export const list = OPTIONS.list'],
			['an option the declaration does not name', 'export const missing = OPTIONS.missing'],
			['an option read by a computed name', "export const dir = OPTIONS['base']"],
			['an option read by a variable of its name', "const base = 'list'\nexport const dir = OPTIONS[base]"],
			['a string of its options called', 'OPTIONS.base()'],
			['a string of its options as a destructuring target', ';({ dir: OPTIONS.base } = site)'],
			['a string of its options assigned', 'let dir\ndir = OPTIONS.base'],
			['its options destructured', 'const { base } = OPTIONS'],
			['its options handed to a call', 'Object.freeze(OPTIONS)'],
			['`eval` anywhere', "eval('1')"],
			['`Function` anywhere', "new Function('return 1')()"],
		])('`blog` is unknown next to %s', async (_label, extra) => {
			await write({ 'data/blog/a.md': ENTRY, 'src/content.config.ts': mentioning(extra) })

			expect((await scan()).report.unresolved).toEqual([BLOG_UNKNOWN])
		})

		// A local `glob` is not Astro's, whatever it is handed. Which `glob` a mention means is
		// not worked out, so any declaration of the name counts.
		test.each([
			['a local `glob`', "const glob = (o: any) => astroGlob({ ...o, base: './data/other' })"],
			['a local `defineCollection`', `function defineCollection(c: any) { return define({ ...c, loader: ${ALT} }) }`],
			['a parameter named `glob`', 'export const wrap = (glob: any) => glob'],
			['an alias of `defineCollection`', 'const defineCmsCollection = defineCollection'],
		])('%s leaves the collections unknown', async (_label, extra) => {
			await write({ 'data/blog/a.md': ENTRY, 'src/content.config.ts': mentioning(extra) })

			expect((await scan()).report.unresolved).toEqual([BLOG_UNKNOWN])
		})

		test('what is handed to a call the file declares itself is unknown, also where the reader would read it', async () => {
			const source = (local: string): string =>
				`${IMPORTS}${local}const SHARED = { loader: file('data/authors.json') }
const held = glob(SHARED)
export { held }
export const collections = { authors: defineCollection(SHARED) }
`
			await write({ 'src/content.config.ts': source('') })
			// `glob` is the loaders' own: it leaves `SHARED` as it is, and the path can be read off it.
			expect((await scan()).report.unresolved).toEqual([{ name: 'authors', reason: 'unsupported-loader', file: 'data/authors.json' }])

			await write({
				'src/content.config.ts': source(`function glob(options: any) { options.loader = ${ALT}; return options }\n`).replace('file, glob', 'file'),
			})
			expect((await scan()).report.unresolved).toEqual([{ name: 'authors', reason: 'unsupported-loader' }])
		})

		test('the options of a declaration, a loader and a path are read through constants', async () => {
			await write({
				'data/blog/a.md': ENTRY,
				'data/authors.json': '[{ "id": "a" }]',
				'src/content.config.ts': `${IMPORTS}const AUTHORS_FILE = 'data/authors.json'
const GLOB_OPTIONS = { base: './data/blog', pattern: '*.md' }
const LOADER = glob(GLOB_OPTIONS)
const BLOG_OPTIONS = { loader: LOADER }
const blog = defineCollection(BLOG_OPTIONS)
const posts = blog
export const collections = { posts, authors: defineCollection({ loader: file(AUTHORS_FILE) }) }
`,
			})

			const { report } = await scan()

			// The scan does not follow this far, so `posts` is not listed. The report does, and names where its files are.
			expect(report).toEqual({
				contentConfig: 'ok',
				unresolved: [
					{ name: 'authors', reason: 'unsupported-loader', file: 'data/authors.json' },
					{ name: 'posts', reason: 'unlisted-entries', base: 'data/blog', pattern: '*.md' },
				],
			})
		})

		test.each([
			['a local `glob`', "const glob = (o: any) => astroGlob({ ...o, base: './data/other' })"],
			['a local `defineCollection`', `function defineCollection(c: any) { return define({ ...c, loader: ${ALT} }) }`],
		])("%s is not taken for the loaders' own, whatever literals it is handed", async (_label, local) => {
			await write({ 'data/blog/a.md': ENTRY, 'src/content.config.ts': config(globbed('blog', './data/blog', '*.md'), local) })

			expect((await scan()).report.unresolved).toEqual([BLOG_UNKNOWN])
		})

		test('`defineCmsCollection` is read like `defineCollection`', async () => {
			await write({
				'data/blog/a.md': ENTRY,
				'src/content.config.ts': `${IMPORTS}import { defineCmsCollection } from '@nuasite/cms'
export const collections = { blog: defineCmsCollection({ loader: glob({ base: './data/blog', pattern: '*.md' }) }) }
`,
			})

			expect((await scan()).report).toEqual(NOTHING)
		})

		test('a local `Object` is not the one whose `keys` only reads', async () => {
			const keys = 'export const keys = Object.keys(blog)'
			await write({ 'data/blog/a.md': ENTRY, 'src/content.config.ts': mentioning(keys) })
			expect((await scan()).report).toEqual(NOTHING)

			await write({ 'src/content.config.ts': mentioning(`function wrap(Object: any) { return Object }\n${keys}`) })
			expect((await scan()).report.unresolved).toEqual([BLOG_UNKNOWN])

			await write({ 'src/content.config.ts': mentioning(`Object.keys = (c: any) => { c.loader = ${ALT}; return [] }\n${keys}`) })
			expect((await scan()).report.unresolved).toEqual([BLOG_UNKNOWN])
		})

		test('a string cannot be changed, so a constant that holds one is followed whatever mentions it', async () => {
			await write({
				'data/blog/a.md': ENTRY,
				'src/content.config.ts': `${IMPORTS}const MD = '*.md'
const BASE = \`./data/blog\`
console.log(MD, [BASE])
export function label(suffix: string) { return MD + BASE + suffix }
export const collections = { blog: defineCollection({ loader: glob({ base: BASE, pattern: MD }) }) }
`,
			})

			expect((await scan()).report).toEqual(NOTHING)
		})

		// An object literal is read as a literal only when its own keys settle what it holds.
		const BLOG_GLOB = `glob({ base: './data/blog', pattern: '*.md' })`
		test.each<[string, string, UnresolvedCollection[]]>([
			[
				'a base given twice, last as a literal',
				`defineCollection({ loader: glob({ base: './data/other', base: './data/blog', pattern: '*.md' }) })`,
				[],
			],
			['a base given twice, last not a literal', `defineCollection({ loader: glob({ base: './data/blog', base: dir, pattern: '*.md' }) })`, [{
				...BLOG_UNKNOWN,
				pattern: '*.md',
			}]],
			['a pattern given twice, last not a literal', `defineCollection({ loader: glob({ base: './data/blog', pattern: '*.md', pattern: all }) })`, [{
				...BLOG_UNKNOWN,
				base: 'data/blog',
			}]],
			[
				'a getter for the base after a literal',
				`defineCollection({ loader: glob({ base: './data/blog', get base() { return './data/other' }, pattern: '*.md' }) })`,
				[{ ...BLOG_UNKNOWN, pattern: '*.md' }],
			],
			['a method for the pattern', `defineCollection({ loader: glob({ base: './data/blog', pattern() { return '*.md' } }) })`, [{
				...BLOG_UNKNOWN,
				base: 'data/blog',
			}]],
			['a prototype for the glob options', `defineCollection({ loader: glob({ __proto__: shared, pattern: '*.md' }) })`, [BLOG_UNKNOWN]],
			// The scan does not find a loader given twice; the report reads the one that counts, and so names what was left out.
			['a loader given twice, last the one that counts', `defineCollection({ loader: file('data/authors.json'), loader: ${BLOG_GLOB} })`, [
				{ name: 'blog', reason: 'unlisted-entries', base: 'data/blog', pattern: '*.md' },
			]],
			['a loader given twice, last a method', `defineCollection({ loader: ${BLOG_GLOB}, loader() { return [] } })`, [BLOG_UNKNOWN]],
			['a spread before the loader, which the loader replaces', `defineCollection({ ...shared, loader: ${BLOG_GLOB} })`, []],
			['a prototype that may supply a loader', `defineCollection({ __proto__: { loader: ${ALT} } } as any)`, [BLOG_UNKNOWN]],
			['a prototype next to a loader', `defineCollection({ loader: ${BLOG_GLOB}, __proto__: shared })`, [BLOG_UNKNOWN]],
		])('an object literal with %s', async (_label, declaration, unresolved) => {
			await write({ 'data/blog/a.md': ENTRY, 'src/content.config.ts': config(`blog: ${declaration}`) })

			expect((await scan()).report).toEqual({ contentConfig: 'ok', unresolved })
		})

		test('a name given twice in `collections` holds what it was given last; a prototype hides names', async () => {
			await write({
				'data/blog/a.md': ENTRY,
				'src/content.config.ts': config(
					`blog: defineCollection({ loader: file('data/authors.json') }), blog: defineCollection({ loader: ${BLOG_GLOB} })`,
				),
			})
			expect((await scan()).report).toEqual(NOTHING)

			await write({ 'src/content.config.ts': config(`blog: defineCollection({ loader: ${BLOG_GLOB} }), __proto__: more`) })
			expect((await scan()).report).toEqual({ contentConfig: 'partial', unresolved: [] })
		})

		test('a value that is only read, shared or exported is still what it was declared as', async () => {
			await write({
				'data/blog/a.md': ENTRY,
				'src/content.config.ts': `${IMPORTS}const OPTIONS = { base: './data/blog', pattern: '*.md' }
export const BLOG_DIR = OPTIONS.base
const MD = '*.md'
console.log(MD)
const blog = defineCollection({ loader: glob({ base: './data/blog', pattern: MD }) })
export type Blog = typeof blog
const same = blog
export { same }
export const collections = {
	blog,
	one: defineCollection({ loader: glob(OPTIONS) }),
	two: defineCollection({ loader: glob(OPTIONS) }),
	['three']: defineCollection({ loader: glob(OPTIONS) }),
}
`,
			})

			const { collections, report } = await scan()

			// A string cannot be changed in place, so handing `MD` to a function costs nothing.
			expect(Object.keys(collections).sort()).toEqual(['blog', 'one', 'three', 'two'])
			expect(report).toEqual(NOTHING)
		})

		// Forms the scan does not follow but the reader can still read whole: every name is known.
		test.each([
			['`satisfies`', `export const collections = { news: ${NEWS_LOADED} } satisfies Record<string, unknown>`],
			['`as const`', `export const collections = { news: ${NEWS_LOADED} } as const`],
			['a variable of the same file', `const all = { news: ${NEWS_LOADED} }\nexport const collections = all`],
			['a star export next to its own declaration', `export * from './helpers'\nexport const collections = { news: ${NEWS_LOADED} } as const`],
			['other names re-exported next to it', `export { helper } from './helpers'\nexport const collections = { news: ${NEWS_LOADED} } as const`],
		])('`collections` behind %s is read whole', async (_label, source) => {
			await write({ ...NEWS, 'src/content.config.ts': IMPORTS + source })

			const { collections, report } = await scan()

			expect(collections).toEqual({})
			expect(report).toEqual({ contentConfig: 'ok', unresolved: [NEWS_UNLISTED] })
		})

		test('…and a collection read from its content directory is vouched for behind them too', async () => {
			await write({
				'src/content/blog/first.md': ENTRY,
				'data/2024/a.md': ENTRY,
				'src/content.config.ts': `${IMPORTS}export const collections = {
	blog: ${globLoaded('./src/content/blog', '*.md')},
	2024: ${globLoaded('./data/2024', '*.md')},
} satisfies Record<string, unknown>
`,
			})

			const { collections, report } = await scan()

			expect(Object.keys(collections)).toEqual(['blog'])
			// A numeric key is a name like any other.
			expect(report).toEqual({
				contentConfig: 'ok',
				unresolved: [{ name: '2024', reason: 'unlisted-entries', base: 'data/2024', pattern: '*.md' }],
			})
		})

		test('identifiers are followed through module-level constants only', async () => {
			await write({
				'data/docs/a.md': ENTRY,
				'data/moved/a.md': ENTRY,
				'src/content.config.ts': `${IMPORTS}const docs = ${globLoaded('./data/docs', '*.md')}
function unrelated() { const docs = 1; return docs }
let base = './data/moved'
base = './data/elsewhere'
export const collections = { docs, moved: defineCollection({ loader: glob({ base, pattern: '*.md' }) }) }
`,
			})

			const { collections, report } = await scan()

			// Which `docs` a mention means is not worked out, so a second declaration of the name
			// anywhere leaves it unknown; a `let` is not a literal.
			expect(Object.keys(collections).sort()).toEqual(['docs', 'moved'])
			expect(report).toEqual({
				contentConfig: 'ok',
				unresolved: [{ name: 'docs', reason: 'unsupported-loader' }, { name: 'moved', reason: 'unsupported-loader', pattern: '*.md' }],
			})
		})

		test('the report survives the content-config parse cache', async () => {
			await write({ 'src/content.config.ts': config(`authors: defineCollection({ loader: file('data/authors.json') })`) })
			const nodeFs = createNodeFs(root)
			const parseCache: ParseCache = new Map()

			const first = collectionScanReport(await scanCollections(nodeFs, 'src/content', parseCache, { report: true }))
			const readFile = spyOn(nodeFs, 'readFile')
			const second = collectionScanReport(await scanCollections(nodeFs, 'src/content', parseCache, { report: true }))

			// The Astro config is looked for on every scan; the content config is not read again.
			expect(readFile.mock.calls.filter(([file]) => file.includes('content'))).toEqual([])
			expect(second).toEqual(first!)
			expect(second).toEqual({
				contentConfig: 'ok',
				unresolved: [{ name: 'authors', reason: 'unsupported-loader', file: 'data/authors.json' }],
			})
		})

		test('two config files are partial: the one the reader took need not be the one Astro uses', async () => {
			await write({
				...NEWS,
				'src/content/config.ts': config(`news: ${NEWS_LOADED}`),
				'src/content.config.mjs': config(`news: ${NEWS_LOADED}, authors: defineCollection({ loader: file('data/authors.json') })`),
			})

			const { collections, report } = await scan()

			expect(Object.keys(collections)).toEqual(['news'])
			expect(report).toEqual({ contentConfig: 'partial', unresolved: [] })
		})

		test('with two config files, the names come from the one the parse came from', async () => {
			await write({
				// Read first, and parses to nothing: no schema and no glob pattern.
				'src/content/config.ts': config(`old: defineCollection({ loader: file('data/old.json') })`),
				'src/content.config.ts': config(`news: ${NEWS_LOADED}`),
			})
			const nodeFs = createNodeFs(root)

			expect([...(await parseContentConfig(nodeFs, new Map())).keys()]).toEqual(['news'])
			expect((await readContentConfig(nodeFs, new Map())).declared.map(d => d.name)).toEqual(['news'])

			// When neither parses to anything, the first one that declares names is the answer.
			await write({ 'src/content.config.ts': config(`other: defineCollection({ loader: file('data/other.json') })`) })
			expect((await readContentConfig(nodeFs, new Map())).declared.map(d => d.name)).toEqual(['old'])
		})
	})
})
