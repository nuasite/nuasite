import { describe, expect, test } from 'bun:test'
import { addMarkdownPlugins } from '../../src/markdown/processor'

const remarkA = () => () => {}
const rehypeB = () => () => {}

function configWith(name: string) {
	const options = { remarkPlugins: [] as unknown[], rehypePlugins: [] as unknown[] }
	return { config: { markdown: { processor: { name, options } } } as any, options }
}

describe('addMarkdownPlugins', () => {
	test('adds the plugins to a unified processor', () => {
		const { config, options } = configWith('unified')
		expect(addMarkdownPlugins(config, { remarkPlugins: [remarkA], rehypePlugins: [rehypeB] })).toBe(true)
		expect(options.remarkPlugins).toEqual([remarkA])
		expect(options.rehypePlugins).toEqual([rehypeB])
	})

	test('adds a plugin once when the hook runs again', () => {
		const { config, options } = configWith('unified')
		addMarkdownPlugins(config, { remarkPlugins: [remarkA] })
		addMarkdownPlugins(config, { remarkPlugins: [remarkA] })
		expect(options.remarkPlugins).toEqual([remarkA])
	})

	test('leaves a processor that does not run remark plugins alone', () => {
		const { config, options } = configWith('satteri')
		expect(addMarkdownPlugins(config, { remarkPlugins: [remarkA] })).toBe(false)
		expect(options.remarkPlugins).toEqual([])
	})
})
