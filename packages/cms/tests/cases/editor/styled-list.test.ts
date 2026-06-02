import { defaultValueCtx, Editor, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { callCommand } from '@milkdown/utils'
import { afterEach, expect, test } from 'bun:test'
import { setBulletListStyleCommand, styledListPlugin } from '../../../src/editor/styled-list-plugin'

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

function serialize(editor: Editor, markdown: string): string {
	const parser = editor.ctx.get(parserCtx)
	const serializer = editor.ctx.get(serializerCtx)
	return normalizeSerializedMarkdown(serializer(parser(markdown)))
}

function normalizeSerializedMarkdown(markdown: string): string {
	return markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown
}

afterEach(async () => {
	for (const editor of editors.splice(0)) {
		await editor.destroy()
	}
	document.body.innerHTML = ''
})

test('styled bullet list directive parses and serializes back', async () => {
	const markdown = ':::list{.arrows-blue}\n- a\n- b\n:::'
	const editor = await createEditor(markdown)
	const parser = editor.ctx.get(parserCtx)
	const doc = parser(markdown)
	const list = doc.child(0)

	expect(list.type.name).toBe('bullet_list')
	expect(list.attrs.listStyle).toBe('arrows-blue')
	expect(serialize(editor, markdown)).toBe(markdown)
})

test('plain bullet list remains plain markdown', async () => {
	const markdown = '- a\n- b'
	const editor = await createEditor(markdown)
	const parser = editor.ctx.get(parserCtx)
	const doc = parser(markdown)
	const list = doc.child(0)

	expect(list.type.name).toBe('bullet_list')
	expect(list.attrs.listStyle).toBeNull()
	expect(serialize(editor, markdown)).toBe(markdown)
})

test('applying and clearing a list style round-trips between directive and plain list', async () => {
	const editor = await createEditor('- a\n- b')
	const serializer = editor.ctx.get(serializerCtx)

	editor.action(callCommand(setBulletListStyleCommand.key, 'arrows-blue'))
	const view = editor.ctx.get(editorViewCtx)
	expect(normalizeSerializedMarkdown(serializer(view.state.doc))).toBe(':::list{.arrows-blue}\n- a\n- b\n:::')

	editor.action(callCommand(setBulletListStyleCommand.key, null))
	expect(normalizeSerializedMarkdown(serializer(view.state.doc))).toBe('- a\n- b')
})
