/**
 * Mock factories for CMS marker tests.
 *
 * Provides type-safe factory functions for creating mock objects
 * used in unit and integration tests.
 */

import type { ManifestWriter } from '../../src/manifest-writer'
import type { CmsManifest, CmsMarkerOptions, ComponentDefinition } from '../../src/types'

// ============================================================================
// ManifestWriter Mocks
// ============================================================================

/**
 * Default empty manifest for mock ManifestWriter.
 */
export const emptyManifest: CmsManifest = {
	entries: {},
	components: {},
	componentDefinitions: {},
}

/**
 * Creates a mock ManifestWriter with configurable behavior.
 *
 * @param overrides - Override specific methods or properties
 * @returns A mock ManifestWriter instance
 *
 * @example
 * const mockWriter = createMockManifestWriter({
 *   getGlobalManifest: () => ({ entries: { 'cms-0': { ... } }, ... })
 * })
 */
export function createMockManifestWriter(
	overrides: Partial<ManifestWriter> = {},
): ManifestWriter {
	const defaultMock: Partial<ManifestWriter> = {
		getGlobalManifest: () => emptyManifest,
		getPageManifest: () => undefined,
		getAvailableColors: () => undefined,
		getAvailableTextStyles: () => undefined,
		getCollectionDefinitions: () => ({}),
		setOutDir: () => {},
		setComponentDefinitions: () => {},
		setCollectionDefinitions: () => {},
		setAvailableColors: () => {},
		setAvailableTextStyles: () => {},
		loadAvailableColors: async () => {},
		addPage: () => {},
		finalize: async () => ({ totalEntries: 0, totalPages: 0, totalComponents: 0 }),
		reset: () => {},
	}

	return {
		...defaultMock,
		...overrides,
	} as ManifestWriter
}

// ============================================================================
// Vite Plugin Context Mocks
// ============================================================================

/**
 * Default CMS marker options for testing.
 */
export const defaultMockConfig: Required<CmsMarkerOptions> = {
	attributeName: 'data-cms-id',
	includeTags: null,
	excludeTags: ['script', 'style'],
	includeEmptyText: false,
	generateManifest: true,
	manifestFile: 'manifest.json',
	markComponents: true,
	componentDirs: ['src/components'],
	contentDir: 'src/content',
}

/**
 * Context object type for Vite plugin creation.
 */
export interface VitePluginContext {
	manifestWriter: ManifestWriter
	componentDefinitions: Record<string, ComponentDefinition>
	config: Required<CmsMarkerOptions>
	idCounter: { value: number }
	command: 'dev' | 'build' | 'preview' | 'sync'
}

/**
 * Creates a mock Vite plugin context.
 *
 * @param overrides - Override specific context properties
 * @returns A mock VitePluginContext
 *
 * @example
 * const context = createMockViteContext({ command: 'serve' })
 * const plugins = createVitePlugin(context)
 */
export function createMockViteContext(
	overrides: Partial<VitePluginContext> = {},
): VitePluginContext {
	return {
		manifestWriter: createMockManifestWriter(),
		componentDefinitions: {},
		config: { ...defaultMockConfig },
		idCounter: { value: 0 },
		command: 'build',
		...overrides,
	}
}

// ============================================================================
// Component Definition Mocks
// ============================================================================

/**
 * Creates a mock component definition.
 *
 * @param overrides - Override specific properties
 * @returns A ComponentDefinition
 *
 * @example
 * const buttonDef = createMockComponentDefinition({
 *   name: 'Button',
 *   props: [{ name: 'variant', type: 'string', required: false }]
 * })
 */
export function createMockComponentDefinition(
	overrides: Partial<ComponentDefinition> = {},
): ComponentDefinition {
	return {
		name: 'MockComponent',
		file: 'src/components/MockComponent.astro',
		props: [],
		...overrides,
	}
}

/**
 * Creates a set of mock component definitions.
 *
 * @param components - Array of component name/file pairs or full definitions
 * @returns Record of ComponentDefinitions keyed by name
 *
 * @example
 * const defs = createMockComponentDefinitions([
 *   { name: 'Button', file: 'src/components/Button.astro' },
 *   { name: 'Card', file: 'src/components/Card.astro', props: [...] }
 * ])
 */
export function createMockComponentDefinitions(
	components: Array<Partial<ComponentDefinition> & { name: string }>,
): Record<string, ComponentDefinition> {
	return Object.fromEntries(
		components.map((comp) => [
			comp.name,
			createMockComponentDefinition(comp),
		]),
	)
}
