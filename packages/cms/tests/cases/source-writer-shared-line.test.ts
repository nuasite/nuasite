import { describe, expect, test } from 'bun:test'
import type { ChangePayload } from '../../src/editor/types'
import { applyAttributeChanges, applyChanges, applyColorChange, applyImageChange, applyTextChange } from '../../src/handlers/source-writer'
import type { CmsManifest, ManifestEntry } from '../../src/types'

// Source locations are line-granular, and a line can hold more than the edited
// element: the parent's `<ul>`, a sibling, an element with the same words. Every
// write has to land on the edited element, and an identical snippet elsewhere in
// the file must not take it either.

function makeChange(overrides: Partial<ChangePayload>): ChangePayload {
	return {
		cmsId: 'cms-0',
		newValue: '',
		originalValue: '',
		sourcePath: '/test.astro',
		sourceLine: 1,
		sourceSnippet: '',
		...overrides,
	}
}

function manifestFor(entry: Partial<ManifestEntry>): CmsManifest {
	return { entries: { 'cms-0': { id: 'cms-0', tag: 'li', text: '', ...entry } as ManifestEntry }, components: {}, componentDefinitions: {} }
}

describe('text', () => {
	test('edits the link, not an earlier span with the same words', () => {
		const content = '<p><span>Praha</span> · <a href="/praha">Praha</a></p>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Praha', newValue: 'Brno' }),
			manifestFor({ tag: 'a', text: 'Praha' }),
		)
		expect(result).toEqual({ success: true, content: '<p><span>Praha</span> · <a href="/praha">Brno</a></p>' })
	})

	test('edits the item whose text it is, not the earlier one that contains it', () => {
		const content = '<ul><li>Ano, souhlasím s podmínkami</li><li>Ano</li></ul>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Ano', newValue: 'Ne' }),
			manifestFor({ tag: 'li', text: 'Ano' }),
		)
		expect(result).toEqual({ success: true, content: '<ul><li>Ano, souhlasím s podmínkami</li><li>Ne</li></ul>' })
	})

	test("writes at the element's own line when an identical line comes earlier in the file", () => {
		const content = '<section>\n<p>Kontakt</p>\n</section>\n<footer>\n<p>Kontakt</p>\n</footer>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: '<p>Kontakt</p>', sourceLine: 5, originalValue: 'Kontakt', newValue: 'Napište nám' }),
			manifestFor({ tag: 'p', text: 'Kontakt' }),
		)
		expect(result).toEqual({
			success: true,
			content: '<section>\n<p>Kontakt</p>\n</section>\n<footer>\n<p>Napište nám</p>\n</footer>',
		})
	})

	test('text with child placeholders stays inside the edited element', () => {
		const content = '<p>Volejte nám</p><p>Volejte <a href="tel:1">nám</a> kdykoli</p>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Volejte {{cms:cms-1}} kdykoli', newValue: 'Pište {{cms:cms-1}} kdykoli' }),
			manifestFor({ tag: 'p', text: 'Volejte {{cms:cms-1}} kdykoli' }),
		)
		expect(result).toEqual({ success: true, content: '<p>Volejte nám</p><p>Pište <a href="tel:1">nám</a> kdykoli</p>' })
	})

	test('tells items apart through entities in the source', () => {
		const content = '<ul class="list"><li>Po&ndash;Pá</li><li>So&ndash;Ne <strong>zavřeno</strong></li></ul>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'So–Ne zavřeno', newValue: 'So–Ne otevřeno' }),
			manifestFor({ tag: 'li', text: 'So–Ne zavřeno' }),
		)
		expect(result).toEqual({
			success: true,
			content: '<ul class="list"><li>Po&ndash;Pá</li><li>So&ndash;Ne <strong>otevřeno</strong></li></ul>',
		})
	})

	test('two items that cannot be told apart keep the old first-match behaviour', () => {
		const content = '<li>Ano</li><li>Ano</li>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Ano', newValue: 'Ne' }),
			manifestFor({ tag: 'li', text: 'Ano' }),
		)
		expect(result).toEqual({ success: true, content: '<li>Ne</li><li>Ano</li>' })
	})
})

describe('color classes', () => {
	const colorChange = (oldClass: string, newClass: string) => makeChange({ styleChange: { oldClass, newClass, type: 'text', sourceLine: 1 } })

	function save(content: string, change: ChangePayload, entry: Partial<ManifestEntry>): string | Error {
		const result = applyColorChange(content, change, { tag: 'li', text: '', ...entry })
		return result.success ? result.content : new Error(result.error)
	}

	test("replaces the class on the item, not failing on the parent's class attribute", () => {
		const result = save('<ul class="list"><li class="text-red-500">A</li>', colorChange('text-red-500', 'text-blue-500'), { text: 'A' })
		expect(result).toBe('<ul class="list"><li class="text-blue-500">A</li>')
	})

	test('replaces the class on the sibling being edited', () => {
		const result = save(
			'<li class="text-red-500">A</li><li class="text-red-500">B</li>',
			colorChange('text-red-500', 'text-blue-500'),
			{ text: 'B' },
		)
		expect(result).toBe('<li class="text-red-500">A</li><li class="text-blue-500">B</li>')
	})

	test('adds a class to the item, not to the parent', () => {
		const result = save('<ul class="list"><li>A</li>', colorChange('', 'text-blue-500'), { text: 'A' })
		expect(result).toBe('<ul class="list"><li class="text-blue-500">A</li>')
	})

	test("appends to the item's own class attribute", () => {
		const result = save('<ul class="list"><li class="font-bold">A</li>', colorChange('', 'text-blue-500'), { text: 'A' })
		expect(result).toBe('<ul class="list"><li class="font-bold text-blue-500">A</li>')
	})

	test('refuses to append to a class expression rather than adding a second class attribute', () => {
		const result = save('<li class={cls}>A</li>', colorChange('', 'text-blue-500'), { text: 'A' })
		expect(result).toBeInstanceOf(Error)
	})

	test('ignores data-class when looking for the class attribute', () => {
		const result = save('<li data-class="text-red-500" class="text-red-500">A</li>', colorChange('text-red-500', 'text-blue-500'), { text: 'A' })
		expect(result).toBe('<li data-class="text-red-500" class="text-blue-500">A</li>')
	})
})

describe('attributes', () => {
	test('changes the href of the link being edited, not an earlier one with the same value', () => {
		const content = '<a href="#">Domů</a> <a href="#">Kontakt</a>'
		const result = applyAttributeChanges(
			content,
			makeChange({ attributeChanges: [{ attributeName: 'href', oldValue: '#', newValue: '/kontakt' }] }),
			{ tag: 'a', text: 'Kontakt' },
		)
		expect(result.content).toBe('<a href="#">Domů</a> <a href="/kontakt">Kontakt</a>')
	})

	test('does not take data-href for href', () => {
		const content = '<a data-href="#" href="#">Kontakt</a>'
		const result = applyAttributeChanges(
			content,
			makeChange({ attributeChanges: [{ attributeName: 'href', oldValue: '#', newValue: '/kontakt' }] }),
			{ tag: 'a', text: 'Kontakt' },
		)
		expect(result.content).toBe('<a data-href="#" href="/kontakt">Kontakt</a>')
	})
})

describe('images', () => {
	test("replaces the src nearest the element's line when the same image appears twice", async () => {
		const content = '<header>\n<img src="/logo.svg" alt="Logo">\n</header>\n<footer>\n<img src="/logo.svg" alt="Logo">\n</footer>'
		const result = await applyImageChange(
			content,
			makeChange({ originalValue: '/logo.svg', sourceLine: 5, imageChange: { newSrc: '/logo-white.svg' } }),
		)
		expect(result).toMatchObject({
			success: true,
			content: '<header>\n<img src="/logo.svg" alt="Logo">\n</header>\n<footer>\n<img src="/logo-white.svg" alt="Logo">\n</footer>',
		})
	})

	test("writes the alt into the image's own tag, not the previous image's", async () => {
		const content = '<img src="/a.jpg" alt="První">\n<img src="/b.jpg">'
		const result = await applyImageChange(
			content,
			makeChange({ originalValue: '/b.jpg', sourceLine: 2, imageChange: { newSrc: '/c.jpg', newAlt: 'Třetí' } }),
		)
		expect(result).toMatchObject({ success: true, content: '<img src="/a.jpg" alt="První">\n<img src="/c.jpg" alt="Třetí">' })
	})

	test('replaces the alt of the image itself when both have one', async () => {
		const content = '<img src="/a.jpg" alt="První"><img src="/b.jpg" alt="Druhý">'
		const result = await applyImageChange(
			content,
			makeChange({ originalValue: '/b.jpg', imageChange: { newSrc: '/b.jpg', newAlt: 'Nový' } }),
		)
		expect(result).toMatchObject({ success: true, content: '<img src="/a.jpg" alt="První"><img src="/b.jpg" alt="Nový">' })
	})

	test('a src containing $ is written as is', async () => {
		const content = '<img src="/a.jpg">'
		const result = await applyImageChange(
			content,
			makeChange({ originalValue: '/a.jpg', imageChange: { newSrc: '/price-$5.jpg' } }),
		)
		expect(result).toMatchObject({ success: true, content: '<img src="/price-$5.jpg">' })
	})
})

// A component renders a tag of its own (`<Button>` an `<a>`), and so does a
// markdown link. Next to a literal element with the same tag and text, the
// writer cannot tell which one was edited, and keeps the first match on the line.
describe('a component or markdown link rendering the same tag', () => {
	test('text: the component comes first and keeps the edit', () => {
		const content = '<Button href="/k">Kontakt</Button> <a href="/k">Kontakt</a>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Kontakt', newValue: 'Napište' }),
			manifestFor({ tag: 'a', text: 'Kontakt' }),
		)
		expect(result).toEqual({ success: true, content: '<Button href="/k">Napište</Button> <a href="/k">Kontakt</a>' })
	})

	test('text: a markdown link comes first and keeps the edit', () => {
		const content = '[Kontakt](/k) nebo <a href="/x">Kontakt</a>'
		const result = applyTextChange(
			content,
			makeChange({ sourcePath: '/test.mdx', sourceSnippet: content, originalValue: 'Kontakt', newValue: 'Napište' }),
			manifestFor({ tag: 'a', text: 'Kontakt' }),
		)
		expect(result).toEqual({ success: true, content: '[Napište](/k) nebo <a href="/x">Kontakt</a>' })
	})

	test('attribute: the component comes first and keeps the edit', () => {
		const content = '<Button href="#">Go</Button> <a href="#">Go</a>'
		const result = applyAttributeChanges(
			content,
			makeChange({ attributeChanges: [{ attributeName: 'href', oldValue: '#', newValue: '/x' }] }),
			{ tag: 'a', text: 'Go' },
		)
		expect(result.content).toBe('<Button href="/x">Go</Button> <a href="#">Go</a>')
	})

	test('color: a wrapper around a component does not get a class of its own', () => {
		const result = applyColorChange(
			'<a href="/x"><Button class="px-2">Go</Button></a>',
			makeChange({ styleChange: { oldClass: '', newClass: 'text-red-500', type: 'text', sourceLine: 1 } }),
			{ tag: 'a', text: 'Go' },
		)
		expect(result).toEqual({ success: true, content: '<a href="/x"><Button class="px-2 text-red-500">Go</Button></a>' })
	})
})

describe('void elements', () => {
	test('alt of the second of two images on a line', () => {
		const content = '<img alt="" src="/a.jpg"><img alt="" src="/b.jpg">'
		const result = applyAttributeChanges(
			content,
			makeChange({ attributeChanges: [{ attributeName: 'alt', oldValue: '', newValue: 'B' }] }),
			{ tag: 'img', text: '/b.jpg' },
		)
		expect(result.content).toBe('<img alt="" src="/a.jpg"><img alt="B" src="/b.jpg">')
	})

	test('a class added to an image goes on the image, not its wrapper', () => {
		const result = applyColorChange(
			'<div class="wrap"><img src="/a.jpg"></div>',
			makeChange({ styleChange: { oldClass: '', newClass: 'rounded', type: 'text', sourceLine: 1 } }),
			{ tag: 'img', text: '/a.jpg' },
		)
		expect(result).toEqual({ success: true, content: '<div class="wrap"><img src="/a.jpg" class="rounded"></div>' })
	})

	test('a new attribute goes after a spread, which would otherwise override it', () => {
		const result = applyColorChange(
			'<li {...props}>A</li>',
			makeChange({ styleChange: { oldClass: '', newClass: 'font-bold', type: 'text', sourceLine: 1 } }),
			{ tag: 'li', text: 'A' },
		)
		expect(result).toEqual({ success: true, content: '<li {...props} class="font-bold">A</li>' })
	})
})

describe('markup that only looks like the element', () => {
	test('a commented-out copy of the item is not edited', () => {
		const content = '<!-- <li>Ano</li> --><li>Ano</li>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Ano', newValue: 'Ne' }),
			manifestFor({ tag: 'li', text: 'Ano' }),
		)
		expect(result).toEqual({ success: true, content: '<!-- <li>Ano</li> --><li>Ne</li>' })
	})

	test('a title attribute with the same words keeps them', () => {
		const content = '<ul><li title="Ano">Ano</li>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Ano', newValue: 'Ne' }),
			manifestFor({ tag: 'li', text: 'Ano' }),
		)
		expect(result).toEqual({ success: true, content: '<ul><li title="Ano">Ne</li>' })
	})

	test('an item whose text is an expression still takes its class', () => {
		const result = applyColorChange(
			'<ul class="list"><li>{x}</li>',
			makeChange({ styleChange: { oldClass: '', newClass: 'font-bold', type: 'text', sourceLine: 1 } }),
			{ tag: 'li', text: 'Hodnota' },
		)
		expect(result).toEqual({ success: true, content: '<ul class="list"><li class="font-bold">{x}</li>' })
	})

	test('a class:list on the item does not send the replace to the parent', () => {
		const result = applyColorChange(
			'<ul class="text-red-500"><li class:list={["text-red-500"]}>A</li>',
			makeChange({ styleChange: { oldClass: 'text-red-500', newClass: 'text-blue-500', type: 'text', sourceLine: 1 } }),
			{ tag: 'li', text: 'A' },
		)
		expect(result.success).toBe(false)
	})

	test('data-alt is not alt', async () => {
		const result = await applyImageChange(
			'<img data-alt="x" src="/a.jpg" alt="Old">',
			makeChange({ originalValue: '/a.jpg', imageChange: { newSrc: '/a.jpg', newAlt: 'New' } }),
		)
		expect(result).toMatchObject({ success: true, content: '<img data-alt="x" src="/a.jpg" alt="New">' })
	})

	test('without a source line, data-href is not href', () => {
		const result = applyAttributeChanges(
			'<a data-href="#" href="#">A</a>',
			makeChange({ sourceLine: 0, attributeChanges: [{ attributeName: 'href', oldValue: '#', newValue: '/x' }] }),
		)
		expect(result.content).toBe('<a data-href="#" href="/x">A</a>')
	})
})

describe('several changes to one line in one save', () => {
	const manifest: CmsManifest = {
		entries: {
			a: { id: 'a', tag: 'li', text: 'A' } as ManifestEntry,
			b: { id: 'b', tag: 'li', text: 'B' } as ManifestEntry,
		},
		components: {},
		componentDefinitions: {},
	}
	const line = '<ul><li>A</li><li>B</li></ul>'

	test('two text edits both land', async () => {
		const result = await applyChanges(
			line,
			[
				makeChange({ cmsId: 'a', sourceSnippet: line, originalValue: 'A', newValue: 'Alfa' }),
				makeChange({ cmsId: 'b', sourceSnippet: line, originalValue: 'B', newValue: 'Beta' }),
			],
			manifest,
			'/test.astro',
			'http://localhost',
		)
		expect(result.failedChanges).toEqual([])
		expect(result.newContent).toBe('<ul><li>Alfa</li><li>Beta</li></ul>')
	})

	test('a colour change and a text edit to the same item both land', async () => {
		const result = await applyChanges(
			line,
			[
				makeChange({ cmsId: 'b', styleChange: { oldClass: '', newClass: 'font-bold', type: 'text', sourceLine: 1 } }),
				makeChange({ cmsId: 'b', sourceSnippet: line, originalValue: 'B', newValue: 'Beta' }),
			],
			manifest,
			'/test.astro',
			'http://localhost',
		)
		expect(result.failedChanges).toEqual([])
		expect(result.newContent).toBe('<ul><li>A</li><li class="font-bold">Beta</li></ul>')
	})
})

test('a markdown body line that repeats a frontmatter line is not treated as YAML', () => {
	const content = '---\ntitle: Ahoj\n---\ntitle: Ahoj\n'
	const result = applyTextChange(
		content,
		makeChange({ sourcePath: '/test.md', sourceLine: 4, sourceSnippet: 'title: Ahoj', originalValue: 'title: Ahoj', newValue: 'title: Nazdar' }),
		{ entries: { 'cms-0': { id: 'cms-0', tag: 'p', text: 'title: Ahoj' } as ManifestEntry }, components: {}, componentDefinitions: {} },
	)
	expect(result).toEqual({ success: true, content: '---\ntitle: Ahoj\n---\ntitle: Nazdar\n' })
})

describe('third review pass', () => {
	test('a text edit that adds a line does not shift a colour change further down', async () => {
		const content = '<p class="a">Řádek</p>\n<p class="b">Druhý</p>\n<p class="c">Třetí</p>'
		const result = await applyChanges(
			content,
			[
				makeChange({ cmsId: 'one', sourceLine: 1, sourceSnippet: '<p class="a">Řádek</p>', originalValue: 'Řádek', newValue: 'Řádek\nnový' }),
				makeChange({ cmsId: 'three', sourceLine: 3, styleChange: { oldClass: '', newClass: 'font-bold', type: 'text', sourceLine: 3 } }),
			],
			{
				entries: {
					one: { id: 'one', tag: 'p', text: 'Řádek' } as ManifestEntry,
					three: { id: 'three', tag: 'p', text: 'Třetí' } as ManifestEntry,
				},
				components: {},
				componentDefinitions: {},
			},
			'/test.astro',
			'http://localhost',
		)
		expect(result.failedChanges).toEqual([])
		expect(result.newContent).toBe('<p class="a">Řádek\nnový</p>\n<p class="b">Druhý</p>\n<p class="c font-bold">Třetí</p>')
	})

	test('a <Title> component is markup, not raw text', () => {
		const content = '<Title>Nadpis <span>X</span></Title> <span>X</span>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'X', newValue: 'Y' }),
			manifestFor({ tag: 'span', text: 'X' }),
		)
		expect(result).toEqual({ success: true, content: '<Title>Nadpis <span>Y</span></Title> <span>X</span>' })
	})

	test('a slash ending an unquoted value is not a self-closing slash', () => {
		const result = applyColorChange(
			'<img src=/x/>',
			makeChange({ styleChange: { oldClass: '', newClass: 'z', type: 'text', sourceLine: 1 } }),
			{ tag: 'img', text: '' },
		)
		expect(result).toEqual({ success: true, content: '<img src=/x/ class="z">' })
	})

	test('&shy; keeps its place in the text', () => {
		const content = '<p>Ne&shy;dělej <b>to</b> teď</p>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Ne­dělej to teď', newValue: 'Ne­dělej to zítra' }),
			manifestFor({ tag: 'p', text: 'Ne­dělej to teď' }),
		)
		expect(result).toEqual({ success: true, content: '<p>Ne&shy;dělej <b>to</b> zítra</p>' })
	})

	test('an untouched entity keeps its spelling', () => {
		const content = '<ul><li>&copy; 2024 Firma</li>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: '© 2024 Firma', newValue: '© 2025 Firma' }),
			manifestFor({ tag: 'li', text: '© 2024 Firma' }),
		)
		expect(result).toEqual({ success: true, content: '<ul><li>&copy; 2025 Firma</li>' })
	})

	test('a placeholder edit leaves the same words in an attribute alone', () => {
		const content = '<p title="Volejte nám">Volejte <a href="tel:1">nám</a> kdykoli</p>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Volejte {{cms:cms-1}} kdykoli', newValue: 'Pište {{cms:cms-1}} kdykoli' }),
			manifestFor({ tag: 'p', text: 'Volejte {{cms:cms-1}} kdykoli' }),
		)
		expect(result).toEqual({ success: true, content: '<p title="Volejte nám">Pište <a href="tel:1">nám</a> kdykoli</p>' })
	})

	test('an element with literal text beats a sibling that is only an expression', () => {
		const result = applyColorChange(
			'<p class="a">{a > b ? \'ano\' : \'ne\'}</p><p class="a">Druhý</p>',
			makeChange({ styleChange: { oldClass: 'a', newClass: 'z', type: 'text', sourceLine: 1 } }),
			{ tag: 'p', text: 'Druhý' },
		)
		expect(result).toEqual({ success: true, content: '<p class="a">{a > b ? \'ano\' : \'ne\'}</p><p class="z">Druhý</p>' })
	})

	test('exact case beats a case-only difference', () => {
		const result = applyColorChange(
			'<p class="a">Hello</p><p class="a">hello</p>',
			makeChange({ styleChange: { oldClass: 'a', newClass: 'z', type: 'text', sourceLine: 1 } }),
			{ tag: 'p', text: 'hello' },
		)
		expect(result).toEqual({ success: true, content: '<p class="a">Hello</p><p class="z">hello</p>' })
	})

	test('a .map() row with expressions on both sides is still found', () => {
		const result = applyColorChange(
			'<ul class="list">{items.map(i => <li>{i.t} <b>{i.n}</b></li>)}</ul>',
			makeChange({ styleChange: { oldClass: '', newClass: 'z', type: 'text', sourceLine: 1 } }),
			{ tag: 'li', text: 'Jablka {{cms:cms-9}}' },
		)
		expect(result).toEqual({ success: true, content: '<ul class="list">{items.map(i => <li class="z">{i.t} <b>{i.n}</b></li>)}</ul>' })
	})
})
