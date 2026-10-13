/**
 * Keeps the whitespace at the edges of bold, italic and struck-through text outside
 * the markers.
 *
 * Markdown only reads `**`, `*` or `~~` as a mark when the marker touches the text:
 * `**Question?  **` is not bold, and the site shows the asterisks. Milkdown moves the
 * edge whitespace out on save only when the text starts or ends with a plain space;
 * text pasted from Word or an e-mail usually ends in a non-breaking space, and that
 * (or a tab) stays inside.
 *
 * Milkdown stringifies the tree it builds without running transformers on it, so the
 * tree is corrected right before the compiler. Line breaks stay inside the mark:
 * written outside the markers they could start a new block.
 */
import type { Root } from '@milkdown/transformer'
import { $remark } from '@milkdown/utils'
import type { Plugin } from 'unified'

interface TreeNode {
	type: string
	value?: unknown
	children?: TreeNode[]
}

type Edge = 'start' | 'end'

const MARKS = new Set(['strong', 'emphasis', 'delete'])
const LEADING = /^[^\S\r\n]+/
const TRAILING = /[^\S\r\n]+$/

/** The mark without the whitespace at one edge of its text (undefined when nothing else is left), and that whitespace. */
function trimEdge(mark: TreeNode, edge: Edge): [TreeNode | undefined, string] {
	let children = mark.children ?? []
	let whitespace = ''
	// A text emptied here uncovers the next child, which may be text with edge whitespace too.
	for (;;) {
		const index = edge === 'start' ? 0 : children.length - 1
		const child = children[index]
		if (child?.type !== 'text' || typeof child.value !== 'string') break
		const moved = child.value.match(edge === 'start' ? LEADING : TRAILING)?.[0]
		if (!moved) break
		whitespace = edge === 'start' ? whitespace + moved : moved + whitespace
		const value = edge === 'start' ? child.value.slice(moved.length) : child.value.slice(0, -moved.length)
		children = [...children.slice(0, index), ...(value ? [{ ...child, value }] : []), ...children.slice(index + 1)]
		if (value) break
	}
	if (!whitespace) return [mark, '']
	return [children.length > 0 ? { ...mark, children } : undefined, whitespace]
}

const text = (value: string): TreeNode[] => (value ? [{ type: 'text', value }] : [])

/**
 * Children first: the whitespace a nested mark gives up lands at the edge of the mark
 * around it, which then passes it on. A mark left with nothing but whitespace is dropped.
 */
function moveWhitespaceOut(node: TreeNode): TreeNode {
	if (!node.children) return node
	const children = node.children.flatMap((child) => {
		const inner = moveWhitespaceOut(child)
		if (!MARKS.has(inner.type)) return [inner]
		const [withoutLeading, leading] = trimEdge(inner, 'start')
		const [mark, trailing] = withoutLeading ? trimEdge(withoutLeading, 'end') : [undefined, '']
		return [...text(leading), ...(mark ? [mark] : []), ...text(trailing)]
	})
	return { ...node, children }
}

const remarkMarkWhitespace: Plugin<[], Root> = function() {
	const compiler = this.compiler
	if (!compiler) return
	this.compiler = (tree, file) => compiler(moveWhitespaceOut(tree), file)
}

export const markWhitespacePlugin = $remark('remarkMarkWhitespace', () => remarkMarkWhitespace)
