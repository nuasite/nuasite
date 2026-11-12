import { Schema } from '@milkdown/prose/model'
import { EditorState } from '@milkdown/prose/state'
import { ReplaceStep, Transform } from '@milkdown/prose/transform'
import { describe, expect, test } from 'bun:test'

const schema = new Schema({
	nodes: {
		doc: { content: 'paragraph+' },
		paragraph: { content: 'text*' },
		text: {},
	},
})

// A nested copy under prosemirror-state gave the editors transactions of another Transform class.
describe('one copy of prosemirror-transform', () => {
	test('editor transactions and steps are the classes the editor code imports', () => {
		const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Body'))])
		const tr = EditorState.create({ doc }).tr.insertText('x', 1)

		expect(tr).toBeInstanceOf(Transform)
		expect(tr.steps[0]).toBeInstanceOf(ReplaceStep)
	})
})
