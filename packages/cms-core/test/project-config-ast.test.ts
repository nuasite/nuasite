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
