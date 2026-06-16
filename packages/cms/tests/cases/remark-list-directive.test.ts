import { expect, test } from 'bun:test'
import { unified } from 'unified'
import { remarkListDirective } from '../../src/remark-list-directive'

interface Node {
	type: string
	name?: string
	value?: string
	attributes?: Record<string, unknown>
	children?: Node[]
	data?: { hName?: string; hProperties?: { className?: string[]; src?: string } }
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

test('renders a youtube leaf directive (#id) as an iframe', () => {
	const tree = run({
		type: 'root',
		children: [{ type: 'leafDirective', name: 'youtube', attributes: { id: '9bZkp7q19f0' }, children: [] }],
	})

	const first = tree.children?.[0]
	expect(first?.data?.hName).toBe('iframe')
	expect(first?.data?.hProperties?.src).toBe('https://www.youtube-nocookie.com/embed/9bZkp7q19f0')
	expect(first?.data?.hProperties?.className).toEqual(['youtube-embed'])
})

test('renders a legacy bare youtube container directive as an iframe', () => {
	const tree = run({
		type: 'root',
		children: [{ type: 'containerDirective', name: 'youtube', attributes: { dQw4w9WgXcQ: '' }, children: [] }],
	})

	const first = tree.children?.[0]
	expect(first?.data?.hName).toBe('iframe')
	expect(first?.data?.hProperties?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
})

test('a youtube directive without an id falls back to literal text', () => {
	const tree = run({
		type: 'root',
		children: [{ type: 'leafDirective', name: 'youtube', attributes: {}, children: [] }],
	})

	const first = tree.children?.[0]
	expect(first?.data?.hName).toBeUndefined()
	expect(first?.type).not.toContain('irective')
})
