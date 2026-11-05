import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { agentsSummary } from '@nuasite/agent-summary'
import { type AstroIntegration, build, dev } from 'astro'
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

	test('a config redirect reaches AGENTS.md of an agent summary listed in the site integrations', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/index.astro'), '<title>Home page</title><h1>Welcome home</h1>\n')
		await build(defineConfig({
			root,
			logLevel: 'error',
			redirects: { '/stare': { destination: '/nove', status: 301 } },
			integrations: [agentsSummary()],
			nua: { cms: false, mdx: false, sitemap: false, checks: false, pageMarkdown: false },
		}))

		expect(await readFile(path.join(root, 'AGENTS.md'), 'utf-8')).toContain(
			JSON.stringify({ kind: 'redirect', route: '/stare', to: '/nove', status: '301' }),
		)
	}, 30_000)

	test('with an adapter, which may serve redirects as routes, Astro keeps them', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/index.astro'), '<p>home</p>\n')
		await writeFile(path.join(root, 'adapter-entry.mjs'), 'export default {}\n')
		const redirectRoutes: string[] = []
		const adapter: AstroIntegration = {
			name: 'test-adapter',
			hooks: {
				'astro:config:done': ({ setAdapter }) =>
					setAdapter({
						name: 'test-adapter',
						entrypointResolution: 'auto',
						serverEntrypoint: path.join(root, 'adapter-entry.mjs'),
						supportedAstroFeatures: { staticOutput: 'stable' },
					}),
				'astro:routes:resolved': ({ routes }) => {
					// Astro resolves the routes more than once in a build; the last list is what it builds.
					redirectRoutes.length = 0
					redirectRoutes.push(...routes.filter(route => route.type === 'redirect').map(route => route.pattern))
				},
			},
		}
		await build(defineConfig({
			root,
			logLevel: 'error',
			adapter,
			redirects: { '/stare': { destination: '/nove', status: 301 } },
			nua: { cms: false, mdx: false, sitemap: false, checks: false, pageMarkdown: false },
		}))

		expect(redirectRoutes).toEqual(['/stare'])
	}, 30_000)

	test('the dev server, which has no _redirects, still answers a config redirect itself and skips one Astro rejects', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/index.astro'), '<p>home</p>\n')
		const server = await dev(defineConfig({
			root,
			logLevel: 'error',
			server: { port: 0, host: '127.0.0.1' },
			redirects: { '/stare': { destination: '/nove', status: 301 }, '/blog-old/[post-id]': '/blog' },
			nua: { cms: false, mdx: false, sitemap: false, checks: false, pageMarkdown: false },
		}))
		try {
			const response = await fetch(`http://127.0.0.1:${server.address.port}/stare`, { redirect: 'manual' })
			expect(response.status).toBe(301)
			expect(response.headers.get('location')).toBe('/nove')
		} finally {
			await server.stop()
		}
	}, 30_000)
})
