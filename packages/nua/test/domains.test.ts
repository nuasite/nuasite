import { build } from 'astro'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveDomainMappings } from '../src/domains'
import nua from '../src/integration'

const i18n = (prefixDefaultLocale: boolean) => ({
	defaultLocale: 'cs',
	locales: ['cs', 'sk', { path: 'en', codes: ['en', 'en-US'] }],
	routing: { prefixDefaultLocale, redirectToDefaultLocale: false, fallbackType: 'rewrite' as const },
})

describe('resolveDomainMappings', () => {
	test('the unprefixed default locale maps to the root, the others to their prefix', () => {
		expect(resolveDomainMappings(i18n(false), {
			cs: 'https://www.example.cz/',
			sk: 'https://www.example.sk',
			en: 'https://www.example.com',
		})).toEqual([
			{ origin: 'https://www.example.cz', prefix: '' },
			{ origin: 'https://www.example.sk', prefix: '/sk' },
			{ origin: 'https://www.example.com', prefix: '/en' },
		])
	})

	test('a prefixed default locale keeps its prefix', () => {
		expect(resolveDomainMappings(i18n(true), { cs: 'https://www.example.cz' })).toEqual([{ origin: 'https://www.example.cz', prefix: '/cs' }])
	})

	test('nothing to write without domains, i18n or not', () => {
		expect(resolveDomainMappings(undefined, {})).toEqual([])
	})

	test('refuses what the hosting could not serve', () => {
		expect(() => resolveDomainMappings(undefined, { sk: 'https://www.example.sk' })).toThrow('needs an `i18n` config')
		expect(() => resolveDomainMappings(i18n(false), { de: 'https://www.example.de' })).toThrow('not one of i18n.locales')
		expect(() => resolveDomainMappings(i18n(false), { sk: 'https://www.example.sk/sk' })).toThrow('bare origin')
		expect(() => resolveDomainMappings(i18n(false), { sk: 'www.example.sk' })).toThrow('bare origin')
		expect(() => resolveDomainMappings(i18n(false), { cs: 'https://www.example.cz', sk: 'https://www.example.cz' })).toThrow('more than one locale')
	})
})

// A real Astro project per case. It lives next to this file so the project resolves `astro`.
let root = ''

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe('build', () => {
	test('writes _domains.json next to the build output', async () => {
		root = await mkdtemp(path.join(import.meta.dir, '.project-'))
		await mkdir(path.join(root, 'src/pages/sk'), { recursive: true })
		await writeFile(path.join(root, 'src/pages/index.md'), '# Ahoj\n')
		await writeFile(path.join(root, 'src/pages/sk/index.md'), '# Ahoj\n')
		await build({
			root,
			logLevel: 'error',
			i18n: { defaultLocale: 'cs', locales: ['cs', 'sk'], routing: { prefixDefaultLocale: false } },
			integrations: [nua({
				cms: false,
				mdx: false,
				sitemap: false,
				checks: false,
				pageMarkdown: false,
				domains: { cs: 'https://www.example.cz', sk: 'https://www.example.sk' },
			})],
		})

		expect(JSON.parse(await readFile(path.join(root, 'dist/_domains.json'), 'utf-8'))).toEqual({
			domains: [
				{ origin: 'https://www.example.cz', prefix: '' },
				{ origin: 'https://www.example.sk', prefix: '/sk' },
			],
		})
		// The build itself is untouched: the Slovak page stays under its prefix.
		expect(await readFile(path.join(root, 'dist/sk/index.html'), 'utf-8')).toContain('Ahoj')
	}, 30_000)
})
