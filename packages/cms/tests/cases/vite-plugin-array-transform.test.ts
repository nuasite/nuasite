import { describe, expect, test } from 'bun:test'
import { createArrayTransformPlugin, findTemplateStart, injectArraySourceMarkers } from '../../src/vite-plugin-array-transform'

describe('findTemplateStart', () => {
	test('returns 0 when no frontmatter', () => {
		const code = '<div>hello</div>'
		expect(findTemplateStart(code)).toBe(0)
	})

	test('returns offset after closing ---', () => {
		const code = '---\nconst x = 1\n---\n<div>hello</div>'
		const result = findTemplateStart(code)
		// Should point to the character after the closing ---\n
		expect(code.slice(result)).toBe('<div>hello</div>')
	})

	test('returns 0 for malformed frontmatter (only opening ---)', () => {
		const code = '---\nconst x = 1\nno closing fence'
		expect(findTemplateStart(code)).toBe(0)
	})

	test('handles empty frontmatter', () => {
		const code = '---\n---\n<div />'
		const result = findTemplateStart(code)
		expect(code.slice(result)).toBe('<div />')
	})
})

describe('injectArraySourceMarkers', () => {
	test('injects marker on basic .map() with inline HTML', () => {
		const template = '{items.map((item) => <li>{item.name}</li>)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
		expect(result).toContain('<li data-cms-array-source="items"')
	})

	test('skips uppercase tags (Astro components)', () => {
		const template = '{items.map((item) => <Card {...item} />)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toBe(template) // No change
	})

	test('does not double-inject when attribute already present', () => {
		const template = '{items.map((item) => <li data-cms-array-source="items">{item.name}</li>)}'
		const result = injectArraySourceMarkers(template)
		// Count occurrences of the attribute
		const count = (result.match(/data-cms-array-source/g) || []).length
		expect(count).toBe(1)
	})

	test('handles multiple different arrays', () => {
		const template = [
			'{items.map((item) => <li>{item.name}</li>)}',
			'{tags.map((tag) => <span>{tag}</span>)}',
		].join('\n')
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
		expect(result).toContain('data-cms-array-source="tags"')
	})

	test('indexes same-array occurrences', () => {
		const template = [
			'{items.map((item) => <li>{item.name}</li>)}',
			'{items.map((item) => <span>{item.label}</span>)}',
		].join('\n')
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
		expect(result).toContain('data-cms-array-source="items#1"')
	})

	test('handles block-body arrows', () => {
		const template = '{items.map((item) => { return <div>{item.name}</div> })}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
	})

	test('handles optional chaining', () => {
		const template = '{items?.map((item) => <li>{item.name}</li>)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
	})

	test('handles tag with many attributes (large attr check)', () => {
		const attrs = 'class="foo" id="bar" style="color: red" data-x="long-value-here-for-testing"'
		const template = `{items.map((item) => <div ${attrs}>{item.name}</div>)}`
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
	})

	test('returns template unchanged when no .map() pattern', () => {
		const template = '<div>no map here</div>'
		expect(injectArraySourceMarkers(template)).toBe(template)
	})

	test('handles logical AND conditional rendering', () => {
		const template = '{items.map((item) => item.active && <li>{item.name}</li>)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
		expect(result).toContain('<li data-cms-array-source="items"')
	})

	test('handles ternary conditional rendering', () => {
		const template = '{items.map((item) => item.active ? <li>{item.name}</li> : <span>hidden</span>)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
		expect(result).toContain('<li data-cms-array-source="items"')
	})

	test('handles dotted property paths', () => {
		const template = '{data.items.map((item) => <li>{item.name}</li>)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
	})

	test('handles deep dotted paths like Astro.props', () => {
		const template = '{Astro.props.items.map((item) => <li>{item.name}</li>)}'
		const result = injectArraySourceMarkers(template)
		expect(result).toContain('data-cms-array-source="items"')
	})

	test('ternary only marks the truthy branch element', () => {
		const template = '{items.map((item) => item.active ? <li>{item.name}</li> : <span>hidden</span>)}'
		const result = injectArraySourceMarkers(template)
		// Only the truthy branch (<li>) should get the marker
		expect(result).toContain('<li data-cms-array-source="items"')
		expect(result).not.toContain('<span data-cms-array-source')
	})
})

describe('createArrayTransformPlugin', () => {
	test('has correct name', () => {
		const plugin = createArrayTransformPlugin()
		expect(plugin.name).toBe('cms-array-transform')
	})

	test('only transforms .astro files', () => {
		const plugin = createArrayTransformPlugin()
		const transform = plugin.transform as (code: string, id: string) => any
		expect(transform('', 'file.ts')).toBeNull()
		expect(transform('', 'file.jsx')).toBeNull()
		expect(transform('', 'file.vue')).toBeNull()
	})
})
