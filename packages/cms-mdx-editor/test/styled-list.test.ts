import { defaultValueCtx, Editor, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import type { Node as PmNode } from '@milkdown/prose/model'
import { callCommand } from '@milkdown/utils'
import { afterEach, expect, test } from 'bun:test'
import { setListStyleCommand, styledListPlugin } from '../src/styled-list-plugin'

const editors: Editor[] = []

async function createEditor(markdown: string): Promise<Editor> {
	const root = document.createElement('div')
	document.body.append(root)
	const editor = await Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, root)
			ctx.set(defaultValueCtx, markdown)
		})
		.use(commonmark)
		.use(styledListPlugin)
		.use(gfm)
		.create()
	editors.push(editor)
	return editor
}

function normalizeSerializedMarkdown(markdown: string): string {
	return markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown
}

function serialize(editor: Editor, doc: PmNode): string {
	const serializer = editor.ctx.get(serializerCtx)
	return normalizeSerializedMarkdown(serializer(doc))
}

function parse(editor: Editor, markdown: string): PmNode {
	const parser = editor.ctx.get(parserCtx)
	return parser(markdown)
}

function hasLiteralDirectiveText(node: PmNode): boolean {
	let found = false
	node.descendants((child) => {
		if (child.isText && child.text?.includes(':::')) {
			found = true
			return false
		}
		return !found
	})
	return found
}

afterEach(async () => {
	for (const editor of editors.splice(0)) {
		await editor.destroy()
	}
	document.body.innerHTML = ''
})

test('styled list directive parses to a list attr and serializes back', async () => {
	const markdown = ':::list{.checkmarks}\n- a\n- b\n:::'
	const editor = await createEditor(markdown)
	const doc = parse(editor, markdown)
	const list = doc.child(0)

	expect(list.type.name).toBe('bullet_list')
	expect(list.attrs.listStyle).toBe('checkmarks')
	expect(hasLiteralDirectiveText(doc)).toBe(false)
	expect(serialize(editor, doc)).toBe(markdown)
})

test('plain list round-trips without directive markers', async () => {
	const markdown = '- a\n- b'
	const editor = await createEditor(markdown)
	const doc = parse(editor, markdown)
	const list = doc.child(0)
	const serialized = serialize(editor, doc)

	expect(list.type.name).toBe('bullet_list')
	expect(list.attrs.listStyle).toBeNull()
	expect(serialized).toBe(markdown)
	expect(serialized).not.toContain(':::')
})

test('setting and clearing list style changes markdown directionally', async () => {
	const editor = await createEditor('- a\n- b')
	const serializer = editor.ctx.get(serializerCtx)

	editor.action(callCommand(setListStyleCommand.key, 'checkmarks'))
	const view = editor.ctx.get(editorViewCtx)
	expect(normalizeSerializedMarkdown(serializer(view.state.doc))).toBe(':::list{.checkmarks}\n- a\n- b\n:::')

	editor.action(callCommand(setListStyleCommand.key, null))
	expect(normalizeSerializedMarkdown(serializer(view.state.doc))).toBe('- a\n- b')
})
