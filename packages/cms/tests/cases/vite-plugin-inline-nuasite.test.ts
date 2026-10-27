import { describe, expect, test } from 'bun:test'
import { dropCrawledExternals, inlineNuasitePackages, userExternals } from '../../src/vite-plugin-inline-nuasite'

describe('inlineNuasitePackages', () => {
	test('drops @nuasite packages from an explicit external list', () => {
		const resolve = { external: ['@nuasite/cms-core', 'zod', '@nuasite/cms-types'] }
		dropCrawledExternals(resolve)
		expect(resolve.external).toEqual(['zod'])
	})

	test('keeps an @nuasite external the site set itself', () => {
		const resolve = { external: ['@nuasite/cms-core', '@nuasite/cms-sidecar'] }
		dropCrawledExternals(resolve, new Set(['@nuasite/cms-sidecar']))
		expect(resolve.external).toEqual(['@nuasite/cms-sidecar'])
	})

	test('leaves external: true alone', () => {
		const resolve = { external: true as const }
		dropCrawledExternals(resolve)
		expect(resolve.external).toBe(true)
	})

	test('applies to the top-level config and every environment, in dev only', () => {
		const plugin = inlineNuasitePackages()
		expect(plugin.apply).toBe('serve')
		const top = { external: ['@nuasite/components'] }
		const astro = { resolve: { external: ['@nuasite/cms-core'] } }
		const ssr = { resolve: { external: ['@nuasite/core', 'sharp'] } }
		;(plugin.configResolved as (c: unknown) => void)({ resolve: top, environments: { astro, ssr } })
		expect(top.external).toEqual([])
		expect(astro.resolve.external).toEqual([])
		expect(ssr.resolve.external).toEqual(['sharp'])
	})

	test("collects the site's own @nuasite externals from every place Vite reads them", () => {
		expect(userExternals({
			ssr: { external: ['@nuasite/a', 'zod'] },
			resolve: { external: ['@nuasite/b'] },
			environments: { astro: { resolve: { external: ['@nuasite/c'] } }, ssr: { resolve: { external: true } } },
		})).toEqual(['@nuasite/a', '@nuasite/b', '@nuasite/c'])
		expect(userExternals(undefined)).toEqual([])
	})
})
