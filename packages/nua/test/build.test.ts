import { build } from 'astro'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import nua from '../src/integration'

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
		await build({
			root,
			logLevel: 'error',
			integrations: [nua({ cms: false, mdx: false, sitemap: false, checks: false, pageMarkdown: false })],
		})

		const html = await readFile(path.join(root, 'dist/post/index.html'), 'utf-8')
		expect(html).toContain('<ul class="dots">')
		expect(html).toContain('src="https://www.youtube-nocookie.com/embed/abc_123"')
	}, 30_000)
})
