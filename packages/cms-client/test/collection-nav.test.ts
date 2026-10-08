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
		expect(outline(resolveCollectionNav(input, { locale: undefined }))).toEqual([[undefined, ['blog']]])
		expect(input.map(c => c.name)).toEqual(['blog', 'redirects'])
	})

	test('nothing to list is no sections at all', () => {
		expect(resolveCollectionNav([], { locale: undefined })).toEqual([])
		expect(resolveCollectionNav([collection('redirects', { hidden: true })], { locale: undefined })).toEqual([])
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
		], { locale: undefined })
		expect(outline(sections)).toEqual([[undefined, ['pinned', 'home', 'cases', 'news', 'authors', 'tags']]])
	})

	test('the label decides, not the technical name', () => {
		const sections = resolveCollectionNav([
			collection('a-technical-name', { label: 'Zprávy' }),
			collection('z-technical-name', { label: 'Aktuality' }),
		], { locale: undefined })
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

	test('digits in a label compare as numbers', () => {
		const sections = resolveCollectionNav([
			collection('s10', { label: 'Sekce 10' }),
			collection('s2', { label: 'Sekce 2' }),
			collection('s1', { label: 'Sekce 1' }),
		], { locale: undefined })
		expect(outline(sections)).toEqual([[undefined, ['s1', 's2', 's10']]])
	})

	// The order is a property of the project: it may not change with the language of the
	// viewer's browser. `Intl.Collator` reaches for the runtime's default locale whenever it
	// is given nothing it has data for, so that is the path these close.
	describe('never the runtime locale', () => {
		const czechLabels = [
			collection('chaty', { label: 'Chaty' }),
			collection('hry', { label: 'Hry' }),
			collection('cisla', { label: 'Čísla' }),
			collection('cukr', { label: 'Cukr' }),
		]
		const asEnglish = ['chaty', 'cisla', 'cukr', 'hry']
		const asCzech = ['cukr', 'cisla', 'hry', 'chaty']

		/** Run `arrange` while recording the locales every `Intl.Collator` is constructed with. */
		function collatorLocales(arrange: () => void): unknown[] {
			const original = Intl.Collator
			const seen: unknown[] = []
			Intl.Collator = new Proxy(original, {
				construct(Collator, args: ConstructorParameters<typeof Intl.Collator>) {
					seen.push(args[0])
					return new Collator(...args)
				},
			})
			try {
				arrange()
			} finally {
				Intl.Collator = original
			}
			return seen
		}

		test('no locale: labels are compared as English', () => {
			expect(outline(resolveCollectionNav(czechLabels, { locale: undefined }))).toEqual([[undefined, asEnglish]])
			expect(collatorLocales(() => resolveCollectionNav(czechLabels, { locale: undefined }))).toEqual(['en'])
		})

		test('a tag the runtime has no collation for is not handed to Intl', () => {
			// `und` and an Astro locale path are well-formed, so `Intl.Collator` would accept
			// them — and quietly collate in the runtime's default locale instead.
			for (const locale of ['und', 'spanish', 'xx-YY']) {
				expect(outline(resolveCollectionNav(czechLabels, { locale }))).toEqual([[undefined, asEnglish]])
				expect(collatorLocales(() => resolveCollectionNav(czechLabels, { locale }))).toEqual(['en'])
			}
		})

		test('a malformed tag falls back the same way instead of throwing', () => {
			for (const locale of ['cs_CZ', '']) {
				expect(outline(resolveCollectionNav(czechLabels, { locale }))).toEqual([[undefined, asEnglish]])
				expect(collatorLocales(() => resolveCollectionNav(czechLabels, { locale }))).toEqual(['en'])
			}
		})

		test('a supported locale is the one used, region and all', () => {
			expect(outline(resolveCollectionNav(czechLabels, { locale: 'cs' }))).toEqual([[undefined, asCzech]])
			expect(outline(resolveCollectionNav(czechLabels, { locale: 'cs-CZ' }))).toEqual([[undefined, asCzech]])
			expect(collatorLocales(() => resolveCollectionNav(czechLabels, { locale: 'cs-CZ' }))).toEqual([['cs-CZ']])
		})
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
		], { locale: undefined })
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem > jsem-uvod, jsem-kroky, jsem-otazky']]])
	})

	test('a child does not take the slot its own order would give it at the top level', () => {
		const sections = resolveCollectionNav([
			collection('jsem-otazky', { parentCollection: 'jsem', order: 1 }),
			collection('jsem', { order: 5 }),
			collection('blog', { order: 2 }),
		], { locale: undefined })
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem > jsem-otazky']]])
	})

	test('a child whose parent is missing falls back to the top level', () => {
		const sections = resolveCollectionNav([collection('jsem-otazky', { parentCollection: 'jsem' }), collection('blog')], { locale: undefined })
		expect(outline(sections)).toEqual([[undefined, ['blog', 'jsem-otazky']]])
	})

	test('a child whose parent is hidden falls back to the top level; a hidden child is dropped', () => {
		const sections = resolveCollectionNav([
			collection('jsem', { hidden: true }),
			collection('jsem-otazky', { parentCollection: 'jsem' }),
			collection('blog'),
			collection('blog-drafts', { parentCollection: 'blog', hidden: true }),
		], { locale: undefined })
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
		], { locale: undefined })
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
		], { locale: undefined })
		// `Reference` precedes `English`: its only member is ordered, English's are not.
		expect(outline(sections)).toEqual([
			[undefined, ['cases', 'news', 'tags']],
			['Reference', ['glossary']],
			['English', ['cases-en', 'news-en']],
		])
	})

	test('with every collection grouped there is no leading ungrouped section', () => {
		const sections = resolveCollectionNav([collection('news-en', { group: 'English' }), collection('news', { group: 'Česky' })], { locale: undefined })
		expect(sections.map(section => section.group)).toEqual(['Česky', 'English'])
	})

	test('a nested collection follows its parent, whatever group it declares itself', () => {
		const sections = resolveCollectionNav([
			collection('faq-en', { group: 'English' }),
			collection('faq-en-items', { parentCollection: 'faq-en', group: 'Elsewhere' }),
			collection('faq-items', { parentCollection: 'faq', group: 'English' }),
			collection('faq'),
		], { locale: undefined })
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
		], { locale: undefined })
		expect(outline(sections)).toEqual([
			[undefined, ['blog']],
			['English', ['faq-en-items']],
		])
	})
})
