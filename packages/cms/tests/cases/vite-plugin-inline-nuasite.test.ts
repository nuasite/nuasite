import { describe, expect, test } from 'bun:test'
import { inlineIn, inlineNuasitePackages } from '../../src/vite-plugin-inline-nuasite'

describe('inlineNuasitePackages', () => {
	test('drops @nuasite packages from the explicit externals and inlines them', () => {
		const resolve = { external: ['@nuasite/cms-core', 'zod', '@nuasite/cms-types'], noExternal: ['astro'] as Array<string | RegExp> }
		inlineIn(resolve)
		expect(resolve.external).toEqual(['zod'])
		expect(resolve.noExternal).toEqual(['astro', /^@nuasite\//])
	})

	test('keeps external: true and noExternal: true as they are', () => {
		const everything = { external: true as const, noExternal: true as const }
		inlineIn(everything)
		expect(everything).toEqual({ external: true, noExternal: true })
	})

	test('wraps a single noExternal entry, and adds the pattern only once', () => {
		const resolve: { external: string[]; noExternal: string | RegExp | Array<string | RegExp> } = { external: [], noExternal: 'astro' }
		inlineIn(resolve)
		inlineIn(resolve)
		expect(resolve.noExternal).toEqual(['astro', /^@nuasite\//])
	})

	test('applies to the top-level config and every environment, in dev only', () => {
		const plugin = inlineNuasitePackages()
		expect(plugin.apply).toBe('serve')
		const astro = { resolve: { external: ['@nuasite/cms-core'], noExternal: [] } }
		const ssr = { resolve: { external: ['@nuasite/core'], noExternal: [] } }
		const config = { resolve: { external: [], noExternal: [] }, environments: { astro, ssr } }
		;(plugin.configResolved as (c: unknown) => void)(config)
		expect(astro.resolve.external).toEqual([])
		expect(ssr.resolve.external).toEqual([])
	})
})
