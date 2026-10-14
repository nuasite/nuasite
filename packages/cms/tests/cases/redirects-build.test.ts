import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import type { AstroConfig, AstroIntegration, AstroIntegrationLogger } from 'astro'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resetProjectRoot, setProjectRoot } from '../../src/config'
import nuaCms from '../../src/index'
import { astroRedirectLines, mergeConfigRedirectsInto } from '../../src/redirects'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../utils/temp-directory'

// `dist/_redirects` gets rules from three places. Astro copies `public/_redirects`; nua merges the
// config's `redirects` into that copy (`mergeConfigRedirectsInto`, what its build hook calls); the CMS
// integration merges `src/_redirects` in last. Each step used to write on its own, and a path
// redirected both in code and in the CMS was listed twice, which Cloudflare Pages answers by
// rejecting the deploy.

type BuildDone = NonNullable<AstroIntegration['hooks']['astro:build:done']>

describe('_redirects in the build output', () => {
	let ctx: TempDirContext
	const warnings: string[] = []
	const logger = {
		info: () => {},
		warn: (message: string) => warnings.push(message),
	} as unknown as AstroIntegrationLogger

	beforeEach(async () => {
		ctx = await createTempDir('redirects-build-')
		// The root the dev editor writes `src/_redirects` under, which the build reads.
		setProjectRoot(ctx.tempDir)
		warnings.length = 0
	})

	afterEach(async () => {
		resetProjectRoot()
		await cleanupTempDir(ctx)
	})

	const dist = () => pathToFileURL(path.join(ctx.tempDir, 'dist') + '/')
	const output = () => fs.readFile(path.join(ctx.tempDir, 'dist/_redirects'), 'utf-8')
	const rules = (text: string) => text.split('\n').filter(l => l && !l.startsWith('#'))

	const nuaStep = (redirects: AstroConfig['redirects']) => mergeConfigRedirectsInto(dist(), logger, redirects, false)
	const cmsStep = () => (nuaCms().hooks['astro:build:done'] as BuildDone)({ dir: dist(), logger } as Parameters<BuildDone>[0])

	test('a path redirected in code and in the CMS ends up listed once, with the CMS rule first', async () => {
		await ctx.writeFile('dist/_redirects', '/letaky/a/a.pdf https://cdn.example/a.pdf 301\n/letaky/:slug/:file https://cdn.example/:slug/:file 301\n')
		await ctx.writeFile('src/_redirects', '/info/obcane-eu /pusobnost/obcane-eu\n\n/letaky/a/a.pdf /uploads/new.pdf\n')

		await nuaStep({ '/stare': { destination: '/nove', status: 301 } })
		await cmsStep()

		expect(rules(await output())).toEqual([
			'/info/obcane-eu /pusobnost/obcane-eu',
			'/letaky/a/a.pdf /uploads/new.pdf',
			'/letaky/:slug/:file https://cdn.example/:slug/:file 301',
			'/stare /nove 301',
		])
		expect(warnings).toEqual([
			'Redirect dist/_redirects:3 "/letaky/a/a.pdf https://cdn.example/a.pdf 301" is overridden by src/_redirects:3 "/letaky/a/a.pdf /uploads/new.pdf"',
		])
	})

	test('the rules of public/_redirects survive the config redirects and win over them', async () => {
		await ctx.writeFile('dist/_redirects', '/rucne /napsane 301\n/spolecna /z-public 301\n')

		await nuaStep({ '/z-configu': '/jinam', '/spolecna': '/z-configu' })

		expect(rules(await output())).toEqual(['/rucne /napsane 301', '/spolecna /z-public 301', '/z-configu /jinam 307'])
	})

	test('a hand-written file nothing is merged into is left exactly as written', async () => {
		const written = '# Legacy URLs\n/* /cs/:splat 302 Language=cs\n/   /en   302\n'
		await ctx.writeFile('dist/_redirects', written)

		await nuaStep({})
		await cmsStep()

		expect(await output()).toBe(written)
	})

	// The file a host rejects is the one that lists a source twice, wherever the repeat came from.
	test('a source a hand-written file lists twice is written once', async () => {
		await ctx.writeFile('dist/_redirects', '/a /b 301\n/a /c 301\n/d /e 301\n/d /e 301\n')

		await nuaStep({})
		await cmsStep()

		expect(rules(await output())).toEqual(['/a /b 301', '/d /e 301'])
	})

	test('running the steps again leaves the file as it is', async () => {
		await ctx.writeFile('dist/_redirects', '/a /b 301\n/p/* /q/:splat 301\n')
		await ctx.writeFile('src/_redirects', '/a /c\n')
		await nuaStep({ '/d': '/e' })
		await cmsStep()
		const first = await output()

		await nuaStep({ '/d': '/e' })
		await cmsStep()

		expect(await output()).toBe(first)
	})

	test('a Netlify role gate, which has no destination, ships exactly as written', async () => {
		const written = '/admin/*  200!  Role=admin\n/admin/* /login 401!\n'
		await ctx.writeFile('dist/_redirects', written)

		await nuaStep({})
		await cmsStep()

		expect(await output()).toBe(written)
		expect(warnings).toEqual([])
	})

	test('a line not read as a rule keeps its place when other rules are merged around it', async () => {
		await ctx.writeFile('dist/_redirects', '/admin/*  200!  Role=admin\n/a /b 301\n')
		await ctx.writeFile('src/_redirects', '/a /c\n')

		await nuaStep({})
		await cmsStep()

		expect(rules(await output())).toEqual(['/a /c', '/admin/*  200!  Role=admin'])
	})

	// Listed first, an editor's rule would otherwise take precedence over access control in code.
	test('a CMS rule cannot undo a guard from code, nor proxy', async () => {
		await ctx.writeFile('dist/_redirects', '/admin/*  200!  Role=admin\n/admin/* /login 401!\n/letaky/a.pdf https://cdn/a.pdf 301\n')
		await ctx.writeFile('src/_redirects', '/admin/* /otevreno 301\n/vsechno/* https://jinde.example/:splat 200\n/letaky/a.pdf /uploads/a.pdf\n')

		await cmsStep()

		expect(rules(await output())).toEqual(['/letaky/a.pdf /uploads/a.pdf', '/admin/*  200!  Role=admin', '/admin/* /login 401!'])
		expect(warnings).toEqual([
			'Redirect dist/_redirects:3 "/letaky/a.pdf https://cdn/a.pdf 301" is overridden by src/_redirects:3 "/letaky/a.pdf /uploads/a.pdf"',
			'Left out redirect src/_redirects:1 "/admin/* /otevreno 301": /admin/* is guarded in code',
			'Left out redirect src/_redirects:2 "/vsechno/* https://jinde.example/:splat 200": only a redirect with a 3xx status and no conditions is allowed here',
		])
	})

	test('a project with no redirects anywhere gets no file', async () => {
		await fs.mkdir(path.join(ctx.tempDir, 'dist'), { recursive: true })

		await nuaStep({})
		await cmsStep()

		expect(await fs.access(path.join(ctx.tempDir, 'dist/_redirects')).then(() => true, () => false)).toBe(false)
	})
})

describe('astroRedirectLines', () => {
	test('reads paths as root-relative and route params as the host placeholders', () => {
		expect(
			astroRedirectLines({
				'config': 'new-config',
				'/blog/[slug]': { destination: '/articles/[slug]', status: 301 },
				'/docs/[...path]': '/guide/[...path]',
				'/posts/[post_id]': 'https://example.com/p/[post_id]',
				'/cdn': '//cdn.example.com/file',
			}).split('\n'),
		).toEqual([
			'/config /new-config 307',
			'/blog/:slug /articles/:slug 301',
			'/docs/* /guide/:splat 307',
			'/posts/:post_id https://example.com/p/:post_id 307',
			'/cdn //cdn.example.com/file 307',
		])
	})
})

describe('editing a CMS redirect', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		ctx = await createTempDir('redirects-edit-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	// The editor list only shows a line the build can read, so a rule saved in any other shape could
	// neither be seen nor fixed there, and the build would leave it out.
	test('an edit is held to the same rules as the build', async () => {
		await ctx.writeFile('src/_redirects', '/old /new\n/other /x\n')
		const core = createCmsCore(createNodeFs(ctx.tempDir))
		const edit = (source: string, destination: string) => core.updateRedirect({ lineIndex: 0, source, destination })

		expect(await edit('stara-stranka', '/nova')).toEqual({ success: false, error: 'Source must start with /' })
		expect(await edit('/old', 'http:example.com')).toEqual({ success: false, error: 'Destination must start with / or http:// or https://' })
		expect(await edit('/old', '/a b')).toEqual({ success: false, error: 'Source and destination must not contain spaces' })
		// The build keeps the first rule for a source, so a second one would save and never apply.
		expect(await edit('/other', '/y')).toEqual({ success: false, error: 'Redirect already exists for /other' })
		expect((await core.updateRedirect({ lineIndex: 0, source: '/old', destination: 'https://elsewhere.example/', statusCode: 200 })).success).toBe(
			false,
		)
		expect(await core.updateRedirect({ lineIndex: 0, source: '/old', destination: '/new', statusCode: 3011 })).toEqual({
			success: false,
			error: 'Status must be a redirect: 301, 302, 303, 307 or 308',
		})
		expect(await fs.readFile(path.join(ctx.tempDir, 'src/_redirects'), 'utf-8')).toBe('/old /new\n/other /x\n')
	})

	test('a rule whose source another line repeats can still be edited in place', async () => {
		await ctx.writeFile('src/_redirects', '/a /b\n/a /c\n')
		const core = createCmsCore(createNodeFs(ctx.tempDir))

		expect(await core.updateRedirect({ lineIndex: 0, source: '/a', destination: '/d' })).toEqual({ success: true })
		expect(await fs.readFile(path.join(ctx.tempDir, 'src/_redirects'), 'utf-8')).toBe('/a /d\n/a /c\n')
	})

	test('the editor reads a rule the way the build does', async () => {
		await ctx.writeFile('src/_redirects', '/store id=:id /blog/:id 301\n/b /c 302!\n')
		const core = createCmsCore(createNodeFs(ctx.tempDir))

		const { rules } = await core.listRedirects()

		expect(rules.map(r => [r.source, r.destination, r.statusCode])).toEqual([['/store', '/blog/:id', 301], ['/b', '/c', 302]])
	})
})
