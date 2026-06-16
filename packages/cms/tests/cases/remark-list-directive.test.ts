import { expect, test } from 'bun:test'
import { unified } from 'unified'
import { remarkListDirective } from '../../src/remark-list-directive'

interface Node {
	type: string
	name?: string
	value?: string
	attributes?: Record<string, unknown>
	children?: Node[]
	data?: { hProperties?: { className?: string[] } }
}

function run(tree: Node): Node {
	return unified().use(remarkListDirective).runSync(tree)
}

function paragraph(...children: Node[]): Node {
	return { type: 'paragraph', children }
}

function list(item: string): Node {
	return { type: 'list', children: [{ type: 'listItem', children: [paragraph({ type: 'text', value: item })] }] }
}

test('unwraps a list directive into a class-tagged list', () => {
	const tree = run({
		type: 'root',
		children: [{ type: 'containerDirective', name: 'list', attributes: { class: 'dots-pink' }, children: [list('a')] }],
	})

	const first = tree.children?.[0]
	expect(first?.type).toBe('list')
	expect(first?.data?.hProperties?.className).toEqual(['dots-pink'])
})

test('ignores an invalid class but still preserves the list content', () => {
	const tree = run({
		type: 'root',
		children: [{ type: 'containerDirective', name: 'list', attributes: { class: 'has spaces' }, children: [list('a')] }],
	})

	const first = tree.children?.[0]
	expect(first?.type).toBe('list')
	// 'has spaces' normalizes to the first token 'has', which is valid
	expect(first?.data?.hProperties?.className).toEqual(['has'])
})

test('restores a stray text directive back to literal source (no content loss)', () => {
	const tree = run({
		type: 'root',
		children: [paragraph(
			{ type: 'text', value: 'klíč' },
			{ type: 'textDirective', name: 'hodnota', children: [] },
			{ type: 'text', value: ' dál' },
		)],
	})

	const children = tree.children?.[0]?.children ?? []
	const text = children.map(node => node.value ?? '').join('')
	expect(text).toBe('klíč:hodnota dál')
	expect(children.some(node => node.type.includes('irective'))).toBe(false)
})
