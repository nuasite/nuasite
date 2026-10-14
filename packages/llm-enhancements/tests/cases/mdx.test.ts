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

	test('a body that still uses a component is left to the rendered page', () => {
		expect(mdxBodyAsMarkdown('import Medailonek from \'./M.astro\'\n\nIntro.\n\n<Medailonek jmeno="Dana" />\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('Intro.\n\n<Tip>\nRead this.\n</Tip>\n')).toBeUndefined()
		expect(mdxBodyAsMarkdown('<Icons.Star />\n')).toBeUndefined()
	})

	test('plain HTML, directives and prose that mentions imports stay', () => {
		const body = '<div class="note">Note</div>\n\n:::list{.dots}\n- one\n:::\n\nWe import goods from abroad.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})

	test('a link destination in angle brackets or inline code is not a component', () => {
		const body = '[Read more](<Procesy\u00a0a organizace>) and use `<Card />` here.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})

	test('fenced code is kept whole and never counts as a component', () => {
		const body = 'Example:\n\n```tsx\nimport { Card } from \'./Card\'\n\n<Card title="x" />\n```\n\nDone.\n'
		expect(mdxBodyAsMarkdown(body)).toBe(body)
	})
})
