import { describe, expect, test } from 'bun:test'
import { createVitePlugin } from '../../src/vite-plugin'
import { createManifestEntry, createMockManifestWriter, createMockViteContext } from '../utils'

describe('Vite Plugin', () => {
	test('should return array of plugins', () => {
		const context = createMockViteContext()
		const plugins = createVitePlugin(context)

		expect(Array.isArray(plugins)).toBe(true)
		expect(plugins.length).toBeGreaterThan(0)
	})

	test('should include virtual manifest plugin', () => {
		const context = createMockViteContext()
		const plugins = createVitePlugin(context)

		const manifestPlugin = plugins.find(p => p.name === 'cms-marker-virtual-manifest')
		expect(manifestPlugin).toBeDefined()
		expect(manifestPlugin?.resolveId).toBeDefined()
		expect(manifestPlugin?.load).toBeDefined()
	})

	test('virtual manifest plugin should resolve virtual module IDs', () => {
		const context = createMockViteContext()
		const plugins = createVitePlugin(context)
		const manifestPlugin = plugins.find(p => p.name === 'cms-marker-virtual-manifest')

		expect(manifestPlugin?.resolveId).toBeDefined()

		// Test resolving virtual manifest ID
		if (typeof manifestPlugin?.resolveId === 'function') {
			const resolveId = manifestPlugin.resolveId as (id: string) => string | undefined
			const resolved1 = resolveId('virtual:cms-manifest')
			expect(resolved1).toBe('\0virtual:cms-manifest')

			const resolved2 = resolveId('/@cms/manifest')
			expect(resolved2).toBe('\0virtual:cms-manifest')

			const resolved3 = resolveId('virtual:cms-components')
			expect(resolved3).toBe('\0virtual:cms-components')

			const resolved4 = resolveId('/@cms/components')
			expect(resolved4).toBe('\0virtual:cms-components')
		}
	})

	test('virtual manifest plugin should load manifest data', () => {
		const mockManifest = {
			entries: {
				'cms-1': createManifestEntry({ id: 'cms-1', tag: 'h1', text: 'Test' }),
			},
			components: {},
			componentDefinitions: {},
		}

		const context = createMockViteContext({
			manifestWriter: createMockManifestWriter({
				getGlobalManifest: () => mockManifest,
			}),
		})

		const plugins = createVitePlugin(context)
		const manifestPlugin = plugins.find(p => p.name === 'cms-marker-virtual-manifest')

		expect(manifestPlugin?.load).toBeDefined()

		if (typeof manifestPlugin?.load === 'function') {
			const load = manifestPlugin.load as (id: string) => string | undefined
			const loaded = load('\0virtual:cms-manifest')
			expect(loaded).toContain(JSON.stringify(mockManifest))
		}
	})
})
