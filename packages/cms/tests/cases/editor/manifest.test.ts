import { expect, test } from 'bun:test'
import {
	getAvailableComponentNames,
	getComponentDefinition,
	getComponentDefinitions,
	getComponentInstance,
	getComponentInstances,
	getManifestEntry,
	getManifestEntryCount,
	hasManifestEntry,
} from '../../../src/editor/manifest'
import type { CmsManifest } from '../../../src/editor/types'

const newManifest: CmsManifest = {
	entries: {
		'entry-1': {
			id: 'entry-1',
			sourcePath: '/src/pages/index.astro',
			tag: 'h1',
			text: 'Hello World',
		},
		'entry-2': {
			id: 'entry-2',
			sourcePath: '/src/pages/index.astro',
			tag: 'p',
			text: 'Some paragraph',
		},
	},
	components: {
		'comp-1': {
			id: 'comp-1',
			componentName: 'Hero',
			file: '/src/components/Hero.astro',
			sourcePath: '/src/pages/index.astro',
			sourceLine: 10,
			props: { title: 'Welcome' },
		},
	},
	componentDefinitions: {
		Hero: {
			name: 'Hero',
			file: '/src/components/Hero.astro',
			props: [
				{ name: 'title', type: 'string', required: true },
				{ name: 'subtitle', type: 'string', required: false },
			],
		},
	},
}

test('getManifestEntry returns single entry', () => {
	const entry = getManifestEntry(newManifest, 'entry-1')
	expect(entry?.text).toBe('Hello World')
	expect(getManifestEntry(newManifest, 'nonexistent')).toBeUndefined()
})

test('hasManifestEntry checks existence', () => {
	expect(hasManifestEntry(newManifest, 'entry-1')).toBe(true)
	expect(hasManifestEntry(newManifest, 'entry-2')).toBe(true)
	expect(hasManifestEntry(newManifest, 'nonexistent')).toBe(false)
})

test('getComponentInstances returns components', () => {
	const instances = getComponentInstances(newManifest)
	expect(Object.keys(instances)).toHaveLength(1)
	expect(instances['comp-1']?.componentName).toBe('Hero')
})

test('getComponentInstance returns single instance', () => {
	const instance = getComponentInstance(newManifest, 'comp-1')
	expect(instance?.componentName).toBe('Hero')
	expect(instance?.props?.title).toBe('Welcome')
})

test('getComponentDefinitions returns definitions', () => {
	const definitions = getComponentDefinitions(newManifest)
	expect(Object.keys(definitions)).toHaveLength(1)
	expect(definitions.Hero?.props).toHaveLength(2)
})

test('getComponentDefinition returns single definition', () => {
	const definition = getComponentDefinition(newManifest, 'Hero')
	expect(definition?.name).toBe('Hero')
	expect(definition?.props[0]?.name).toBe('title')
})

test('getManifestEntryCount returns correct count', () => {
	expect(getManifestEntryCount(newManifest)).toBe(2)
	expect(getManifestEntryCount({ componentDefinitions: {}, components: {}, entries: {} })).toBe(0)
})

test('getAvailableComponentNames returns component names', () => {
	const names = getAvailableComponentNames(newManifest)
	expect(names).toContain('Hero')
	expect(names).toHaveLength(1)
})
