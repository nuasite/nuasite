import { defaultValueCtx, Editor, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import type { Node as PmNode } from '@milkdown/prose/model'
import { callCommand } from '@milkdown/utils'
import { afterEach, expect, test } from 'bun:test'
import { mdxComponentNode, mdxEsmNode, remarkMdxPlugin } from '../src/mdx-plugin'
import { styledListPlugin } from '../src/styled-list-plugin'
import { insertYoutubeCommand, remarkYoutubeDirectivePlugin, youtubeNode } from '../src/youtube-plugin'

const editors: Editor[] = []

// Full youtube wiring on top of the MDX pipeline (no React node-view — parse/serialize
// run via parserCtx/serializerCtx without rendering, so the view never instantiates).
async function createEditor(): Promise<Editor> {
	const root = document.createElement('div')
	document.body.append(root)
	const editor = await Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, root)
			ctx.set(defaultValueCtx, '')
		})
		.use(commonmark)
		.use(styledListPlugin)
		.use(gfm)
		.use(remarkMdxPlugin)
		.use(mdxEsmNode)
		.use(mdxComponentNode)
		.use(remarkYoutubeDirectivePlugin)
		.use(youtubeNode)
		.use(insertYoutubeCommand)
		.create()
	editors.push(editor)
	return editor
}

function normalize(markdown: string): string {
	return markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown
}

function parse(editor: Editor, markdown: string): PmNode {
	return editor.ctx.get(parserCtx)(markdown)
}

function serialize(editor: Editor, doc: PmNode): string {
	return normalize(editor.ctx.get(serializerCtx)(doc))
}

afterEach(async () => {
	for (const editor of editors.splice(0)) await editor.destroy()
	document.body.innerHTML = ''
})

test('leaf directive with a letter-first id round-trips verbatim', async () => {
	const editor = await createEditor()
	const input = '::youtube{#dQw4w9WgXcQ}'
	const doc = parse(editor, input)

	expect(doc.child(0).type.name).toBe('youtube')
	expect(doc.child(0).attrs.videoId).toBe('dQw4w9WgXcQ')
	expect(serialize(editor, doc)).toBe(input)
})

// The whole point: ids starting with a digit used to crash acorn under remark-mdx.
test('leaf directive with a digit-first id does not crash and round-trips', async () => {
	const editor = await createEditor()
	const input = '::youtube{#9bZkp7q19f0}'
	const doc = parse(editor, input)

	expect(doc.child(0).type.name).toBe('youtube')
	expect(doc.child(0).attrs.videoId).toBe('9bZkp7q19f0')
	expect(serialize(editor, doc)).toBe(input)
})

// Legacy `:::youtube{id}` (bare attribute, only ever worked for letter-first ids) is
// still read, and normalized to the new leaf form on save.
test('legacy bare container directive is read and normalized', async () => {
	const editor = await createEditor()
	const doc = parse(editor, ':::youtube{dQw4w9WgXcQ}\n:::')

	expect(doc.child(0).type.name).toBe('youtube')
	expect(doc.child(0).attrs.videoId).toBe('dQw4w9WgXcQ')
	expect(serialize(editor, doc)).toBe('::youtube{#dQw4w9WgXcQ}')
})

test('insert command produces a node that serializes to the leaf directive', async () => {
	const editor = await createEditor()
	editor.action(callCommand(insertYoutubeCommand.key, '9bZkp7q19f0'))
	const doc = editor.ctx.get(editorViewCtx).state.doc

	expect(serialize(editor, doc)).toContain('::youtube{#9bZkp7q19f0}')
})
