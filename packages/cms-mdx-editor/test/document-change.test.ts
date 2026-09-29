import { expect, test } from 'bun:test'
import { Schema } from '@milkdown/prose/model'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { EditorView } from '@milkdown/prose/view'
import { documentChangePlugin } from '../src/document-change-plugin'

test('draft updates synchronously before save, but mounting and selection do not change content', () => {
	const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {} } })
	const changes: string[] = []
	const view = new EditorView(document.createElement('div'), { state: EditorState.create({ schema, plugins: [documentChangePlugin(doc => changes.push(doc.textContent))] }) })
	try {
		expect(changes).toEqual([])
		view.dispatch(view.state.tr.insertText('Latest edit'))
		expect(changes).toEqual(['Latest edit'])
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
		expect(changes).toEqual(['Latest edit'])
	} finally { view.destroy() }
})
