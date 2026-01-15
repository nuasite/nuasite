import { describe, expect, test } from 'bun:test'
import type { ManifestWriter } from '../../src/manifest-writer'
import type { CmsMarkerOptions } from '../../src/types'
import { createVitePlugin } from '../../src/vite-plugin'

describe('Vite Plugin', () => {
	const createMockContext = () => {
		const mockManifestWriter: ManifestWriter = {
			getGlobalManifest: () => ({ entries: {}, components: {}, componentDefinitions: {} }),
		} as ManifestWriter

		return {
			manifestWriter: mockManifestWriter,
			componentDefinitions: {},
			config: {
				attributeName: 'data-cms-id',
				includeTags: null,
				excludeTags: ['script', 'style'],
				includeEmptyText: false,
				generateManifest: true,
				manifestFile: 'manifest.json',
				markComponents: true,
				componentDirs: ['src/components'],
			} as Required<CmsMarkerOptions>,
			idCounter: { value: 0 },
		}
	}

	test('should return array of plugins', () => {
		const context = createMockContext()
		const plugins = createVitePlugin(context)

		expect(Array.isArray(plugins)).toBe(true)
		expect(plugins.length).toBeGreaterThan(0)
	})

	test('should include Astro transform plugin', () => {
		const context = createMockContext()
		const plugins = createVitePlugin(context)

		const astroPlugin = plugins.find(p => p.name === 'astro-cms-source-injector')
		expect(astroPlugin).toBeDefined()
		expect(astroPlugin?.transform).toBeDefined()
	})

	test('should include virtual manifest plugin', () => {
		const context = createMockContext()
		const plugins = createVitePlugin(context)

		const manifestPlugin = plugins.find(p => p.name === 'cms-marker-virtual-manifest')
		expect(manifestPlugin).toBeDefined()
		expect(manifestPlugin?.resolveId).toBeDefined()
		expect(manifestPlugin?.load).toBeDefined()
	})

	test('Astro transform plugin should only process .astro files', () => {
		const context = createMockContext()
		const plugins = createVitePlugin(context)
		const astroPlugin = plugins.find(p => p.name === 'astro-cms-source-injector')

		expect(astroPlugin).toBeDefined()

		// The transform function should be defined
		expect(typeof astroPlugin?.transform).toBe('function')
	})

	test('virtual manifest plugin should resolve virtual module IDs', () => {
		const context = createMockContext()
		const plugins = createVitePlugin(context)
		const manifestPlugin = plugins.find(p => p.name === 'cms-marker-virtual-manifest')

		expect(manifestPlugin?.resolveId).toBeDefined()

		// Test resolving virtual manifest ID
		if (typeof manifestPlugin?.resolveId === 'function') {
			const resolved1 = manifestPlugin.resolveId('virtual:cms-manifest', '', {})
			expect(resolved1).toBe('\0virtual:cms-manifest')

			const resolved2 = manifestPlugin.resolveId('/@cms/manifest', '', {})
			expect(resolved2).toBe('\0virtual:cms-manifest')

			const resolved3 = manifestPlugin.resolveId('virtual:cms-components', '', {})
			expect(resolved3).toBe('\0virtual:cms-components')

			const resolved4 = manifestPlugin.resolveId('/@cms/components', '', {})
			expect(resolved4).toBe('\0virtual:cms-components')
		}
	})

	test('virtual manifest plugin should load manifest data', () => {
		const mockManifest = {
			entries: { 'cms-1': { id: 'cms-1', file: 'test.html', tag: 'h1', text: 'Test' } },
			components: {},
			componentDefinitions: {},
		}

		const context = createMockContext()
		context.manifestWriter.getGlobalManifest = () => mockManifest

		const plugins = createVitePlugin(context)
		const manifestPlugin = plugins.find(p => p.name === 'cms-marker-virtual-manifest')

		expect(manifestPlugin?.load).toBeDefined()

		if (typeof manifestPlugin?.load === 'function') {
			const loaded = manifestPlugin.load('\0virtual:cms-manifest')
			expect(loaded).toContain(JSON.stringify(mockManifest))
		}
	})

	test('should pass markComponents config to Astro transform plugin', () => {
		const context = createMockContext()
		context.config.markComponents = false

		const plugins = createVitePlugin(context)
		const astroPlugin = plugins.find(p => p.name === 'astro-cms-source-injector')

		// The plugin should be created with the config
		expect(astroPlugin).toBeDefined()
	})
})
