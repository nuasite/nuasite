import * as cms from '@nuasite/cms'
import { resetProjectRoot, setProjectRoot } from '@nuasite/cms'
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
	const config = { site: 'https://example.com' } as AstroConfig

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-build-'))
		setProjectRoot(root)
		logged.length = 0
		for (const n of [1, 2, 3]) {
			await write(`src/content/posts/p${n}.md`, `---\ntitle: Post ${n}\n---\n\nBody of post ${n}.\n`)
			await write(`dist/posts/p${n}/index.html`, `<html><head><title>Post ${n}</title></head><body><nav>Chrome</nav><h1>Post ${n}</h1></body></html>`)
		}
		await write('dist/index.html', '<html><head><title>Home</title></head><body><h1>Home</h1></body></html>')
	})

	afterEach(async () => {
		resetProjectRoot()
		await fs.rm(root, { recursive: true, force: true })
	})

	async function write(relative: string, content: string): Promise<void> {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, content)
	}

	const pages = [{ pathname: '' }, { pathname: 'posts/p1' }, { pathname: 'posts/p2' }, { pathname: 'posts/p3' }]
	const build = () => processBuildOutput(pathToFileURL(path.join(root, 'dist') + '/'), pages, resolveOptions(), logger, config)

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

	test('an mdx entry is written without its imports, or left to its HTML when it uses a component', async () => {
		await write('src/content/notes/plain.mdx', "---\ntitle: Plain\n---\n\nimport Tip from '../../components/Tip.astro'\n\nJust prose.\n")
		await write('src/content/notes/rich.mdx', "---\ntitle: Rich\n---\n\nimport Tip from '../../components/Tip.astro'\n\n<Tip>Rendered tip</Tip>\n")
		await write('dist/notes/plain/index.html', '<html><head><title>Plain</title></head><body><h1>Plain</h1><p>Just prose.</p></body></html>')
		await write('dist/notes/rich/index.html', '<html><head><title>Rich</title></head><body><h1>Rich</h1><p>Rendered tip</p></body></html>')

		await processBuildOutput(
			pathToFileURL(path.join(root, 'dist') + '/'),
			[{ pathname: 'notes/plain' }, { pathname: 'notes/rich' }],
			resolveOptions(),
			logger,
			config,
		)

		const plain = await fs.readFile(path.join(root, 'dist/notes/plain.md'), 'utf-8')
		expect(plain).toContain('type: collection')
		expect(plain).toContain('Just prose.')
		expect(plain).not.toContain('import Tip')
		const rich = await fs.readFile(path.join(root, 'dist/notes/rich.md'), 'utf-8')
		expect(rich).toContain('type: static')
		expect(rich).toContain('Rendered tip')
	})

	test('the collections are scanned once for the build and handed to every lookup', async () => {
		const scan = spyOn(cms, 'scanProjectCollections')
		const find = spyOn(cms, 'findCollectionSource')
		try {
			await build()

			expect(scan).toHaveBeenCalledTimes(1)
			const scanned = await (scan.mock.results[0]!.value as ReturnType<typeof cms.scanProjectCollections>)
			expect(find).toHaveBeenCalledTimes(pages.length)
			for (const call of find.mock.calls) expect(call[2]).toBe(scanned)
		} finally {
			scan.mockRestore()
			find.mockRestore()
		}
	})
})

// Astro loads the integration through a Vite module runner and closes it once the config is
// loaded, so a module imported dynamically at build time never arrives, in Node or Bun alike.
// Bun's own test runner imports it fine, so only the source can show the mistake.
describe('llm-enhancements imports everything up front', () => {
	test('no module under src imports anything dynamically', async () => {
		const src = path.join(import.meta.dir, '../../src')
		const offenders: string[] = []
		for (const file of await fs.readdir(src, { recursive: true })) {
			if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
			const code = await fs.readFile(path.join(src, file), 'utf-8')
			if (/\bimport\s*\(/.test(code)) offenders.push(file)
		}
		expect(offenders).toEqual([])
	})
})
