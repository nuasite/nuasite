import type { AstroConfig } from 'astro'
import { describe, expect, test } from 'bun:test'
import { markdownSyntaxOf, mdxBodyAsMarkdown } from '../../src/mdx'

// As a `@nuasite/nua` site parses it: with the CMS's directives.
const md = (body: string) => mdxBodyAsMarkdown(body, { directives: true })

describe('mdxBodyAsMarkdown', () => {
	test('drops ESM blocks, including one that spans lines', () => {
		const body = [
			"import Tip from '../components/Tip.astro'",
			'import {',
			'  a,',
			'  b,',
			"} from './values'",
			'',
			'export const meta = { a: 1 }',
			'',
			'# Heading',
			'',
			'Text with a [link](/x).',
		].join('\n')
		expect(md(body)).toBe('# Heading\n\nText with a [link](/x).')
	})

	test('an export whose code holds a blank line is dropped whole', () => {
		expect(md('export const items = [\n  "a",\n\n  "b",\n]\n\nProse.\n')).toBe('Prose.\n')
	})

	test('a CRLF body loses the blank lines after a dropped import', () => {
		expect(md("import X from './x'\r\n\r\nProse.\r\n")).toBe('Prose.\r\n')
	})

	test('a wrapped prose line that starts with "export" is prose', () => {
		const body = 'We do consulting and\nexport goods abroad every\nweek for clients.\n\nNext para.\n'
		expect(md(body)).toBe(body)
	})

	test('a body that still uses a component is left to the rendered page', () => {
		expect(md('import Profile from \'./Profile.astro\'\n\nIntro.\n\n<Profile name="Dana" />\n')).toBeUndefined()
		expect(md('Intro.\n\n<Tip>\nRead this.\n</Tip>\n')).toBeUndefined()
		expect(md('<Icons.Star />\n')).toBeUndefined()
		expect(md('Inline <Badge>new</Badge> text.\n')).toBeUndefined()
	})

	test('a body with an expression is left to the rendered page', () => {
		expect(md('Year: {new Date().getFullYear()}\n')).toBeUndefined()
		expect(md('Text.\n\n{/* todo */}\n')).toBeUndefined()
		expect(md('<div class={styles.note}>Note</div>\n')).toBeUndefined()
	})

	test('a body MDX cannot parse is left to the rendered page', () => {
		expect(md('<div>\n')).toBeUndefined()
	})

	test('plain HTML, directives and prose that mentions imports stay', () => {
		const body = '<div class="note">Note</div>\n\n:::list{.dots}\n- one\n:::\n\nWe import goods from abroad.\n'
		expect(md(body)).toBe(body)
	})

	test('a link destination in angle brackets or inline code is not a component', () => {
		const body = '[Read more](<Procesy a organizace>) and use `<Card />` or ``<Card />`` here.\n'
		expect(md(body)).toBe(body)
	})

	test('fenced code is kept whole and never counts as a component', () => {
		const body = 'Example:\n\n```tsx\nimport { Card } from \'./Card\'\n\n<Card title="x" />\n```\n\nDone.\n'
		expect(md(body)).toBe(body)
	})

	test('a longer fence holds a shorter one', () => {
		const body = '````md\n```js\nimport x from "y"\n```\n<Card />\n````\n\nDone.\n'
		expect(md(body)).toBe(body)
	})

	test('without directives, an expression after a colon is an expression', () => {
		expect(md('Price:total{price}\n')).toBe('Price:total{price}\n')
		expect(mdxBodyAsMarkdown('Price:total{price}\n', { directives: false })).toBeUndefined()
	})
})

describe('markdownSyntaxOf', () => {
	const config = (remarkPlugins: unknown[]) => ({ markdown: { remarkPlugins } }) as unknown as AstroConfig

	test('finds remark-directive by name, by function or with options', () => {
		function remarkDirective() {}
		expect(markdownSyntaxOf(config(['remark-directive'])).directives).toBe(true)
		expect(markdownSyntaxOf(config([remarkDirective])).directives).toBe(true)
		expect(markdownSyntaxOf(config([[remarkDirective, {}]])).directives).toBe(true)
		expect(markdownSyntaxOf(config([function remarkGfm() {}])).directives).toBe(false)
		expect(markdownSyntaxOf({} as AstroConfig).directives).toBe(false)
	})
})
