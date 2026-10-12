import { expect, test } from 'bun:test'
import {
	getAvailableComponentNames,
	getCollectionNav,
	getCollectionNavList,
	getComponentDefinition,
	getComponentDefinitions,
	getComponentInstance,
	getComponentInstances,
	getManifestEntry,
	getManifestEntryCount,
	hasManifestEntry,
} from '../../../src/editor/manifest'
import type { CmsManifest, CollectionDefinition } from '../../../src/editor/types'

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

const collection = (name: string, extra: Partial<CollectionDefinition> = {}): CollectionDefinition => ({
	name,
	label: name,
	path: `src/content/${name}`,
	entryCount: 0,
	fields: [],
	fileExtension: 'md',
	...extra,
})

test('getCollectionNav orders by the project locale, whatever page the editor is on', () => {
	const definitions = {
		clanky: collection('clanky', { label: 'Články' }),
		cukr: collection('cukr', { label: 'Cukr' }),
		redirects: collection('redirects', { hidden: true }),
	}
	const names = (locale: string | undefined) =>
		getCollectionNav(definitions, locale).flatMap(section => section.items.map(item => item.collection.name))

	const previousLang = document.documentElement.lang
	try {
		// A bilingual site: the editor moves from a Czech page to an English one, and back.
		for (const pageLang of ['cs', 'en', '']) {
			document.documentElement.lang = pageLang
			// Czech sorts "Č" as its own letter after "C"…
			expect(names('cs')).toEqual(['cukr', 'clanky'])
			// …and a project that declares no language gets the fixed fallback, not the page's.
			expect(names(undefined)).toEqual(['clanky', 'cukr'])
		}
	} finally {
		document.documentElement.lang = previousLang
	}
})

// What the toolbar's Content menu and the "New Page" picker render, row for row.
test('getCollectionNavList flattens the arrangement for the lists that have no headings', () => {
	const definitions = {
		'news-en': collection('news-en', { label: 'News', group: 'English' }),
		redirects: collection('redirects', { hidden: true }),
		'faq-items': collection('faq-items', { label: 'Otázky', parentCollection: 'faq' }),
		cukr: collection('cukr', { label: 'Cukr' }),
		faq: collection('faq', { label: 'FAQ', order: 1 }),
		cisla: collection('cisla', { label: 'Čísla' }),
	}

	expect(getCollectionNavList(definitions, 'cs').map(({ collection, nested }) => `${nested ? '> ' : ''}${collection.name}`)).toEqual([
		'faq',
		'> faq-items',
		'cukr',
		'cisla',
		// A group's collections follow the ungrouped ones; the hidden collection is not offered.
		'news-en',
	])
})

test('getCollectionNavList is empty when every collection is hidden — nothing to offer', () => {
	expect(getCollectionNavList({ redirects: collection('redirects', { hidden: true }) }, undefined)).toEqual([])
	expect(getCollectionNavList({}, undefined)).toEqual([])
})
