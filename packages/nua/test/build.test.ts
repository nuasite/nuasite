import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { build } from 'astro'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from '../src/config'

// The test preload registers happy-dom, whose timers return numbers. Vite 8 calls `.unref()` on a
// `setTimeout` handle while it starts, so the build runs on the runtime's own globals.
beforeAll(() => GlobalRegistrator.unregister())
afterAll(() => GlobalRegistrator.register({ settings: { fetch: { disableSameOriginPolicy: true } } }))

// A real Astro project per case. It lives next to this file so the project resolves `astro`.
let root = ''

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe('Markdown', () => {
	test('a page renders the CMS list and YouTube directives through the portable plugins', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/post.md'), ':::list{.dots}\n- one\n:::\n\n::youtube{#abc_123}\n')
		await build(defineConfig({
			root,
			logLevel: 'error',
			nua: { cms: false, mdx: false, sitemap: false, checks: false, pageMarkdown: false },
		}))

		const html = await readFile(path.join(root, 'dist/post/index.html'), 'utf-8')
		expect(html).toContain('<ul class="dots">')
		expect(html).toContain('src="https://www.youtube-nocookie.com/embed/abc_123"')
	}, 30_000)
})

describe('Redirects', () => {
	test('a config redirect ships as a _redirects rule only, with no Astro page at its source', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/index.astro'), '<p>home</p>\n')
		await build(defineConfig({
			root,
			logLevel: 'error',
			redirects: { '/stare': { destination: '/nove', status: 301 }, '/letaky/a.pdf': '/uploads/a.pdf' },
			nua: { cms: false, mdx: false, sitemap: false, checks: false, pageMarkdown: false },
		}))

		const rules = (await readFile(path.join(root, 'dist/_redirects'), 'utf-8')).split('\n').filter(l => l && !l.startsWith('#'))
		expect(rules).toEqual(['/stare /nove 301', '/letaky/a.pdf /uploads/a.pdf 307'])
		expect((await readdir(path.join(root, 'dist'))).sort()).toEqual(['_redirects', 'index.html'])
	}, 30_000)
})
