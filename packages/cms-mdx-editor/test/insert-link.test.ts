import { expect, test } from 'bun:test'
import { Schema } from '@milkdown/prose/model'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { EditorView } from '@milkdown/prose/view'
import { insertLinkAtCursor } from '../src/milkdown-utils'

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {} }, marks: { link: { attrs: { href: {} }, toDOM: mark => ['a', { href: mark.attrs.href }, 0] } } })

test('Add link inserts a visible link at the cursor and leaves selected text for the normal mark command', () => {
	const view = new EditorView(document.createElement('div'), { state: EditorState.create({ schema }) })
	try {
		expect(insertLinkAtCursor(view, 'https://example.com/paper')).toBe(true)
		expect(view.state.doc.textContent).toBe('https://example.com/paper')
		expect(view.state.doc.firstChild!.firstChild!.marks[0]!.attrs.href).toBe('https://example.com/paper')
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
		expect(insertLinkAtCursor(view, 'https://example.com/other')).toBe(false)
		expect(view.state.doc.textContent).toBe('https://example.com/paper')
	} finally { view.destroy() }
})
