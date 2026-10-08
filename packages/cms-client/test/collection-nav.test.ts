// Every collection browser lists collections from this one arrangement, so what it drops,
// where it nests and how it breaks ties are decided here rather than once per UI.
import type { CollectionDefinition } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { type CollectionNavSection, resolveCollectionNav } from '../src/index'

const collection = (name: string, extra: Partial<CollectionDefinition> = {}): CollectionDefinition => ({
	name,
	label: name,
	path: `src/content/${name}`,
	entryCount: 0,
	fields: [],
	fileExtension: 'md',
	...extra,
})

/** The arrangement by collection name: `parent` or `parent > child, child`, under each section's heading. */
function outline(sections: CollectionNavSection[]): Array<[group: string | undefined, items: string[]]> {
	return sections.map(section => [
		section.group,
		section.items.map(item =>
			item.children.length > 0 ? `${item.collection.name} > ${item.children.map(child => child.name).join(', ')}` : item.collection.name
		),
	])
}

describe('resolveCollectionNav — which collections are listed', () => {
	test('a hidden collection is left out, and the input is not touched', () => {
		const input = [collection('blog'), collection('redirects', { hidden: true })]
		expect(outline(resolveCollectionNav(input))).toEqual([[undefined, ['blog']]])
		expect(input.map(c => c.name)).toEqual(['blog', 'redirects'])
	})

	test('nothing to list is no sections at all', () => {
		expect(resolveCollectionNav([])).toEqual([])
		expect(resolveCollectionNav([collection('redirects', { hidden: true })])).toEqual([])
	})
})

describe('resolveCollectionNav — ordering', () => {
	test('declared order first, lower first; undeclared after all of them, by label', () => {
		const sections = resolveCollectionNav([
			collection('tags', { label: 'Tags' }),
			collection('news', { label: 'News', order: 2 }),
			collection('authors', { label: 'Authors' }),
			collection('cases', { label: 'Cases', order: 1 }),
			collection('pinned', { label: 'Pinned', order: -1 }),
			collection('home', { label: 'Home', order: 0 }),
		])
		expect(outline(sections)).toEqual([[undefined, ['pinned', 'home', 'cases', 'news', 'authors', 'tags']]])
	})

	test('the label decides, not the technical name', () => {
		const sections = resolveCollectionNav([
			collection('a-technical-name', { label: 'Zprávy' }),
			collection('z-technical-name', { label: 'Aktuality' }),
		])
		expect(outline(sections)).toEqual([[undefined, ['z-technical-name', 'a-technical-name']]])
	})

	test('labels are compared in the given locale — Czech puts Č after C and Ch after H', () => {
		const input = [
			collection('cisla', { label: 'Čísla' }),
			collection('hry', { label: 'Hry' }),
			collection('clanky', { label: 'Články' }),
			collection('chaty', { label: 'Chaty' }),
			collection('ceny', { label: 'Ceny' }),
			collection('cukr', { label: 'Cukr' }),
			collection('ikony', { label: 'Ikony' }),
		]
		expect(outline(resolveCollectionNav(input, { locale: 'cs' }))).toEqual([[undefined, ['ceny', 'cukr', 'cisla', 'clanky', 'hry', 'chaty', 'ikony']]])
		// The same labels in English: diacritics are a tie-break, and "ch" is two letters.
		expect(outline(resolveCollectionNav(input, { locale: 'en' }))).toEqual([[undefined, ['ceny', 'chaty', 'cisla', 'clanky', 'cukr', 'hry', 'ikony']]])
	})

	test('a locale tag Intl rejects falls back to the default instead of throwing', () => {
		const sections = resolveCollectionNav([collection('b', { label: 'B' }), collection('a', { label: 'A' })], { locale: 'cs_CZ' })
		expect(outline(sections)).toEqual([[undefined, ['a', 'b']]])
	})

	test('the result does not depend on the order the sidecar happened to serve', () => {
		const input = [
			collection('faq-en', { label: 'FAQ', order: 1, group: 'English' }),
			collection('faq', { label: 'FAQ', order: 1 }),
			collection('pages', { label: 'Stránky' }),
			collection('pages-archive', { label: 'Stránky' }),
			collection('faq-items', { label: 'Otázky', parentCollection: 'faq' }),
			collection('faq-notes', { label: 'Otázky', parentCollection: 'faq' }),
			collection('news-en', { label: 'News', group: 'English' }),
			collection('glossary', { label: 'Glossary', group: 'Reference' }),
		]
		const expected = outline(resolveCollectionNav(input, { locale: 'cs' }))
		expect(expected).toEqual([
			// Equal order and label: the name has the last word.
			[undefined, ['faq > faq-items, faq-notes', 'pages', 'pages-archive']],
			['English', ['faq-en', 'news-en']],
			['Reference', ['glossary']],
		])
		// Every rotation and the reverse of the input arrange identically.
		for (let shift = 0; shift < input.length; shift++) {
			const rotated = [...input.slice(shift), ...input.slice(0, shift)]
			expect(outline(resolveCollectionNav(rotated, { locale: 'cs' }))).toEqual(expected)
			expect(outline(resolveCollectionNav(rotated.reverse(), { locale: 'cs' }))).toEqual(expected)
		}
	})
})

describe('resolveCollectionNav — nesting under parentCollection', () => {
	test('a child is listed under its parent, children in the same order as everything else', () => {
		const sections = resolveCollectionNav([
			collection('jsem-otazky', { label: 'Otázky', parentCollection: 'jsem' }),
			collection('jsem-kroky', { label: 'Kroky', parentCollection: 'jsem' }),
			collection('jsem-uvod', { label: 'Úvod', parentCollection: 'jsem', order: 1 }),
			collection('jsem', { label: 'Jsem' }),
			collection('blog', { label: 'Blog' }),
		])
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem > jsem-uvod, jsem-kroky, jsem-otazky']]])
	})

	test('a child does not take the slot its own order would give it at the top level', () => {
		const sections = resolveCollectionNav([
			collection('jsem-otazky', { parentCollection: 'jsem', order: 1 }),
			collection('jsem', { order: 5 }),
			collection('blog', { order: 2 }),
		])
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem > jsem-otazky']]])
	})

	test('a child whose parent is missing falls back to the top level', () => {
		const sections = resolveCollectionNav([collection('jsem-otazky', { parentCollection: 'jsem' }), collection('blog')])
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem-otazky']]])
	})

	test('a child whose parent is hidden falls back to the top level; a hidden child is dropped', () => {
		const sections = resolveCollectionNav([
			collection('jsem', { hidden: true }),
			collection('jsem-otazky', { parentCollection: 'jsem' }),
			collection('blog'),
			collection('blog-drafts', { parentCollection: 'blog', hidden: true }),
		])
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem-otazky']]])
	})

	test('nesting is one level: a child of a child, a cycle and a self-parent all stay listed', () => {
		const sections = resolveCollectionNav([
			collection('a'),
			collection('b', { parentCollection: 'a' }),
			collection('c', { parentCollection: 'b' }),
			collection('x', { parentCollection: 'y' }),
			collection('y', { parentCollection: 'x' }),
			collection('z', { parentCollection: 'z' }),
		])
		expect(outline(sections)).toEqual([[undefined, ['a > b', 'c', 'x', 'y', 'z']]])
	})
})

describe('resolveCollectionNav — sections', () => {
	test('ungrouped collections lead, then each group in the order its first member sorted', () => {
		const sections = resolveCollectionNav([
			collection('news-en', { label: 'News', group: 'English' }),
			collection('glossary', { label: 'Glossary', group: 'Reference', order: 10 }),
			collection('cases-en', { label: 'Cases', group: 'English' }),
			collection('cases', { label: 'Případy', order: 1 }),
			collection('news', { label: 'Aktuality', order: 2 }),
			collection('tags', { label: 'Štítky' }),
		])
		// `Reference` precedes `English`: its only member is ordered, English's are not.
		expect(outline(sections)).toEqual([
			[undefined, ['cases', 'news', 'tags']],
			['Reference', ['glossary']],
			['English', ['cases-en', 'news-en']],
		])
	})

	test('with every collection grouped there is no leading ungrouped section', () => {
		const sections = resolveCollectionNav([collection('news-en', { group: 'English' }), collection('news', { group: 'Česky' })])
		expect(sections.map(section => section.group)).toEqual(['Česky', 'English'])
	})

	test('a nested collection follows its parent, whatever group it declares itself', () => {
		const sections = resolveCollectionNav([
			collection('faq-en', { group: 'English' }),
			collection('faq-en-items', { parentCollection: 'faq-en', group: 'Elsewhere' }),
			collection('faq-items', { parentCollection: 'faq', group: 'English' }),
			collection('faq'),
		])
		expect(outline(sections)).toEqual([
			[undefined, ['faq > faq-items']],
			['English', ['faq-en > faq-en-items']],
		])
	})

	test('a child that falls back to the top level is sectioned by its own group', () => {
		const sections = resolveCollectionNav([
			collection('faq-en', { group: 'English', hidden: true }),
			collection('faq-en-items', { parentCollection: 'faq-en', group: 'English' }),
			collection('blog'),
		])
		expect(outline(sections)).toEqual([
			[undefined, ['blog']],
			['English', ['faq-en-items']],
		])
	})
})
