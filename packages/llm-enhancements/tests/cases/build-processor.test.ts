import * as cms from '@nuasite/cms'
import type { AstroConfig, AstroIntegrationLogger } from 'astro'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { processBuildOutput } from '../../src/build-processor'
import { resolveOptions } from '../../src/types'

// The collection path is the one that reads an entry's source: a page it misses is scraped from its
// rendered HTML instead, losing the entry's frontmatter. Every page used to resolve against a fresh
// scan of every collection, which made a build quadratic in the number of entries.
describe('processBuildOutput resolves collection pages from their source', () => {
	let root: string
	const logged: string[] = []
	const logger = {
		info: (message: string) => logged.push(message),
		warn: (message: string) => logged.push(message),
	} as unknown as AstroIntegrationLogger
	// The project root is never the working directory here, as with `astro build --root site`.
	let config: AstroConfig

	beforeEach(async () => {
		// A space in the path, which a file URL encodes as %20.
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm build-'))
		config = { site: 'https://example.com', root: pathToFileURL(root + '/') } as AstroConfig
		logged.length = 0
		await route('posts', 'posts')
		for (const n of [1, 2, 3]) {
			await write(`src/content/posts/p${n}.md`, `---\ntitle: Post ${n}\n---\n\nBody of post ${n}.\n`)
			await write(`dist/posts/p${n}/index.html`, `<html><head><title>Post ${n}</title></head><body><nav>Chrome</nav><h1>Post ${n}</h1></body></html>`)
		}
		await write('dist/index.html', '<html><head><title>Home</title></head><body><h1>Home</h1></body></html>')
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	async function write(relative: string, content: string): Promise<void> {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, content)
	}

	/** A dynamic route under `prefix` that renders `collection`, as a site's `src/pages` would have it. */
	async function route(prefix: string, collection: string): Promise<void> {
		await write(
			`src/pages/${prefix}/[slug].astro`,
			`---\nimport { getCollection } from 'astro:content'\nexport async function getStaticPaths() {\n\tconst entries = await getCollection('${collection}')\n\treturn entries.map(entry => ({ params: { slug: entry.id } }))\n}\n---\n`,
		)
	}

	const pages = [{ pathname: '' }, { pathname: 'posts/p1' }, { pathname: 'posts/p2' }, { pathname: 'posts/p3' }]
	const build = (buildPages = pages, options = resolveOptions()) =>
		processBuildOutput(pathToFileURL(path.join(root, 'dist') + '/'), buildPages, options, logger, config)

	test('a collection page is written from its entry, not scraped from its HTML', async () => {
		await build()

		const markdown = await fs.readFile(path.join(root, 'dist/posts/p1.md'), 'utf-8')
		expect(markdown).toContain('type: collection')
		expect(markdown).toContain('source: src/content/posts/p1.md')
		expect(markdown).not.toContain('Chrome')
		expect(logged).toContain('Generated 4 .md files (3 collection, 1 static)')
	})

	test('the discovery files name a collection page by its entry title', async () => {
		await build()

		expect(await fs.readFile(path.join(root, 'dist/llms.txt'), 'utf-8')).toContain('[Post 1](https://example.com/posts/p1.md)')
		expect(await fs.readFile(path.join(root, 'dist/.well-known/llm.md'), 'utf-8')).toContain('Post 1')
	})

	test('an mdx entry is written without its imports, or from its HTML when it uses a component', async () => {
		await route('notes', 'notes')
		await write('src/content/notes/plain.mdx', "---\ntitle: Plain\n---\n\nimport Tip from '../../components/Tip.astro'\n\nJust prose.\n")
		await write('src/content/notes/rich.mdx', "---\ntitle: Rich\n---\n\nimport Tip from '../../components/Tip.astro'\n\n<Tip>Rendered tip</Tip>\n")
		await write('dist/notes/plain/index.html', '<html><head><title>Plain</title></head><body><h1>Plain</h1><p>Just prose.</p></body></html>')
		await write('dist/notes/rich/index.html', '<html><head><title>Rich</title></head><body><h1>Rich</h1><p>Rendered tip</p></body></html>')

		await build([{ pathname: 'notes/plain' }, { pathname: 'notes/rich' }])

		const plain = await fs.readFile(path.join(root, 'dist/notes/plain.md'), 'utf-8')
		expect(plain).toContain('type: collection')
		expect(plain).toContain('Just prose.')
		expect(plain).not.toContain('import Tip')
		const rich = await fs.readFile(path.join(root, 'dist/notes/rich.md'), 'utf-8')
		expect(rich).toContain('type: collection')
		expect(rich).toContain('source: src/content/notes/rich.mdx')
		expect(rich).toContain('Rendered tip')
	})

	test('an mdx entry told by its HTML is written even when static pages are not', async () => {
		await route('notes', 'notes')
		await write('src/content/notes/rich.mdx', '---\ntitle: Rich\n---\n\n<Tip>Rendered tip</Tip>\n')
		await write('dist/notes/rich/index.html', '<html><head><title>Rich</title></head><body><p>Rendered tip</p></body></html>')

		await build([{ pathname: '' }, { pathname: 'notes/rich' }], resolveOptions({ includeStaticPages: false }))

		expect(await fs.readFile(path.join(root, 'dist/notes/rich.md'), 'utf-8')).toContain('Rendered tip')
		expect(await fs.readFile(path.join(root, 'dist/llms.txt'), 'utf-8')).toContain('[Rich](https://example.com/notes/rich.md)')
		expect(await Bun.file(path.join(root, 'dist/index.md')).exists()).toBe(false)
	})

	test('a data entry a pathname rule maps to the page is its page, told by the HTML', async () => {
		await write('src/content/products/x.json', '{ "slug": "x", "name": "Widget" }')
		await write('dist/products/x/index.html', '<html><head><title>Widget</title></head><body><h1>Widget</h1></body></html>')
		const scan = spyOn(cms, 'scanProjectCollections').mockResolvedValue({
			products: {
				name: 'products',
				label: 'products',
				path: 'src/content/products',
				entryCount: 1,
				fields: [],
				fileExtension: 'json',
				type: 'data',
				pathname: [{ literal: 'products' }, { field: 'slug' }],
				entries: [{ slug: 'x', sourcePath: 'src/content/products/x.json', data: { slug: 'x', name: 'Widget' } }],
			},
		} as never)
		try {
			await build([{ pathname: 'products/x' }], resolveOptions({ includeStaticPages: false }))
		} finally {
			scan.mockRestore()
		}

		const markdown = await fs.readFile(path.join(root, 'dist/products/x.md'), 'utf-8')
		expect(markdown).toContain('type: collection')
		expect(markdown).toContain('source: src/content/products/x.json')
		expect(markdown).toContain('# Widget')
		expect(markdown).not.toContain('"slug"')
		expect(await fs.readFile(path.join(root, 'dist/llms.txt'), 'utf-8')).toContain('[Widget](https://example.com/products/x.md)')
	})

	test('a static page is not given an entry that only shares its last segment', async () => {
		await route('blog', 'blog')
		await write('src/content/blog/jana.md', '---\ntitle: A blog post\n---\n\nNot about the team.\n')
		await write('dist/team/jana/index.html', '<html><head><title>Jana</title></head><body><h1>Jana, our designer</h1></body></html>')

		await build([{ pathname: 'team/jana' }])

		const markdown = await fs.readFile(path.join(root, 'dist/team/jana.md'), 'utf-8')
		expect(markdown).toContain('type: static')
		expect(markdown).toContain('Jana, our designer')
		expect(markdown).not.toContain('Not about the team')
	})

	test("a page under a renamed or localized route is its entry's", async () => {
		await route('aktuality', 'news')
		await route('en/blog', 'blog')
		await write('src/content/news/x.md', '---\ntitle: Zpráva\n---\n\nText zprávy.\n')
		await write('src/content/blog/hello.md', '---\ntitle: Hello\n---\n\nHello there.\n')
		await write('dist/aktuality/x/index.html', '<html><head><title>Zpráva</title></head><body><nav>Menu</nav></body></html>')
		await write('dist/en/blog/hello/index.html', '<html><head><title>Hello</title></head><body><nav>Menu</nav></body></html>')

		await build([{ pathname: 'aktuality/x' }, { pathname: 'en/blog/hello' }], resolveOptions({ includeStaticPages: false }))

		const news = await fs.readFile(path.join(root, 'dist/aktuality/x.md'), 'utf-8')
		expect(news).toContain('source: src/content/news/x.md')
		expect(news).toContain('Text zprávy.')
		expect(await fs.readFile(path.join(root, 'dist/en/blog/hello.md'), 'utf-8')).toContain('source: src/content/blog/hello.md')
	})

	test('an entry that declares another URL is not given the page its route and slug would name', async () => {
		await route('blog', 'blog')
		await write('src/content/blog/jana.md', "---\ntitle: Jana\nurlPath: /people/jana\n---\n\nJana's profile.\n")
		await write('dist/blog/jana/index.html', '<html><head><title>Teaser</title></head><body><h1>A teaser for Jana</h1></body></html>')
		await write('dist/people/jana/index.html', '<html><head><title>Jana</title></head><body></body></html>')

		await build([{ pathname: 'blog/jana' }, { pathname: 'people/jana' }])

		expect(await fs.readFile(path.join(root, 'dist/blog/jana.md'), 'utf-8')).toContain('type: static')
		expect(await fs.readFile(path.join(root, 'dist/people/jana.md'), 'utf-8')).toContain('source: src/content/blog/jana.md')
	})

	test('an entry without a title is listed by its page title', async () => {
		await route('people', 'people')
		await write('src/content/people/dana.md', '---\nname: Dana\n---\n\nBio.\n')
		await write('dist/people/dana/index.html', '<html><head><title>Dana | Team</title></head><body><p>Bio.</p></body></html>')

		await build([{ pathname: 'people/dana' }])

		expect(await fs.readFile(path.join(root, 'dist/llms.txt'), 'utf-8')).toContain('[Dana | Team](https://example.com/people/dana.md)')
	})

	test('a failed scan is logged once and every page is converted from its HTML', async () => {
		const scan = spyOn(cms, 'scanProjectCollections').mockRejectedValue(new Error('broken config'))
		try {
			await build()
			expect(scan).toHaveBeenCalledTimes(1)
		} finally {
			scan.mockRestore()
		}

		expect(logged.filter(m => m.includes('broken config'))).toHaveLength(1)
		expect(await fs.readFile(path.join(root, 'dist/posts/p1.md'), 'utf-8')).toContain('type: static')
	})

	test('content outside the project root is reported, and every page is converted from its HTML', async () => {
		const shared = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-shared-'))
		try {
			await fs.mkdir(path.join(shared, 'posts'), { recursive: true })
			await fs.writeFile(path.join(shared, 'posts/p1.md'), '---\ntitle: Far\n---\n\nFrom elsewhere.\n')

			await build(pages, resolveOptions({ contentDir: path.relative(root, shared) }))

			expect(logged.filter(m => m.includes('outside the project root'))).toHaveLength(1)
			const markdown = await fs.readFile(path.join(root, 'dist/posts/p1.md'), 'utf-8')
			expect(markdown).toContain('type: static')
			expect(markdown).not.toContain('From elsewhere.')
		} finally {
			await fs.rm(shared, { recursive: true, force: true })
		}
	})

	test('an absolute contentDir inside the project root is read like a relative one', async () => {
		await build(pages, resolveOptions({ contentDir: path.join(root, 'src/content') }))

		const markdown = await fs.readFile(path.join(root, 'dist/posts/p1.md'), 'utf-8')
		expect(markdown).toContain('type: collection')
		expect(markdown).toContain('source: src/content/posts/p1.md')
	})

	test('a homepage an entry tells still gives the site its title', async () => {
		await write('src/content/pages/home.md', '---\ntitle: Welcome\n---\n\nHello.\n')
		const find = spyOn(cms, 'collectionPagesByPathname').mockResolvedValue(
			new Map([['/', { name: 'pages', slug: 'home', file: 'src/content/pages/home.md' }]]),
		)
		try {
			await build([{ pathname: '' }])
		} finally {
			find.mockRestore()
		}

		expect(await fs.readFile(path.join(root, 'dist/index.md'), 'utf-8')).toContain('type: collection')
		expect(await fs.readFile(path.join(root, 'dist/llms.txt'), 'utf-8')).toStartWith('# Home')
	})

	test('a page whose HTML cannot be linked is still written and listed', async () => {
		const realWrite = fs.writeFile
		const write = spyOn(fs, 'writeFile').mockImplementation(
			((file: unknown, ...rest: unknown[]) =>
				String(file).endsWith(path.join('posts/p1/index.html'))
					? Promise.reject(new Error('read-only'))
					: (realWrite as (...args: unknown[]) => Promise<void>)(file, ...rest)) as typeof fs.writeFile,
		)
		try {
			await build()
		} finally {
			write.mockRestore()
		}

		expect(logged.some(m => m.includes('/posts/p1') && m.includes('read-only'))).toBe(true)
		expect(logged).toContain('Generated 4 .md files (3 collection, 1 static)')
		expect(await fs.readFile(path.join(root, 'dist/llms.txt'), 'utf-8')).toContain('[Post 1](https://example.com/posts/p1.md)')
	})

	test('the collections are scanned once for the build', async () => {
		const scan = spyOn(cms, 'scanProjectCollections')
		const find = spyOn(cms, 'collectionPagesByPathname')
		try {
			await build()

			expect(scan).toHaveBeenCalledTimes(1)
			expect(find).toHaveBeenCalledTimes(1)
		} finally {
			scan.mockRestore()
			find.mockRestore()
		}
	})

	test("each page's HTML is read once", async () => {
		const read = spyOn(fs, 'readFile')
		try {
			await build()
			const htmlReads = read.mock.calls.map(call => String(call[0])).filter(file => file.endsWith('.html'))
			expect(htmlReads.sort()).toEqual([...new Set(htmlReads)].sort())
			expect(htmlReads).toContain(path.join(root, 'dist/index.html'))
		} finally {
			read.mockRestore()
		}
	})
})

// Astro loads the integration through a Vite module runner and closes it once the config is
// loaded, so a module imported dynamically at build time never arrives, in Node or Bun alike.
// Bun's own test runner imports it fine, so only the source can show the mistake.
describe('llm-enhancements imports everything up front', () => {
	test('no module under src imports dynamically, except the optional peer at the top of src/cms.ts', async () => {
		const src = path.join(import.meta.dir, '../../src')
		const offenders: string[] = []
		for (const file of await fs.readdir(src, { recursive: true })) {
			if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
			const code = await fs.readFile(path.join(src, file), 'utf-8')
			const imports = code.split('\n').filter(line => /\bimport\s*\(/.test(line))
			const allowed = file === 'cms.ts' && imports.length === 1 && /^export const cms\b.*= await import\('@nuasite\/cms'\)/.test(imports[0]!)
			if (imports.length > 0 && !allowed) offenders.push(file)
		}
		expect(offenders).toEqual([])
	})
})
