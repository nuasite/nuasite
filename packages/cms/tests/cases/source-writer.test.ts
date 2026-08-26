import { describe, expect, test } from 'bun:test'
import type { ChangePayload } from '../../src/editor/types'
import { applyAttributeChanges, applyTextChange } from '../../src/handlers/source-writer'
import type { CmsManifest } from '../../src/types'

const emptyManifest: CmsManifest = { entries: {}, components: {}, componentDefinitions: {} }

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

describe('applyTextChange', () => {
	test('simple text replacement', () => {
		const content = '<h3>Hello world</h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Hello world</h3>',
				originalValue: 'Hello world',
				newValue: 'Hello universe',
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<h3>Hello universe</h3>' })
	})

	test('text spanning inline styled span', () => {
		const content = '                <h3 class="text-3xl font-semibold leading-9">od 25 000 Kč <span class="text-lg leading-7">/ měsíc</span></h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '                <h3 class="text-3xl font-semibold leading-9">od 25 000 Kč <span class="text-lg leading-7">/ měsíc</span></h3>',
				originalValue: 'od 25 000 Kč / měsíc',
				newValue: 'od 25 0003 Kč / měsíc',
				htmlValue: 'od 25 0003 Kč <span class="text-lg leading-7">/ měsíc</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(
				'                <h3 class="text-3xl font-semibold leading-9">od 25 0003 Kč <span class="text-lg leading-7">/ měsíc</span></h3>',
			)
		}
	})

	test('text spanning multiple inline elements', () => {
		const content = '<p class="info">Price: <span class="bold">100</span> <span class="unit">USD</span></p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p class="info">Price: <span class="bold">100</span> <span class="unit">USD</span></p>',
				originalValue: 'Price: 100 USD',
				newValue: 'Price: 200 EUR',
				htmlValue: 'Price: <span class="bold">200</span> <span class="unit">EUR</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(
				'<p class="info">Price: <span class="bold">200</span> <span class="unit">EUR</span></p>',
			)
		}
	})

	test('ignores htmlValue when manifest entry disallows styling', () => {
		const content = '<BaseLayout description="Hello world" />'
		const manifest: CmsManifest = {
			entries: {
				'cms-0': {
					id: 'cms-0',
					tag: 'meta',
					text: 'Hello world',
					allowStyling: false,
				},
			},
			components: {},
			componentDefinitions: {},
		}
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<BaseLayout description="Hello world" />',
				originalValue: 'Hello world',
				newValue: 'Hello universe',
				htmlValue: 'Hello <span class="text-orange-600">universe</span>',
				hasStyledContent: true,
			}),
			manifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<BaseLayout description="Hello universe" />')
		}
	})

	test('text spanning an inline span is not flattened when no htmlValue is sent', () => {
		const content = '<h2>Hello <span class="accent">world</span></h2>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h2>Hello <span class="accent">world</span></h2>',
				originalValue: 'Hello world',
				newValue: 'Hi everyone',
			}),
			emptyManifest,
		)
		// The rewrite touches both text runs, so no splice can keep the span —
		// better to refuse than to silently drop it. The editor sends `htmlValue`
		// for styled elements, which takes the whole-inner-content path instead.
		expect(result.success).toBe(false)
	})

	test('returns error when text not found and no inline elements', () => {
		const content = '<h3>Some other text</h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Some other text</h3>',
				originalValue: 'Nonexistent text',
				newValue: 'New text',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(false)
	})

	test('snippet not found in file content', () => {
		const content = '<h3>Completely different</h3>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Some text</h3>',
				originalValue: 'Some text',
				newValue: 'New text',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toBe('Source snippet not found in file')
		}
	})

	test('handles HTML entities in text', () => {
		const content = '<p>Tom &amp; Jerry</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Tom &amp; Jerry</p>',
				originalValue: 'Tom & Jerry',
				newValue: 'Tom & Friends',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			// The source spelled the ampersand as an entity — the rewrite keeps it that way.
			expect(result.content).toBe('<p>Tom &amp; Friends</p>')
		}
	})

	test('replaces text segments around CMS placeholders for parent with child elements', () => {
		const content = '<p class="text-lg">Contact us via <a href="mailto:hi@example.com">email</a> or <a href="https://twitter.com">Twitter</a>.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p class="text-lg">Contact us via <a href="mailto:hi@example.com">email</a> or <a href="https://twitter.com">Twitter</a>.</p>',
				originalValue: 'Contact us via {{cms:cms-1}} or {{cms:cms-2}}.',
				newValue: 'Reach out via {{cms:cms-1}} or {{cms:cms-2}}.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(
				'<p class="text-lg">Reach out via <a href="mailto:hi@example.com">email</a> or <a href="https://twitter.com">Twitter</a>.</p>',
			)
		}
	})

	test('handles placeholders when child sourceSnippets contain entire source line', () => {
		// Real-world scenario: extractCompleteTagSnippet returns the entire line for inline children,
		// not just the individual <a> tag. The text-parts approach works regardless of child sourceSnippets.
		const content =
			'          <p class="text-lg leading-relaxed text-gray-700 sm:text-xl">\n            Building agentic systems of records at <a class="link" href="https://contember.com" target="_blank">contember.com</a> and managing small websites with <a class="link" href="https://nuasite.com" target="_blank">nuasite.com</a>. I also advise <a class="link" href="https://mangoweb.cz" target="_blank">manGoweb studio</a>.\n          </p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet:
					'          <p class="text-lg leading-relaxed text-gray-700 sm:text-xl">\n            Building agentic systems of records at <a class="link" href="https://contember.com" target="_blank">contember.com</a> and managing small websites with <a class="link" href="https://nuasite.com" target="_blank">nuasite.com</a>. I also advise <a class="link" href="https://mangoweb.cz" target="_blank">manGoweb studio</a>.\n          </p>',
				originalValue:
					'Building agentic systems of records at {{cms:cms-5}} and managing small websites with {{cms:cms-6}}. I also advise {{cms:cms-7}}.',
				newValue: 'Building an agentic systems of records at {{cms:cms-5}} and managing small websites with {{cms:cms-6}}. I also advise {{cms:cms-7}}.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('Building an agentic systems of records at')
			expect(result.content).toContain('<a class="link" href="https://contember.com" target="_blank">contember.com</a>')
		}
	})

	test('handles multiple text segments changed around placeholders', () => {
		const content = '<p>Hello <a href="/about">world</a>, welcome to <a href="/home">our site</a> today!</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Hello <a href="/about">world</a>, welcome to <a href="/home">our site</a> today!</p>',
				originalValue: 'Hello {{cms:cms-1}}, welcome to {{cms:cms-2}} today!',
				newValue: 'Hi {{cms:cms-1}}, thanks for visiting {{cms:cms-2}} now!',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Hi <a href="/about">world</a>, thanks for visiting <a href="/home">our site</a> now!</p>')
		}
	})

	test('handles placeholder at the start of text', () => {
		const content = '<p><a href="/link">Click here</a> to learn more about us.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p><a href="/link">Click here</a> to learn more about us.</p>',
				originalValue: '{{cms:cms-1}} to learn more about us.',
				newValue: '{{cms:cms-1}} to discover more about us.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p><a href="/link">Click here</a> to discover more about us.</p>')
		}
	})

	test('handles placeholder at the end of text', () => {
		const content = '<p>Learn more at <a href="/docs">our docs</a></p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Learn more at <a href="/docs">our docs</a></p>',
				originalValue: 'Learn more at {{cms:cms-1}}',
				newValue: 'Read more at {{cms:cms-1}}',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Read more at <a href="/docs">our docs</a></p>')
		}
	})

	test('handles single placeholder with text on both sides', () => {
		const content = '<p>Visit <a href="/home">our homepage</a> for details.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Visit <a href="/home">our homepage</a> for details.</p>',
				originalValue: 'Visit {{cms:cms-1}} for details.',
				newValue: 'Check out {{cms:cms-1}} for more info.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Check out <a href="/home">our homepage</a> for more info.</p>')
		}
	})

	test('handles HTML entities in text segments with placeholders', () => {
		const content = '<p>Tom &amp; Jerry love <a href="/food">pizza</a> &amp; pasta.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Tom &amp; Jerry love <a href="/food">pizza</a> &amp; pasta.</p>',
				originalValue: 'Tom & Jerry love {{cms:cms-1}} & pasta.',
				newValue: 'Tom & Jerry enjoy {{cms:cms-1}} & salad.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Tom &amp; Jerry enjoy <a href="/food">pizza</a> &amp; salad.</p>')
		}
	})

	test('handles adjacent placeholders with no text between them', () => {
		const content = '<p>Contact <a href="/email">email</a><a href="/phone">phone</a> anytime.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>Contact <a href="/email">email</a><a href="/phone">phone</a> anytime.</p>',
				originalValue: 'Contact {{cms:cms-1}}{{cms:cms-2}} anytime.',
				newValue: 'Reach {{cms:cms-1}}{{cms:cms-2}} anytime.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Reach <a href="/email">email</a><a href="/phone">phone</a> anytime.</p>')
		}
	})

	test('handles htmlValue with placeholders (adding bold around child elements)', () => {
		// User adds <strong> formatting to text that previously had no inline styling
		const content = '<p>We love working with <a href="/partner">partners</a> globally.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p>We love working with <a href="/partner">partners</a> globally.</p>',
				originalValue: 'We love working with {{cms:cms-1}} globally.',
				newValue: 'We really enjoy working with {{cms:cms-1}} worldwide.',
				htmlValue: 'We <strong>really enjoy</strong> working with {{cms:cms-1}} worldwide.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>We <strong>really enjoy</strong> working with <a href="/partner">partners</a> worldwide.</p>')
		}
	})

	test('handles text segment that appears multiple times in snippet', () => {
		// "or" appears in the text and potentially in attribute values
		const content = '<p class="text-primary or-class">Buy or sell via <a href="/market">the market</a> or trade.</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<p class="text-primary or-class">Buy or sell via <a href="/market">the market</a> or trade.</p>',
				originalValue: 'Buy or sell via {{cms:cms-1}} or trade.',
				newValue: 'Purchase or sell via {{cms:cms-1}} or trade.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p class="text-primary or-class">Purchase or sell via <a href="/market">the market</a> or trade.</p>')
		}
	})

	test('handles <br> vs <br /> mismatch between browser and source', () => {
		const content = '<h1>Kupujete nemovitost?<br />Nejdřív ji prověříme.</h1>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h1>Kupujete nemovitost?<br />Nejdřív ji prověříme.</h1>',
				originalValue: 'Kupujete nemovitost?<br>Nejdřív ji prověříme.',
				newValue: 'Kupujete nemovitost?<br>Nejdřív ji prověříme',
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content: '<h1>Kupujete nemovitost?<br />Nejdřív ji prověříme</h1>',
		})
	})

	test('handles <br> with attributes and whitespace mismatch between browser and source', () => {
		const content =
			'          <p class="text-white">\n            Vyrobíme dvířka na míru vaší vany.<br class="hidden lg:block" />\n            Koupání bude pohodlné.\n          </p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet:
					'          <p class="text-white">\n            Vyrobíme dvířka na míru vaší vany.<br class="hidden lg:block" />\n            Koupání bude pohodlné.\n          </p>',
				originalValue: 'Vyrobíme dvířka na míru vaší vany.<br>\nKoupání bude pohodlné.',
				newValue: 'Vyrobíme dvířka na míru vaší vany.<br>\nKoupání bude pohodlné!',
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content:
				'          <p class="text-white">\n            Vyrobíme dvířka na míru vaší vany.<br class="hidden lg:block" />\n            Koupání bude pohodlné!\n          </p>',
		})
	})

	test('preserves <br> attributes (class, responsive breakpoints) during text edit', () => {
		const content = '<h2 class="title">First line<br class="hidden lg:block" />Second line</h2>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h2 class="title">First line<br class="hidden lg:block" />Second line</h2>',
				originalValue: 'First line<br>Second line',
				newValue: 'First line<br>Updated line',
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content: '<h2 class="title">First line<br class="hidden lg:block" />Updated line</h2>',
		})
	})

	test('multi-line YAML value replacement (title wrapping two lines)', () => {
		// Note: trailing space after "Budete " before the line break — matches real YAML files
		const content =
			'---\ntitle: Dobrovolníci po celé republice spojí síly a uklidí českou krajinu. Budete \n  u toho?\nslug: dobrovolnici\n---\n\nContent.'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: 'title: Dobrovolníci po celé republice spojí síly a uklidí českou krajinu. Budete \n  u toho?',
				originalValue: 'Dobrovolníci po celé republice spojí síly a uklidí českou krajinu. Budete u toho?',
				newValue: 'Nový titulek',
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content: '---\ntitle: Nový titulek\nslug: dobrovolnici\n---\n\nContent.',
		})
	})

	test('multi-line YAML value replacement (excerpt spanning 4 lines)', () => {
		const content = `---
title: Short
excerpt: I letos se čeká Českou republiku tradiční jarní úklid. Tisíce
  dobrovolníků a dobrovolnic se 28. března 2026 sejdou, aby v rámci akce Ukliďme
  Česko společně uklidili to, co do veřejného prostoru nepatří. Přidejte se k
  nim také!
date: 2026-03-10
---`
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet:
					'excerpt: I letos se čeká Českou republiku tradiční jarní úklid. Tisíce\n  dobrovolníků a dobrovolnic se 28. března 2026 sejdou, aby v rámci akce Ukliďme\n  Česko společně uklidili to, co do veřejného prostoru nepatří. Přidejte se k\n  nim také!',
				originalValue:
					'I letos se čeká Českou republiku tradiční jarní úklid. Tisíce dobrovolníků a dobrovolnic se 28. března 2026 sejdou, aby v rámci akce Ukliďme Česko společně uklidili to, co do veřejného prostoru nepatří. Přidejte se k nim také!',
				newValue: 'Updated excerpt.',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('excerpt: Updated excerpt.')
			expect(result.content).toContain('date: 2026-03-10')
			// Should not leave orphaned continuation lines
			expect(result.content).not.toContain('dobrovolníků')
		}
	})

	test('single-line YAML value should not trigger YAML replacement path', () => {
		const content = '---\ntitle: Hello world\n---'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: 'title: Hello world',
				originalValue: 'Hello world',
				newValue: 'Hello universe',
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '---\ntitle: Hello universe\n---' })
	})

	test('YAML folded block scalar (>) replacement', () => {
		const content = '---\ndescription: >-\n  This is a multi-line\n  folded description\ntag: test\n---'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: 'description: >-\n  This is a multi-line\n  folded description',
				originalValue: 'This is a multi-line folded description',
				newValue: 'A short description',
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content: '---\ndescription: A short description\ntag: test\n---',
		})
	})

	test('YAML double-quoted multi-line value replacement', () => {
		const content = '---\ntitle: "A title with special chars: colons, #hashes,\n  and continuation"\nslug: test\n---'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: 'title: "A title with special chars: colons, #hashes,\n  and continuation"',
				originalValue: 'A title with special chars: colons, #hashes, and continuation',
				newValue: 'Simple title',
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content: '---\ntitle: Simple title\nslug: test\n---',
		})
	})

	test('preserves surrounding content when replacing snippet', () => {
		const content = '<div>\n  <h3>Hello <span class="sm">world</span></h3>\n  <p>Other</p>\n</div>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: '<h3>Hello <span class="sm">world</span></h3>',
				originalValue: 'Hello world',
				newValue: 'Hi earth',
				htmlValue: 'Hi <span class="sm">earth</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<div>\n  <h3>Hi <span class="sm">earth</span></h3>\n  <p>Other</p>\n</div>')
		}
	})

	// Non-breaking spaces: the rendered text always carries U+00A0, the source may
	// spell it `&nbsp;`, `&#160;` or as the raw character.
	test('matches U+00A0 in text against &nbsp; in source', () => {
		const content = '<p>Kurzy a&nbsp;publikace</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: content,
				originalValue: 'Kurzy a\u00A0publikace',
				newValue: 'Kurzy a\u00A0knihy',
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<p>Kurzy a&nbsp;knihy</p>' })
	})

	test('matches U+00A0 against the numeric &#160; entity', () => {
		const content = '<p>Kurzy a&#160;publikace</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: content,
				originalValue: 'Kurzy a\u00A0publikace',
				newValue: 'Kurzy a\u00A0knihy',
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<p>Kurzy a&#160;knihy</p>' })
	})

	test('keeps a source &nbsp; the edit never touched, even when the editor sent a plain space', () => {
		// contentEditable normalizes some authored nbsp back to a plain space; only the
		// span that actually changed is rewritten, so the entity survives regardless.
		const content = '<p>Kurzy a&nbsp;publikace</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: content,
				originalValue: 'Kurzy a publikace',
				newValue: 'Kurzy a knihy',
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<p>Kurzy a&nbsp;knihy</p>' })
	})

	test('saves text whose &nbsp; sits next to an ordinary space', () => {
		const content = '<p>Text &nbsp;další</p>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Text  další', newValue: 'Text  jiné' }),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<p>Text &nbsp;jiné</p>' })
	})

	test('leaves untouched entities alone when rewriting part of the text', () => {
		const content = '<p>Tom &amp; Jerry &amp; Spike</p>'
		const result = applyTextChange(
			content,
			makeChange({ sourceSnippet: content, originalValue: 'Tom & Jerry & Spike', newValue: 'Tom & Jerry & Tyke' }),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<p>Tom &amp; Jerry &amp; Tyke</p>' })
	})

	test('keeps the entity spelling the source used when new text adds a nbsp', () => {
		const content = '<p>Kurzy a&nbsp;publikace</p>'
		const result = applyTextChange(
			content,
			makeChange({
				sourceSnippet: content,
				originalValue: 'Kurzy a\u00A0publikace',
				newValue: 'Kurzy a\u00A0nove\u00A0publikace',
			}),
			emptyManifest,
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<p>Kurzy a&nbsp;nove&nbsp;publikace</p>')
		}
	})

	// Inline markup must survive a plain-text edit — the editor only sends
	// `htmlValue` for entries that allow styling.
	describe('inner content carrying inline markup', () => {
		const snippet = '<li><strong class="font-semibold">Pořádáme kurzy</strong> pro zdravotníky.</li>'
		const text = 'Pořádáme kurzy pro zdravotníky.'

		test('splices a plain-text edit into the run it touched', () => {
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: text, newValue: 'Pořádáme kurzy pro učitele.' }),
				emptyManifest,
			)
			expect(result).toEqual({
				success: true,
				content: '<li><strong class="font-semibold">Pořádáme kurzy</strong> pro učitele.</li>',
			})
		})

		test('splices an edit that falls inside the styled run', () => {
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: text, newValue: 'Pořádáme školení pro zdravotníky.' }),
				emptyManifest,
			)
			expect(result).toEqual({
				success: true,
				content: '<li><strong class="font-semibold">Pořádáme školení</strong> pro zdravotníky.</li>',
			})
		})

		test('refuses an edit that spans the markup boundary rather than dropping the tag', () => {
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: text, newValue: 'Úplně jiná věta.' }),
				emptyManifest,
			)
			expect(result.success).toBe(false)
		})

		test('still replaces the whole inner content when the editor sends html', () => {
			const result = applyTextChange(
				snippet,
				makeChange({
					sourceSnippet: snippet,
					originalValue: text,
					newValue: 'Pořádáme kurzy živě pro zdravotníky.',
					htmlValue: '<strong class="font-semibold">Pořádáme kurzy živě</strong> pro zdravotníky.',
					hasStyledContent: true,
				}),
				emptyManifest,
			)
			expect(result).toEqual({
				success: true,
				content: '<li><strong class="font-semibold">Pořádáme kurzy živě</strong> pro zdravotníky.</li>',
			})
		})
	})

	// Frontmatter constants are JavaScript: the rendered text is the *decoded*
	// literal, and the rewrite has to go back through the same escaping.
	describe('javascript string literals', () => {
		test('matches a \\u00A0 escape and keeps the escape on write', () => {
			const snippet = "const ITEMS = ['Nemají s\\u00A0kým sdílet.', 'první\\nřádek']"
			const result = applyTextChange(
				snippet,
				makeChange({
					sourceSnippet: snippet,
					originalValue: 'Nemají s\u00A0kým sdílet.',
					newValue: 'Nemají s\u00A0kým mluvit.',
				}),
				emptyManifest,
			)
			expect(result).toEqual({
				success: true,
				content: "const ITEMS = ['Nemají s\\u00A0kým mluvit.', 'první\\nřádek']",
			})
		})

		test('matches a \\n escape and re-escapes the new line break', () => {
			const snippet = "const TEXT = 'první\\nřádek'"
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: 'první\nřádek', newValue: 'druhý\nřádek' }),
				emptyManifest,
			)
			expect(result).toEqual({ success: true, content: "const TEXT = 'druhý\\nřádek'" })
		})

		test('collapses a + chain of literals into one literal', () => {
			const snippet = "const STORY = 'Tématu podpory sourozenců '\n\t+ 'jsem si poprvé všimla v USA.'"
			const result = applyTextChange(
				snippet,
				makeChange({
					sourceSnippet: snippet,
					originalValue: 'Tématu podpory sourozenců jsem si poprvé všimla v USA.',
					newValue: 'Tématu podpory jsem si všimla v USA.',
				}),
				emptyManifest,
			)
			expect(result).toEqual({
				success: true,
				content: "const STORY = 'Tématu podpory jsem si všimla v USA.'",
			})
		})

		test('escapes a quote that would otherwise break the literal', () => {
			const snippet = "const TEXT = 'plain text'"
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: 'plain text', newValue: "it's here" }),
				emptyManifest,
			)
			expect(result).toEqual({ success: true, content: "const TEXT = 'it\\'s here'" })
		})

		test('leaves markup snippets to the template paths', () => {
			const snippet = '<a href="/about">About us</a>'
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: 'About us', newValue: 'About them' }),
				emptyManifest,
			)
			expect(result).toEqual({ success: true, content: '<a href="/about">About them</a>' })
		})
	})

	test('does not re-encode entities inside html the editor sent', () => {
		const snippet = '<p>Tom &amp; Friends</p>'
		const result = applyTextChange(
			snippet,
			makeChange({
				sourceSnippet: snippet,
				originalValue: 'Tom & Friends',
				newValue: 'Tom & Friends',
				htmlValue: 'Tom &amp; <span class="x">Friends</span>',
				hasStyledContent: true,
			}),
			emptyManifest,
		)
		expect(result).toEqual({
			success: true,
			content: '<p>Tom &amp; <span class="x">Friends</span></p>',
		})
	})

	test('puts an insertion at a markup boundary outside the inline tag', () => {
		const snippet = '<li><strong>Kurzy</strong> pro lékaře.</li>'
		const result = applyTextChange(
			snippet,
			makeChange({ sourceSnippet: snippet, originalValue: 'Kurzy pro lékaře.', newValue: 'Kurzy! pro lékaře.' }),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: '<li><strong>Kurzy</strong>! pro lékaře.</li>' })
	})

	test('escapes a JS literal even when the text itself contains a <', () => {
		const snippet = "const label = 'Doprava < 50 km'"
		const result = applyTextChange(
			snippet,
			makeChange({
				sourcePath: 'src/pages/index.astro',
				sourceSnippet: snippet,
				originalValue: 'Doprava < 50 km',
				newValue: "Doprava < 50 km's",
			}),
			emptyManifest,
		)
		expect(result).toEqual({ success: true, content: "const label = 'Doprava < 50 km\\'s'" })
	})

	test('leaves a quoted YAML value to the yaml path, not the JS one', () => {
		const snippet = "title: 'Ahoj světe'"
		const result = applyTextChange(
			snippet,
			makeChange({
				sourcePath: 'src/content/blog/a.md',
				sourceSnippet: snippet,
				originalValue: 'Ahoj světe',
				newValue: 'Ahoj lidi',
			}),
			emptyManifest,
		)
		// `\'` is not a YAML escape, so the JS literal encoder must not run here.
		expect(result).toEqual({ success: true, content: "title: 'Ahoj lidi'" })
	})

	describe('insertions at a markup seam stay outside the inline element', () => {
		test('before an opening tag', () => {
			const snippet = '<h2>Hello <span class="a">world</span></h2>'
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: 'Hello world', newValue: 'Hello there world' }),
				emptyManifest,
			)
			expect(result).toEqual({ success: true, content: '<h2>Hello there <span class="a">world</span></h2>' })
		})

		test('at the very end, after a trailing inline child', () => {
			const snippet = '<h3>foo <strong>bar</strong></h3>'
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: 'foo bar', newValue: 'foo bar!' }),
				emptyManifest,
			)
			expect(result).toEqual({ success: true, content: '<h3>foo <strong>bar</strong>!</h3>' })
		})

		test('at the very start, before a leading inline child', () => {
			const snippet = '<h3><strong>bar</strong> foo</h3>'
			const result = applyTextChange(
				snippet,
				makeChange({ sourceSnippet: snippet, originalValue: 'bar foo', newValue: '!bar foo' }),
				emptyManifest,
			)
			expect(result).toEqual({ success: true, content: '<h3>!<strong>bar</strong> foo</h3>' })
		})
	})
})

describe('applyAttributeChanges', () => {
	test('rewrites href via standard attribute syntax', () => {
		const content = [
			'<section>',
			'  <a href="/old-url/" class="btn">Link</a>',
			'</section>',
		].join('\n')
		const result = applyAttributeChanges(content, {
			cmsId: 'cms-0',
			newValue: '',
			originalValue: '',
			sourcePath: 'test.astro',
			sourceLine: 2,
			sourceSnippet: '',
			attributeChanges: [{
				attributeName: 'href',
				oldValue: '/old-url/',
				newValue: '/new-url/',
				sourceLine: 2,
			}],
		})
		expect(result.appliedCount).toBe(1)
		expect(result.failedChanges).toHaveLength(0)
		expect(result.content).toContain('href="/new-url/"')
	})

	test('rewrites attribute value backed by a JS string literal (simple variable)', () => {
		const snippet = "const url = '/n/skolka-praha-4/'"
		const content = [
			'---',
			snippet,
			'---',
			'<a href={url}>Link</a>',
		].join('\n')
		const result = applyAttributeChanges(content, {
			cmsId: 'cms-0',
			newValue: '',
			originalValue: '',
			sourcePath: 'Header.astro',
			sourceLine: 2,
			sourceSnippet: '',
			attributeChanges: [{
				attributeName: 'href',
				oldValue: '/n/skolka-praha-4/',
				newValue: '/n/skolka-praha-5/',
				sourceLine: 2,
				sourceSnippet: snippet,
			}],
		})
		expect(result.appliedCount).toBe(1)
		expect(result.failedChanges).toHaveLength(0)
		expect(result.content).toContain(`const url = '/n/skolka-praha-5/'`)
	})

	test('rewrites the matching branch of a conditional without touching the other', () => {
		const snippet = "const kg4Url = locale === 'cs' ? '/n/skolka-praha-4/' : '/n/en/kindergarten-prague-4/'"
		const content = [
			'---',
			snippet,
			'---',
			'<a href={kg4Url}>Praha 4</a>',
		].join('\n')
		const result = applyAttributeChanges(content, {
			cmsId: 'cms-0',
			newValue: '',
			originalValue: '',
			sourcePath: 'Header.astro',
			sourceLine: 2,
			sourceSnippet: '',
			attributeChanges: [{
				attributeName: 'href',
				oldValue: '/n/skolka-praha-4/',
				newValue: '/n/skolka-praha-4-new/',
				sourceLine: 2,
				sourceSnippet: snippet,
			}],
		})
		expect(result.appliedCount).toBe(1)
		expect(result.failedChanges).toHaveLength(0)
		expect(result.content).toContain(`'/n/skolka-praha-4-new/'`)
		// Untouched branch remains intact
		expect(result.content).toContain(`'/n/en/kindergarten-prague-4/'`)
	})

	test('rewrites a multi-line conditional branch without touching the other branch', () => {
		const snippet = "  ? '/n/skolka-praha-4/'"
		const content = [
			'---',
			"const kg4Url = locale === 'cs'",
			snippet,
			"  : '/n/en/kindergarten-prague-4/'",
			'---',
			'<a href={kg4Url}>Praha 4</a>',
		].join('\n')
		const result = applyAttributeChanges(content, {
			cmsId: 'cms-0',
			newValue: '',
			originalValue: '',
			sourcePath: 'Header.astro',
			sourceLine: 3,
			sourceSnippet: '',
			attributeChanges: [{
				attributeName: 'href',
				oldValue: '/n/skolka-praha-4/',
				newValue: '/n/skolka-praha-4-new/',
				sourceLine: 3,
				sourceSnippet: snippet,
			}],
		})
		expect(result.appliedCount).toBe(1)
		expect(result.failedChanges).toHaveLength(0)
		expect(result.content).toContain(`? '/n/skolka-praha-4-new/'`)
		// Alternate branch literal is on a different line and stays untouched
		expect(result.content).toContain(`: '/n/en/kindergarten-prague-4/'`)
	})

	test('fails cleanly when no sourceSnippet is provided and the line has no attrName="value"', () => {
		const content = [
			'---',
			"const url = '/n/skolka-praha-4/'",
			'---',
		].join('\n')
		const result = applyAttributeChanges(content, {
			cmsId: 'cms-0',
			newValue: '',
			originalValue: '',
			sourcePath: 'Header.astro',
			sourceLine: 2,
			sourceSnippet: '',
			attributeChanges: [{
				attributeName: 'href',
				oldValue: '/n/skolka-praha-4/',
				newValue: '/n/skolka-praha-5/',
				sourceLine: 2,
				// no sourceSnippet
			}],
		})
		expect(result.appliedCount).toBe(0)
		expect(result.failedChanges).toHaveLength(1)
		expect(result.failedChanges[0]?.error).toContain('not found on line 2')
	})

	test('fails cleanly when sourceSnippet is stale and no longer matches file content', () => {
		const content = [
			'---',
			"const url = '/new-value/'",
			'---',
		].join('\n')
		const result = applyAttributeChanges(content, {
			cmsId: 'cms-0',
			newValue: '',
			originalValue: '',
			sourcePath: 'Header.astro',
			sourceLine: 2,
			sourceSnippet: '',
			attributeChanges: [{
				attributeName: 'href',
				oldValue: '/old-value/',
				newValue: '/newer-value/',
				sourceLine: 2,
				sourceSnippet: "const url = '/old-value/'", // no longer in file
			}],
		})
		expect(result.appliedCount).toBe(0)
		expect(result.failedChanges).toHaveLength(1)
	})
})
