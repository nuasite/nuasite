import * as cms from '@nuasite/cms'
import type { AstroConfig } from 'astro'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ViteDevServer } from 'vite'
import { createDevMiddleware } from '../../src/dev-middleware'
import { resolveOptions } from '../../src/types'

type Handler = (req: { url: string; headers: Record<string, string> }, res: unknown, next: () => void) => unknown

describe('the dev middleware resolves pages like the build', () => {
	let root: string
	let handlers: Handler[]
	// The dev server is not listening: a page it would render cannot be fetched.
	let fetched: ReturnType<typeof spyOn>

	beforeEach(async () => {
		fetched = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('not listening'))
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-dev-'))
		await fs.mkdir(path.join(root, 'src/content/news'), { recursive: true })
		await fs.writeFile(path.join(root, 'src/content/news/škola.md'), '---\ntitle: Škola\n---\n\nZápis do školy.\n')
		await fs.writeFile(path.join(root, 'src/content/news/home.md'), '---\ntitle: Úvod\n---\n\nVítejte.\n')
		handlers = []
		const server = { middlewares: { use: (handler: Handler) => handlers.push(handler) } } as unknown as ViteDevServer
		const config = { site: 'https://example.com', root: pathToFileURL(root + '/') } as AstroConfig
		createDevMiddleware(server, resolveOptions(), config)
	})

	afterEach(async () => {
		fetched.mockRestore()
		await fs.rm(root, { recursive: true, force: true })
	})

	/** Run the middlewares on `url`, as connect would, and give what was sent. */
	async function request(url: string): Promise<string | undefined> {
		let sent: string | undefined
		const res = { setHeader() {}, end: (body: string) => (sent = body) }
		for (const handler of handlers) {
			let passed = false
			await handler({ url, headers: { host: 'localhost:4321' } }, res, () => (passed = true))
			if (!passed) break
		}
		return sent
	}

	function withPages(pages: Array<[string, string]>) {
		return spyOn(cms, 'collectionPagesByPathname').mockResolvedValue(
			new Map(pages.map(([pathname, slug]) => [pathname, { name: 'news', slug, file: `src/content/news/${slug}.md` }])),
		)
	}

	test('a page with an encoded URL is found by its decoded pathname', async () => {
		const find = withPages([['/aktuality/škola', 'škola']])
		try {
			const markdown = await request('/aktuality/%C5%A1kola.md')
			expect(markdown).toContain('type: collection')
			expect(markdown).toContain('Zápis do školy.')
		} finally {
			find.mockRestore()
		}
	})

	test('a homepage an entry tells is listed even when the page cannot be fetched', async () => {
		const find = withPages([['/', 'home']])
		try {
			expect(await request('/llms.txt')).toContain('[Úvod](https://example.com/index.md)')
			expect(fetched).toHaveBeenCalled()
		} finally {
			find.mockRestore()
		}
	})
})
