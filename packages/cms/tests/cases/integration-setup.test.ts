import type { AstroIntegration } from 'astro'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import nuaCms, { type NuaCmsOptions } from '../../src/index'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../utils/temp-directory'

// The integration's two dev hooks, driven the way Astro drives them, over a real project
// directory and a real HTTP round trip through the middlewares they register. What is under
// test is the wiring: that what the options and the Astro config say reaches the in-page
// editor's config, every scan the dev API publishes, and the local `/_nua/admin`.

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void
type Hooks = AstroIntegration['hooks']
type ConfigSetup = NonNullable<Hooks['astro:config:setup']>
type ServerSetup = NonNullable<Hooks['astro:server:setup']>

const CONTENT_CONFIG = `import { defineCmsCollection, n } from '@nuasite/cms'
const blog = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { label: 'Články' },
})
export const collections = { blog }
`

/** An Astro config source. `defineConfig` is Astro's unless the case is about the nua wrapper's. */
const astroConfig = (body: string, defineConfigFrom = 'astro/config') =>
	`import nuaCms from '@nuasite/cms'
import { defineConfig } from '${defineConfigFrom}'
export default defineConfig(${body})
`

/** Narrow `unknown` to a record so property reads typecheck without casts. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

describe('nuaCms integration — dev setup wiring', () => {
	let ctx: TempDirContext
	let httpServer: Server | undefined

	beforeEach(async () => {
		// `createTempDir` also makes the directory the cwd, which is the project root the hooks use.
		ctx = await createTempDir('integration-setup-')
		await ctx.writeFile('src/content/blog/hello.md', '---\ntitle: Hello\n---\n')
		await ctx.writeFile('src/content.config.ts', CONTENT_CONFIG)
	})

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>(resolve => httpServer?.close(() => resolve()))
			httpServer = undefined
		}
		await cleanupTempDir(ctx)
	})

	/** Run `astro:config:setup` and `astro:server:setup`, then serve the registered middlewares. */
	async function startDev(options: NuaCmsOptions): Promise<{ baseUrl: string; injected: string; warnings: string[] }> {
		// An explicit editor `src` keeps the hook off the bundled-editor branch (which depends on
		// whether `dist/editor.js` happens to be built); `local` mode registers `/_nua/admin`.
		const integration = nuaCms({ src: '/editor.js', mode: 'local', ...options })
		const warnings: string[] = []
		const injected: string[] = []
		const logger = { info() {}, debug() {}, error() {}, warn: (message: string) => void warnings.push(message) }

		// Only what the hooks read is stubbed; Astro passes far more.
		const configSetup = {
			command: 'dev',
			logger,
			updateConfig: () => ({}),
			injectRoute() {},
			injectScript: (_stage: string, content: string) => void injected.push(content),
		} as unknown as Parameters<ConfigSetup>[0]
		await integration.hooks['astro:config:setup']?.(configSetup)

		const middlewares: Middleware[] = []
		const serverSetup = {
			logger,
			server: {
				middlewares: { use: (middleware: Middleware) => void middlewares.push(middleware) },
				transformIndexHtml: async (_url: string, html: string) => html,
			},
		} as unknown as Parameters<ServerSetup>[0]
		await integration.hooks['astro:server:setup']?.(serverSetup)

		httpServer = createHttpServer((req, res) => {
			let index = 0
			const next = () => {
				const middleware = middlewares[index++]
				if (middleware) middleware(req, res, next)
				else res.writeHead(404).end('not handled')
			}
			next()
		})
		await new Promise<void>(resolve => httpServer?.listen(0, '127.0.0.1', resolve))
		const address = httpServer.address()
		if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
		return { baseUrl: `http://127.0.0.1:${address.port}`, injected: injected.join('\n'), warnings }
	}

	/** `window.NuaCmsConfig` as the injected page script sets it. */
	function injectedConfig(script: string): Record<string, unknown> {
		const match = /window\.NuaCmsConfig = (\{.*?\});/.exec(script)
		const parsed: unknown = match?.[1] ? JSON.parse(match[1]) : undefined
		if (!isRecord(parsed)) throw new Error('window.NuaCmsConfig was not injected')
		return parsed
	}

	async function collectionLabel(url: string, pick: (body: unknown) => unknown): Promise<unknown> {
		const body: unknown = await (await Bun.fetch(url)).json()
		const blog = pick(body)
		return isRecord(blog) ? blog.label : undefined
	}
	const fromManifest = (body: unknown) => (isRecord(body) && isRecord(body.collectionDefinitions) ? body.collectionDefinitions.blog : undefined)
	const fromList = (body: unknown) => (Array.isArray(body) ? body.find(item => isRecord(item) && item.name === 'blog') : undefined)

	describe('the project locale reaches window.NuaCmsConfig', () => {
		test('from the nua.cms block', async () => {
			await ctx.writeFile('astro.config.ts', astroConfig(`{ nua: { cms: { cmsConfig: { locale: 'cs' } } } }`, '@nuasite/nua/config'))
			const { injected, warnings } = await startDev({ cmsConfig: { locale: 'cs' } })
			expect(injectedConfig(injected).locale).toBe('cs')
			expect(warnings).toEqual([])
		})

		test('from the integration called directly in `integrations`', async () => {
			await ctx.writeFile('astro.config.ts', astroConfig(`{ integrations: [nuaCms({ cmsConfig: { locale: 'cs' } })] }`))
			const { injected, warnings } = await startDev({ cmsConfig: { locale: 'cs' } })
			expect(injectedConfig(injected).locale).toBe('cs')
			expect(warnings).toEqual([])
		})

		test('from i18n.defaultLocale when no cmsConfig.locale is set', async () => {
			await ctx.writeFile('astro.config.ts', astroConfig(`{ i18n: { defaultLocale: 'cs', locales: ['cs'] }, integrations: [nuaCms()] }`))
			const { injected, warnings } = await startDev({})
			expect(injectedConfig(injected).locale).toBe('cs')
			expect(warnings).toEqual([])
		})

		test('a locale the config source does not show is dropped, and the dev server says so', async () => {
			// The integration holds 'cs' at runtime, but a standalone sidecar could not read it —
			// so the editor is not told either, rather than the two disagreeing in silence.
			await ctx.writeFile('astro.config.ts', astroConfig(`{ integrations: [nuaCms({ cmsConfig: { locale: process.env.CMS_LOCALE } })] }`))
			const { injected, warnings } = await startDev({ cmsConfig: { locale: 'cs' } })
			expect('locale' in injectedConfig(injected)).toBe(false)
			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain('cmsConfig.locale "cs"')
			expect(warnings[0]).toContain('no locale is used')
		})

		test('a literal locale on a CMS instance that is not the one in effect: the warning does not blame the literal', async () => {
			// The nua wrapper runs its own CMS behind this one, and that is the instance a page gets.
			// The locale here *is* a string literal, so "declare it as a literal" would be no help.
			await ctx.writeFile('astro.config.ts', astroConfig(`{ integrations: [nuaCms({ cmsConfig: { locale: 'cs' } })] }`, '@nuasite/nua/config'))
			const { injected, warnings } = await startDev({ cmsConfig: { locale: 'cs' } })
			expect('locale' in injectedConfig(injected)).toBe(false)
			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain('another CMS instance')
		})

		test('a locale the source does not show loses to i18n.defaultLocale, and the warning names what is used', async () => {
			const source = `{ i18n: { defaultLocale: 'en', locales: ['en', 'cs'] }, integrations: [nuaCms({ cmsConfig: { locale: pickLocale() } })] }`
			await ctx.writeFile('astro.config.ts', astroConfig(source))
			const { injected, warnings } = await startDev({ cmsConfig: { locale: 'cs' } })
			// What the sidecar reads from the same file is `en`, so that is what the editor gets.
			expect(injectedConfig(injected).locale).toBe('en')
			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain('cmsConfig.locale "cs"')
			expect(warnings[0]).toContain('"en" is used')
			expect(warnings[0]).toContain('string literal')
		})

		test('the rest of cmsConfig is passed through as before', async () => {
			await ctx.writeFile('astro.config.ts', astroConfig(`{ integrations: [nuaCms()] }`))
			const config = injectedConfig((await startDev({ cmsConfig: { debug: true, highlightColor: '#ff0000' } })).injected)
			expect(config.debug).toBe(true)
			expect(config.highlightColor).toBe('#ff0000')
			expect(config.apiBase).toBe('/_nua/cms')
			expect('locale' in config).toBe(false)
		})
	})

	describe('nua.cms.collections overrides reach everything the dev server serves', () => {
		const OVERRIDES: NuaCmsOptions = { collections: { blog: { label: 'Aktuality' } } }

		test('the startup scan', async () => {
			const { baseUrl } = await startDev(OVERRIDES)
			expect(await collectionLabel(`${baseUrl}/cms-manifest.json`, fromManifest)).toBe('Aktuality')
		})

		test('the rescan an entry create triggers', async () => {
			const { baseUrl } = await startDev(OVERRIDES)

			const created = await Bun.fetch(`${baseUrl}/_nua/cms/markdown/create`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ collection: 'blog', title: 'Second', slug: 'second' }),
			})
			expect(created.status).toBe(200)

			const manifest: unknown = await (await Bun.fetch(`${baseUrl}/cms-manifest.json`)).json()
			const blog = fromManifest(manifest)
			// The rescan happened — the new entry is counted — and the label did not fall back to `cms.label`.
			expect(isRecord(blog) ? blog.entryCount : undefined).toBe(2)
			expect(isRecord(blog) ? blog.label : undefined).toBe('Aktuality')
		})

		test('the local /_nua/admin sidecar', async () => {
			const { baseUrl } = await startDev(OVERRIDES)
			expect(await collectionLabel(`${baseUrl}/_nua/cms-admin-api/cms/v1/collections`, fromList)).toBe('Aktuality')
		})

		test('without overrides, cms.label is what is served', async () => {
			const { baseUrl } = await startDev({})
			expect(await collectionLabel(`${baseUrl}/cms-manifest.json`, fromManifest)).toBe('Články')
			expect(await collectionLabel(`${baseUrl}/_nua/cms-admin-api/cms/v1/collections`, fromList)).toBe('Články')
		})
	})
})
