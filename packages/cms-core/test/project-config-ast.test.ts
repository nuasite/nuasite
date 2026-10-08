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

// A config that hands the CMS its options more than once runs more than one CMS instance, and
// the page ends up with the configuration of the one that registers last. The reader answers
// from that one object — never `listStyles` from one instance and `locale` from another.
describe('parseProjectCmsConfigSource — several CMS instances in one config', () => {
	const FAJFKY = `[{ label: 'Fajfky', class: 'checkmarks' }]`
	const parse = (body: string) =>
		parseProjectCmsConfigSource(`
			import nuaCms from '@nuasite/cms'
			import nua from '@nuasite/nua/integration'
			import { defineConfig } from '@nuasite/nua/config'
			export default defineConfig(${body})
		`)

	test('the nua.cms block wins whole: nothing is borrowed from a direct call', () => {
		const parsed = parse(`{
			integrations: [nuaCms({ cmsConfig: { locale: 'cs' } })],
			nua: { cms: { cmsConfig: { listStyles: ${FAJFKY} } } },
		}`)
		expect(parsed).toEqual({ listStyles: [{ label: 'Fajfky', class: 'checkmarks' }] })
	})

	test('a nua.cms block without cmsConfig still is the instance the page gets', () => {
		const parsed = parse(`{
			integrations: [nuaCms({ cmsConfig: { locale: 'cs', listStyles: ${FAJFKY} } })],
			nua: { cms: { collections: {} } },
		}`)
		expect(parsed).toEqual({ listStyles: [] })
	})

	test('of two nuaCms() calls, the later one', () => {
		const parsed = parse(`{ integrations: [nuaCms({ cmsConfig: { locale: 'en', listStyles: ${FAJFKY} } }), nuaCms({ cmsConfig: { locale: 'cs' } })] }`)
		expect(parsed).toEqual({ listStyles: [], locale: 'cs' })
	})

	test('a later call that declares no cmsConfig leaves nothing to read', () => {
		expect(parse(`{ integrations: [nuaCms({ cmsConfig: { locale: 'cs', listStyles: ${FAJFKY} } }), nuaCms()] }`)).toEqual({ listStyles: [] })
	})

	test('nua({ cms }) registers its CMS behind everything listed, so it wins over nuaCms() wherever it stands', () => {
		const nuaCall = `nua({ cms: { cmsConfig: { locale: 'cs' } } })`
		const cmsCall = `nuaCms({ cmsConfig: { locale: 'en', listStyles: ${FAJFKY} } })`
		expect(parse(`{ integrations: [${nuaCall}, ${cmsCall}] }`)).toEqual({ listStyles: [], locale: 'cs' })
		expect(parse(`{ integrations: [${cmsCall}, ${nuaCall}] }`)).toEqual({ listStyles: [], locale: 'cs' })
	})

	test('nua({ cms: false }) runs no CMS, so it is not in the running', () => {
		const parsed = parse(`{ integrations: [nuaCms({ cmsConfig: { locale: 'cs' } }), nua({ cms: false })] }`)
		expect(parsed.locale).toBe('cs')
	})

	test('i18n.defaultLocale backs up whichever instance it is', () => {
		const parsed = parse(`{
			i18n: { defaultLocale: 'en' },
			integrations: [nuaCms({ cmsConfig: { locale: 'cs' } })],
			nua: { cms: { cmsConfig: { listStyles: ${FAJFKY} } } },
		}`)
		expect(parsed.locale).toBe('en')
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
