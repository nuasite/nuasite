import { defaultValueCtx, Editor, parserCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import type { Node as PmNode } from '@milkdown/prose/model'
import { afterEach, expect, test } from 'bun:test'
import { mdxComponentNode, mdxEsmNode, remarkMdxPlugin } from '../src/mdx-plugin'
import { styledListPlugin } from '../src/styled-list-plugin'

const editors: Editor[] = []

// Mirrors the parsing half of mdx-body-editor.tsx: commonmark + styled lists + gfm
// with remark-mdx active. Before remark-directive was registered, `:::list{.class}`
// and any other `{...}`-carrying directive crashed acorn during parse.
async function createMdxEditor(): Promise<Editor> {
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

function collectText(node: PmNode): string {
	const parts: string[] = []
	node.descendants((child) => {
		if (child.isText && child.text) parts.push(child.text)
		return true
	})
	return parts.join('')
}

afterEach(async () => {
	for (const editor of editors.splice(0)) await editor.destroy()
	document.body.innerHTML = ''
})

// The regression: with remark-mdx but no remark-directive, parsing this threw
// "Could not parse expression with acorn" because MDX read `{.dots-pink}` as JS.
test('styled-list directive parses under the MDX pipeline without crashing acorn', async () => {
	const editor = await createMdxEditor()
	const input = ':::list{.dots-pink}\n- a\n- b\n:::'
	const doc = parse(editor, input)
	const list = doc.child(0)

	expect(list.type.name).toBe('bullet_list')
	expect(list.attrs.listStyle).toBe('dots-pink')
	expect(collectText(doc)).not.toContain(':::')
	expect(serialize(editor, doc)).toBe(':::list{.dots-pink}\n* a\n* b\n:::')
})

// A stray colon in prose now parses as a `textDirective`; it must be restored to
// text or Milkdown throws on the unknown node type (and the colon would be lost).
test('a stray colon in prose survives and round-trips', async () => {
	const editor = await createMdxEditor()
	const doc = parse(editor, 'klíč:hodnota dál')

	expect(collectText(doc)).toBe('klíč:hodnota dál')
	expect(serialize(editor, doc)).toBe('klíč:hodnota dál')
})

// An unknown directive must not crash the editor and must not be silently dropped —
// it is restored to its literal text (no Milkdown node exists for it). (`youtube` is
// special-cased to a real node and is covered by youtube-node.test.ts.)
test('an unknown directive does not crash and keeps its content', async () => {
	const editor = await createMdxEditor()
	const doc = parse(editor, ':::aside{.box}\nhello\n:::')

	const text = collectText(doc)
	expect(text).toContain(':::aside{.box}')
	expect(text).toContain('hello')
})

// Genuine MDX expressions must still parse — the fix only claims directive syntax.
test('real MDX component blocks still parse', async () => {
	const editor = await createMdxEditor()
	const doc = parse(editor, '<Callout type="info">\n\nHello\n\n</Callout>')

	expect(collectText(doc)).not.toContain('Could not parse')
	expect(doc.childCount).toBeGreaterThan(0)
})
