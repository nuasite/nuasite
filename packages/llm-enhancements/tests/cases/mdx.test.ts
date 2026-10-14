import { describe, expect, test } from 'bun:test'
import { mdxBodyAsMarkdown } from '../../src/mdx'

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
		expect(mdxBodyAsMarkdown(body)).toBe('# Heading\n\nText with a [link](/x).')
	})

	test('an export whose code holds a blank line is dropped whole', () => {
		expect(mdxBodyAsMarkdown('export const items = [\n  "a",\n\n  "b",\n]\n\nProse.\n')).toBe('Prose.\n')
	})

	test('a CRLF body loses the blank lines after a dropped import', () => {
		expect(mdxBodyAsMarkdown("import X from './x'\r\n\r\nProse.\r\n")).toBe('Prose.\r\n')
	})

	test('a wrapped prose line that starts with "export" is prose', () => {
		const body = 'We do consulting and\nexport goods abroad every\nweek for clients.\n\nNext para.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})

	test('a body that still uses a component is left to the rendered page', () => {
		expect(mdxBodyAsMarkdown('import Profile from \'./Profile.astro\'\n\nIntro.\n\n<Profile name="Dana" />\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('Intro.\n\n<Tip>\nRead this.\n</Tip>\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('<Icons.Star />\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('Inline <Badge>new</Badge> text.\n')).toBeUndefined()
	})

	test('a body with an expression is left to the rendered page', () => {
		expect(mdxBodyAsMarkdown('Year: {new Date().getFullYear()}\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('Text.\n\n{/* todo */}\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('<div class={styles.note}>Note</div>\n')).toBeUndefined()
	})

	test('a body MDX cannot parse is left to the rendered page', () => {
		expect(mdxBodyAsMarkdown('<div>\n')).toBeUndefined()
	})

	test('plain HTML, directives and prose that mentions imports stay', () => {
		const body = '<div class="note">Note</div>\n\n:::list{.dots}\n- one\n:::\n\nWe import goods from abroad.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})

	test('a link destination in angle brackets or inline code is not a component', () => {
		const body = '[Read more](<Procesy a organizace>) and use `<Card />` or ``<Card />`` here.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})

	test('fenced code is kept whole and never counts as a component', () => {
		const body = 'Example:\n\n```tsx\nimport { Card } from \'./Card\'\n\n<Card title="x" />\n```\n\nDone.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})

	test('a longer fence holds a shorter one', () => {
		const body = '````md\n```js\nimport x from "y"\n```\n<Card />\n````\n\nDone.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})
})
