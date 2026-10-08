import { createNodeFs, parseProjectCmsConfig, parseProjectCmsConfigSource } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const LIST_STYLES = [
	{ label: 'Fajfky', class: 'checkmarks' },
	{ label: 'Růžové tečky', class: 'dots-pink' },
]

const CONFIG_SOURCE = `
	import { defineConfig } from '@nuasite/nua/config'

	export default defineConfig({
		nua: {
			cms: {
				cmsConfig: {
					listStyles: [
						{ label: 'Fajfky', class: 'checkmarks' },
						{ label: 'Růžové tečky', class: 'dots-pink' },
					],
				},
			},
		},
	})
`

const tempDirs: string[] = []

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

async function tempRootWith(file: string, contents: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nua-config-'))
	tempDirs.push(dir)
	await fs.writeFile(path.join(dir, file), contents)
	return dir
}

describe('parseProjectCmsConfigSource', () => {
	test('extracts list styles from a config source string', () => {
		const config = parseProjectCmsConfigSource(CONFIG_SOURCE)
		expect(config.listStyles).toEqual(LIST_STYLES)
	})

	test('returns an empty list when listStyles is absent', () => {
		const config = parseProjectCmsConfigSource(`
			import { defineConfig } from '@nuasite/nua/config'

			export default defineConfig({
				nua: {
					cms: {
						cmsConfig: {
							openMetadataByDefault: true,
						},
					},
				},
			})
		`)

		expect(config.listStyles).toEqual([])
	})
})

// The project's language is what collection labels are compared in. Astro already has a
// place for it, so it is read from there rather than asked for a second time.
describe('parseProjectCmsConfigSource — locale from i18n.defaultLocale', () => {
	const withI18n = (i18n: string, prelude = '') => `
		import { defineConfig } from '@nuasite/nua/config'
		${prelude}
		export default defineConfig({
			i18n: ${i18n},
		})
	`

	test('reads the default locale', () => {
		expect(parseProjectCmsConfigSource(withI18n(`{ defaultLocale: 'cs', locales: ['cs', 'en'] }`)).locale).toBe('cs')
	})

	test('is independent of the nua block — either may be absent', () => {
		const config = parseProjectCmsConfigSource(withI18n(`{ defaultLocale: 'cs', locales: ['cs'] }`))
		expect(config).toEqual({ listStyles: [], locale: 'cs' })
		expect(parseProjectCmsConfigSource(CONFIG_SOURCE)).toEqual({ listStyles: LIST_STYLES })
	})

	test('resolves a top-level const', () => {
		expect(parseProjectCmsConfigSource(withI18n('{ defaultLocale: DEFAULT_LOCALE }', `const DEFAULT_LOCALE = 'cs'`)).locale).toBe('cs')
	})

	test('a value it cannot read statically, or an empty one, is left out', () => {
		expect('locale' in parseProjectCmsConfigSource(withI18n('{ defaultLocale: process.env.LOCALE }'))).toBe(false)
		expect('locale' in parseProjectCmsConfigSource(withI18n('{ defaultLocale: DEFAULT_LOCALE }', `import { DEFAULT_LOCALE } from './i18n'`))).toBe(
			false,
		)
		expect('locale' in parseProjectCmsConfigSource(withI18n(`{ defaultLocale: '' }`))).toBe(false)
		expect('locale' in parseProjectCmsConfigSource(withI18n(`{ locales: ['cs'] }`))).toBe(false)
	})

	test('is served as declared, tag or not', () => {
		// Astro accepts a path here; whether it is usable as a locale is the consumer's question.
		expect(parseProjectCmsConfigSource(withI18n(`{ defaultLocale: 'spanish' }`)).locale).toBe('spanish')
	})
})

// Most sites are single-language and have no `i18n` block, and adding one changes how Astro
// routes. `nua.cms.cmsConfig.locale` names the language without touching that, and wins.
describe('parseProjectCmsConfigSource — explicit locale from nua.cms.cmsConfig', () => {
	const config = (cmsConfig: string, i18n?: string, prelude = '') => `
		import { defineConfig } from '@nuasite/nua/config'
		${prelude}
		export default defineConfig({
			${i18n === undefined ? '' : `i18n: ${i18n},`}
			nua: { cms: { cmsConfig: ${cmsConfig} } },
		})
	`

	test('is read on its own, with no i18n block', () => {
		expect(parseProjectCmsConfigSource(config(`{ locale: 'cs' }`))).toEqual({ listStyles: [], locale: 'cs' })
	})

	test('precedence: explicit, then i18n.defaultLocale, then nothing', () => {
		expect(parseProjectCmsConfigSource(config(`{ locale: 'cs' }`, `{ defaultLocale: 'en', locales: ['en', 'cs'] }`)).locale).toBe('cs')
		expect(parseProjectCmsConfigSource(config(`{ openMetadataByDefault: true }`, `{ defaultLocale: 'en', locales: ['en', 'cs'] }`)).locale).toBe('en')
		expect('locale' in parseProjectCmsConfigSource(config(`{ openMetadataByDefault: true }`))).toBe(false)
	})

	test('sits next to listStyles in the same block', () => {
		const parsed = parseProjectCmsConfigSource(config(`{ locale: 'cs', listStyles: [{ label: 'Fajfky', class: 'checkmarks' }] }`))
		expect(parsed).toEqual({ listStyles: [{ label: 'Fajfky', class: 'checkmarks' }], locale: 'cs' })
	})

	test('resolves a top-level const', () => {
		expect(parseProjectCmsConfigSource(config('{ locale: LOCALE }', undefined, `const LOCALE = 'cs'`)).locale).toBe('cs')
	})

	test('a non-literal explicit locale counts as absent: i18n.defaultLocale applies, or nothing', () => {
		for (const unreadable of ['process.env.CMS_LOCALE', 'pickLocale()', '42', `''`]) {
			expect(parseProjectCmsConfigSource(config(`{ locale: ${unreadable} }`, `{ defaultLocale: 'en' }`)).locale).toBe('en')
			expect('locale' in parseProjectCmsConfigSource(config(`{ locale: ${unreadable} }`))).toBe(false)
		}
		// An import is as opaque to the source reader as a call.
		const imported = config('{ locale: LOCALE }', undefined, `import { LOCALE } from './site'`)
		expect('locale' in parseProjectCmsConfigSource(imported)).toBe(false)
	})
})

// The CMS options do not have to sit in the `nua.cms` block: both READMEs document calling
// the integration directly. The integration gets the value either way, so the source reader
// has to find it either way — or the sidecar and the in-page editor are told different things.
describe('parseProjectCmsConfigSource — the integration called directly in `integrations`', () => {
	const CMS_CONFIG = `{ locale: 'cs', listStyles: [{ label: 'Fajfky', class: 'checkmarks' }] }`
	const EXPECTED = { listStyles: [{ label: 'Fajfky', class: 'checkmarks' }], locale: 'cs' }

	test('nuaCms({ cmsConfig }) from @nuasite/cms', () => {
		const parsed = parseProjectCmsConfigSource(`
			import nuaCms from '@nuasite/cms'
			import { defineConfig } from 'astro/config'
			export default defineConfig({ integrations: [nuaCms({ cmsConfig: ${CMS_CONFIG} })] })
		`)
		expect(parsed).toEqual(EXPECTED)
	})

	test('nua({ cms: { cmsConfig } }) from @nuasite/nua/integration and from @nuasite/nua', () => {
		for (const importLine of [`import nua from '@nuasite/nua/integration'`, `import nua from '@nuasite/nua'`, `import { nua } from '@nuasite/nua'`]) {
			const parsed = parseProjectCmsConfigSource(`
				${importLine}
				import { defineConfig } from 'astro/config'
				export default defineConfig({ integrations: [mdx(), nua({ cms: { cmsConfig: ${CMS_CONFIG} } })] })
			`)
			expect(parsed).toEqual(EXPECTED)
		}
	})

	test('the call is recognised by its import, whatever it is named locally', () => {
		const parsed = parseProjectCmsConfigSource(`
			import { default as cms } from '@nuasite/cms'
			const cmsOptions = { cmsConfig: ${CMS_CONFIG} }
			const cmsIntegration = cms(cmsOptions)
			export default { integrations: [cmsIntegration] }
		`)
		expect(parsed).toEqual(EXPECTED)
	})

	test('a same-named function from somewhere else is not the integration', () => {
		const parsed = parseProjectCmsConfigSource(`
			import nuaCms from './my-cms'
			export default { integrations: [nuaCms({ cmsConfig: ${CMS_CONFIG} })] }
		`)
		expect(parsed).toEqual({ listStyles: [] })
	})

	test('i18n.defaultLocale still backs up a direct call that declares no locale', () => {
		const parsed = parseProjectCmsConfigSource(`
			import nuaCms from '@nuasite/cms'
			export default { i18n: { defaultLocale: 'cs' }, integrations: [nuaCms({ cmsConfig: { locale: process.env.CMS_LOCALE } }), nuaCms()] }
		`)
		expect(parsed.locale).toBe('cs')
	})

	test('the nua.cms block is consulted first', () => {
		const parsed = parseProjectCmsConfigSource(`
			import nuaCms from '@nuasite/cms'
			import { defineConfig } from '@nuasite/nua/config'
			export default defineConfig({
				integrations: [nuaCms({ cmsConfig: { locale: 'en' } })],
				nua: { cms: { cmsConfig: { locale: 'cs' } } },
			})
		`)
		expect(parsed.locale).toBe('cs')
	})
})

// Which `cmsConfig` the page ends up with, pinned as a whole. A config can hand the CMS its
// options through the `nua` key of the nua wrapper, through `nua()` or through `nuaCms()`, and
// one that uses several runs several CMS instances: every one assigns `window.NuaCmsConfig`
// and the page keeps the last. The reader answers from that one instance — never `listStyles`
// from one and `locale` from another.
//
// The expectations are not derived from reading hook code (that went wrong twice). Each row
// marked ✓ was run through Astro 6.1.4's own dev setup (`resolveConfig`, `createSettings`,
// `runHookConfigSetup`), its injected page scripts evaluated in order, and the resulting
// `window.NuaCmsConfig` compared with this reader. That run takes seconds per config and
// leans on Astro internals, so it lives outside the suite; this table is its record.
describe('parseProjectCmsConfigSource — which CMS instance the page gets', () => {
	/** `defineConfig` from the nua wrapper: it adds the nua integration by itself. */
	const WRAPPER = `import { defineConfig } from '@nuasite/nua/config'`
	/** Astro's own `defineConfig`: nothing reads a `nua` key. */
	const ASTRO = `import { defineConfig } from 'astro/config'`

	const parse = (defineConfigImport: string, body: string, exported = `defineConfig(${body})`) =>
		parseProjectCmsConfigSource(`
			import nuaCms from '@nuasite/cms'
			import nua from '@nuasite/nua'
			${defineConfigImport}
			export default ${exported}
		`)

	/** An options object whose `cmsConfig` is recognisable in the answer by its list style, with an optional locale. */
	const cms = (name: string, locale?: string) =>
		`{ cmsConfig: { ${locale ? `locale: '${locale}', ` : ''}listStyles: [{ label: '${name}', class: '${name}' }] } }`
	const from = (name: string, locale?: string) => ({ listStyles: [{ label: name, class: name }], ...(locale ? { locale } : {}) })
	const NOTHING = { listStyles: [] }

	const rows: Array<[name: string, defineConfigImport: string, body: string, expected: object]> = [
		// One instance, each way of declaring it. ✓
		['wrapper: the nua.cms block', WRAPPER, `{ nua: { cms: ${cms('block', 'cs')} } }`, from('block', 'cs')],
		['wrapper: the block through a top-level const', WRAPPER, `{ nua: { cms: BLOCK } }`, from('block', 'cs')],
		['wrapper: no nua key at all', WRAPPER, `{}`, NOTHING],
		['wrapper: a block that declares only a locale', WRAPPER, `{ nua: { cms: { cmsConfig: { locale: 'cs' } } } }`, { listStyles: [], locale: 'cs' }],
		['astro: nuaCms()', ASTRO, `{ integrations: [nuaCms(${cms('cms', 'cs')})] }`, from('cms', 'cs')],
		['astro: nua({ cms })', ASTRO, `{ integrations: [nua({ cms: ${cms('nua', 'cs')} })] }`, from('nua', 'cs')],
		['astro: a non-literal locale is not read', ASTRO, `{ integrations: [nuaCms({ cmsConfig: { locale: process.env.NOPE ?? 'cs' } })] }`, NOTHING],

		// The wrapper always runs nua, and nua's CMS registers behind every listed nuaCms(). ✓
		['wrapper, no nua key + nuaCms(): the wrapper', WRAPPER, `{ integrations: [nuaCms(${cms('cms', 'cs')})] }`, NOTHING],
		['wrapper, nua: {} + nuaCms(): the wrapper', WRAPPER, `{ nua: {}, integrations: [nuaCms(${cms('cms', 'cs')})] }`, NOTHING],
		['wrapper, cms: true + nuaCms(): the wrapper', WRAPPER, `{ nua: { cms: true }, integrations: [nuaCms(${cms('cms', 'cs')})] }`, NOTHING],
		[
			'wrapper, another nua option + nuaCms(): the wrapper',
			WRAPPER,
			`{ nua: { sitemap: false }, integrations: [nuaCms(${cms('cms', 'cs')})] }`,
			NOTHING,
		],
		[
			'wrapper block + nuaCms(): the block, whole',
			WRAPPER,
			`{ nua: { cms: ${cms('block', 'cs')} }, integrations: [nuaCms(${cms('cms', 'de')})] }`,
			from('block', 'cs'),
		],
		[
			'wrapper block without cmsConfig + nuaCms(): still the block',
			WRAPPER,
			`{ nua: { cms: { usePolling: false } }, integrations: [nuaCms(${cms('cms', 'cs')})] }`,
			NOTHING,
		],
		// …unless the wrapper is told not to run nua, or nua not to run a CMS. ✓
		['wrapper, cms: false + nuaCms(): the call', WRAPPER, `{ nua: { cms: false }, integrations: [nuaCms(${cms('cms', 'cs')})] }`, from('cms', 'cs')],
		['wrapper, nua: false + nuaCms(): the call', WRAPPER, `{ nua: false, integrations: [nuaCms(${cms('cms', 'cs')})] }`, from('cms', 'cs')],
		['wrapper, nua: false + nua({ cms }): the call', WRAPPER, `{ nua: false, integrations: [nua({ cms: ${cms('nua', 'cs')} })] }`, from('nua', 'cs')],

		// Under Astro's defineConfig only the calls count; a `nua` key is not read by anything. ✓
		[
			'astro: a stray nua key is ignored',
			ASTRO,
			`{ nua: { cms: ${cms('block', 'de')} }, integrations: [nuaCms(${cms('cms', 'cs')})] }`,
			from('cms', 'cs'),
		],
		[
			'astro: of two nuaCms() calls, the later',
			ASTRO,
			`{ integrations: [nuaCms(${cms('first', 'cs')}), nuaCms(${cms('second', 'de')})] }`,
			from('second', 'de'),
		],
		['astro: a later bare nuaCms() leaves nothing to read', ASTRO, `{ integrations: [nuaCms(${cms('first', 'cs')}), nuaCms()] }`, NOTHING],
		[
			'astro: nua({ cms }) before nuaCms(): nua',
			ASTRO,
			`{ integrations: [nua({ cms: ${cms('nua', 'cs')} }), nuaCms(${cms('cms', 'de')})] }`,
			from('nua', 'cs'),
		],
		[
			'astro: nuaCms() before nua({ cms }): nua',
			ASTRO,
			`{ integrations: [nuaCms(${cms('cms', 'de')}), nua({ cms: ${cms('nua', 'cs')} })] }`,
			from('nua', 'cs'),
		],
		// A nua() with no CMS options still runs nua's default CMS, and that one wins. ✓
		['astro: nuaCms() + bare nua(): nua, with nothing to read', ASTRO, `{ integrations: [nuaCms(${cms('cms', 'cs')}), nua()] }`, NOTHING],
		[
			'astro: nuaCms() + nua({ cms: true }): nua, with nothing to read',
			ASTRO,
			`{ integrations: [nuaCms(${cms('cms', 'cs')}), nua({ cms: true })] }`,
			NOTHING,
		],
		[
			'astro: nuaCms() + nua({ cms: false }): the call',
			ASTRO,
			`{ integrations: [nuaCms(${cms('cms', 'cs')}), nua({ cms: false })] }`,
			from('cms', 'cs'),
		],

		// i18n.defaultLocale backs up whichever instance it is — it never borrows one's locale. ✓
		[
			'astro: i18n + nuaCms({ locale }) + bare nuaCms()',
			ASTRO,
			`{ i18n: { defaultLocale: 'en' }, integrations: [nuaCms(${cms('first', 'cs')}), nuaCms()] }`,
			{ listStyles: [], locale: 'en' },
		],
		['wrapper: i18n + nuaCms() without a locale', WRAPPER, `{ i18n: { defaultLocale: 'en' }, integrations: [nuaCms(${cms('cms')})] }`, {
			listStyles: [],
			locale: 'en',
		}],
		['wrapper: the block locale ahead of i18n', WRAPPER, `{ i18n: { defaultLocale: 'en' }, nua: { cms: { cmsConfig: { locale: 'cs' } } } }`, {
			listStyles: [],
			locale: 'cs',
		}],
	]

	for (const [name, defineConfigImport, body, expected] of rows) {
		test(name, () => {
			expect(parse(`const BLOCK = ${cms('block', 'cs')}\n${defineConfigImport}`, body)).toEqual(expected)
		})
	}

	test('a config exported as a plain object goes straight to Astro, so its nua key is not read', () => {
		const body = `{ nua: { cms: ${cms('block', 'de')} }, integrations: [nuaCms(${cms('cms', 'cs')})] }`
		expect(parse('', body, body)).toEqual(from('cms', 'cs'))
	})

	// Not verifiable against Astro: what a site's own wrapper does with `nua` cannot be known from
	// the config. A `nua.cms` block is taken as a sign that it is read; without one nothing is assumed.
	test('an unknown defineConfig: a nua.cms block is believed, its absence is not', () => {
		const OWN = `import { defineConfig } from './config/define'`
		expect(parse(OWN, `{ nua: { cms: ${cms('block', 'cs')} }, integrations: [nuaCms(${cms('cms', 'de')})] }`)).toEqual(from('block', 'cs'))
		expect(parse(OWN, `{ integrations: [nuaCms(${cms('cms', 'cs')})] }`)).toEqual(from('cms', 'cs'))
	})

	// Two nua integrations in one config do not work: each injects the same top-level `const`
	// into the page script, which then fails to parse. Nothing is promised for these but an answer.
	test('two nua integrations: unsupported, but the reader does not throw', () => {
		for (
			const [defineConfigImport, body] of [
				[WRAPPER, `{ nua: { cms: ${cms('block', 'cs')} }, integrations: [nua({ cms: ${cms('nua', 'de')} })] }`],
				[WRAPPER, `{ integrations: [nua({ cms: false }), nua()] }`],
				[ASTRO, `{ integrations: [nua({ cms: ${cms('first', 'cs')} }), nua({ cms: ${cms('second', 'de')} })] }`],
				[ASTRO, `{ integrations: [nua(), nua(...args), nua(options), nuaCms(...args)] }`],
			] as const
		) {
			expect(Array.isArray(parse(defineConfigImport, body).listStyles)).toBe(true)
		}
	})
})

describe('parseProjectCmsConfig', () => {
	test('reads astro.config.ts from the project root', async () => {
		const root = await tempRootWith('astro.config.ts', CONFIG_SOURCE)
		const config = await parseProjectCmsConfig(createNodeFs(root))
		expect(config.listStyles).toEqual(LIST_STYLES)
	})

	test('falls back to astro.config.mjs when .ts is absent', async () => {
		const root = await tempRootWith('astro.config.mjs', CONFIG_SOURCE)
		const config = await parseProjectCmsConfig(createNodeFs(root))
		expect(config.listStyles).toEqual(LIST_STYLES)
	})

	test('returns an empty config when no Astro config exists', async () => {
		const root = await tempRootWith('unrelated.txt', 'noop')
		const config = await parseProjectCmsConfig(createNodeFs(root))
		expect(config.listStyles).toEqual([])
	})
})
