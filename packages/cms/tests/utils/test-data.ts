/**
 * Test data factories for CMS marker tests.
 *
 * Provides factory functions for creating test data objects
 * with sensible defaults and easy overrides.
 */

import type { Attribute, AvailableColors, CollectionEntry, ComponentInstance, ManifestEntry, TailwindColor } from '../../src/types'

// ============================================================================
// Manifest Entry Factories
// ============================================================================

let entryCounter = 0

/**
 * Resets the entry counter. Call in beforeEach for test isolation.
 */
export function resetEntryCounter(): void {
	entryCounter = 0
}

/**
 * Creates a manifest entry with sensible defaults.
 *
 * @param overrides - Override specific properties
 * @returns A ManifestEntry
 *
 * @example
 * const entry = createManifestEntry({ tag: 'h1', text: 'Hello' })
 * // { id: 'cms-0', tag: 'h1', text: 'Hello', sourcePath: '/test.html' }
 */
export function createManifestEntry(
	overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
	const id = overrides.id ?? `cms-${entryCounter++}`
	return {
		id,
		tag: 'p',
		text: 'Test content',
		sourcePath: '/test.html',
		...overrides,
	}
}

/**
 * Creates multiple manifest entries.
 *
 * @param entries - Array of partial entries to create
 * @returns Record of ManifestEntries keyed by id
 *
 * @example
 * const entries = createManifestEntries([
 *   { tag: 'h1', text: 'Title' },
 *   { tag: 'p', text: 'Paragraph' }
 * ])
 */
export function createManifestEntries(
	entries: Array<Partial<ManifestEntry>>,
): Record<string, ManifestEntry> {
	return Object.fromEntries(
		entries.map((entry) => {
			const full = createManifestEntry(entry)
			return [full.id, full]
		}),
	)
}

/**
 * Creates a manifest entry for an image element.
 *
 * @param src - Image source URL
 * @param alt - Alt text
 * @param overrides - Additional overrides
 * @returns A ManifestEntry configured for an image
 *
 * @example
 * const imgEntry = createImageEntry('/hero.jpg', 'Hero image')
 */
export function createImageEntry(
	src: string,
	alt: string,
	overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
	return createManifestEntry({
		tag: 'img',
		text: alt,
		imageMetadata: {
			src,
			alt,
		},
		...overrides,
	})
}

/**
 * Creates a manifest entry for a collection item.
 *
 * @param collectionName - Name of the collection (e.g., 'blog')
 * @param slug - Entry slug
 * @param overrides - Additional overrides
 * @returns A ManifestEntry configured for a collection
 *
 * @example
 * const blogEntry = createCollectionEntry('blog', 'my-post', { text: 'Post Title' })
 */
export function createCollectionManifestEntry(
	collectionName: string,
	slug: string,
	overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
	return createManifestEntry({
		collectionName,
		collectionSlug: slug,
		contentPath: `src/content/${collectionName}/${slug}.md`,
		...overrides,
	})
}

// ============================================================================
// Component Instance Factories
// ============================================================================

let componentCounter = 0

/**
 * Resets the component counter. Call in beforeEach for test isolation.
 */
export function resetComponentCounter(): void {
	componentCounter = 0
}

/**
 * Creates a component instance with sensible defaults.
 *
 * @param overrides - Override specific properties
 * @returns A ComponentInstance
 *
 * @example
 * const comp = createComponentInstance({
 *   componentName: 'Button',
 *   props: { variant: 'primary' }
 * })
 */
export function createComponentInstance(
	overrides: Partial<ComponentInstance> = {},
): ComponentInstance {
	const id = overrides.id ?? `comp-${componentCounter++}`
	return {
		id,
		componentName: 'TestComponent',
		file: 'src/components/TestComponent.astro',
		sourcePath: 'src/pages/index.astro',
		sourceLine: 1,
		props: {},
		...overrides,
	}
}

/**
 * Creates multiple component instances.
 *
 * @param components - Array of partial components to create
 * @returns Record of ComponentInstances keyed by id
 */
export function createComponentInstances(
	components: Array<Partial<ComponentInstance>>,
): Record<string, ComponentInstance> {
	return Object.fromEntries(
		components.map((comp) => {
			const full = createComponentInstance(comp)
			return [full.id, full]
		}),
	)
}

// ============================================================================
// Collection Entry Factories
// ============================================================================

/**
 * Creates a collection entry with sensible defaults.
 *
 * @param overrides - Override specific properties
 * @returns A CollectionEntry
 *
 * @example
 * const entry = createCollectionEntry({
 *   collectionName: 'blog',
 *   collectionSlug: 'my-post',
 *   frontmatter: { title: { value: 'My Post', line: 2 } }
 * })
 */
export function createCollectionEntry(
	overrides: Partial<CollectionEntry> = {},
): CollectionEntry {
	const collectionName = overrides.collectionName ?? 'blog'
	const slug = overrides.collectionSlug ?? 'test-entry'
	return {
		collectionName,
		collectionSlug: slug,
		sourcePath: `src/content/${collectionName}/${slug}.md`,
		frontmatter: {
			title: { value: 'Test Entry', line: 2 },
		},
		body: '# Test Content\n\nThis is test content.',
		bodyStartLine: 5,
		...overrides,
	}
}

// ============================================================================
// Color Configuration Factories
// ============================================================================

/**
 * Creates a Tailwind color with shades.
 *
 * @param name - Color name
 * @param shades - Map of shade to hex value
 * @param isCustom - Whether this is a custom color
 * @returns A TailwindColor
 *
 * @example
 * const primary = createTailwindColor('primary', {
 *   '500': '#3b82f6',
 *   '600': '#2563eb'
 * }, true)
 */
export function createTailwindColor(
	name: string,
	shades: Record<string, string>,
	isCustom = false,
): TailwindColor {
	return {
		name,
		values: shades,
		isCustom,
	}
}

/**
 * Creates a complete AvailableColors configuration.
 *
 * @param overrides - Override specific properties
 * @returns An AvailableColors config
 *
 * @example
 * const colors = createAvailableColors({
 *   customColors: ['primary', 'secondary']
 * })
 */
export function createAvailableColors(
	overrides: Partial<AvailableColors> = {},
): AvailableColors {
	const defaultColors: TailwindColor[] = [
		createTailwindColor('white', { '': '#ffffff' }),
		createTailwindColor('black', { '': '#000000' }),
		createTailwindColor('blue', {
			'50': '#eff6ff',
			'100': '#dbeafe',
			'500': '#3b82f6',
			'600': '#2563eb',
			'900': '#1e3a8a',
		}),
		createTailwindColor('red', {
			'50': '#fef2f2',
			'500': '#ef4444',
			'600': '#dc2626',
			'900': '#7f1d1d',
		}),
	]

	return {
		colors: overrides.colors ?? defaultColors,
		defaultColors: overrides.defaultColors ?? ['white', 'black', 'blue', 'red'],
		customColors: overrides.customColors ?? [],
	}
}

/**
 * Creates a flat Record<string, Attribute> for element color styling.
 *
 * @param overrides - Map of flat color keys to class values (e.g., { bg: 'bg-blue-500', text: 'text-white' })
 * @returns A Record<string, Attribute>
 *
 * @example
 * const classes = createColorClasses({
 *   bg: 'bg-blue-500',
 *   text: 'text-white',
 *   hoverBg: 'hover:bg-blue-600'
 * })
 */
export function createColorClasses(
	overrides: Record<string, string> = {},
): Record<string, Attribute> {
	const result: Record<string, Attribute> = {}
	for (const [key, value] of Object.entries(overrides)) {
		result[key] = { value }
	}
	return result
}

// ============================================================================
// Composite Factories
// ============================================================================

/**
 * Resets all counters. Call in beforeEach for complete test isolation.
 */
export function resetAllCounters(): void {
	resetEntryCounter()
	resetComponentCounter()
}

/**
 * Creates a complete page manifest data structure.
 *
 * @param options - Page manifest options
 * @returns Object with entries, components, and optional collection
 *
 * @example
 * const page = createPageManifest({
 *   entries: [{ tag: 'h1', text: 'Title' }],
 *   components: [{ componentName: 'Hero' }]
 * })
 */
export function createPageManifest(options: {
	entries?: Array<Partial<ManifestEntry>>
	components?: Array<Partial<ComponentInstance>>
	collection?: Partial<CollectionEntry>
} = {}): {
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	collection?: CollectionEntry
} {
	return {
		entries: options.entries ? createManifestEntries(options.entries) : {},
		components: options.components ? createComponentInstances(options.components) : {},
		collection: options.collection ? createCollectionEntry(options.collection) : undefined,
	}
}
