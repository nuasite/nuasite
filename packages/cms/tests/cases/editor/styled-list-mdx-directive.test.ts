import { defaultValueCtx, Editor, parserCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import type { Node as PmNode } from '@milkdown/prose/model'
import { afterEach, expect, test } from 'bun:test'
import { mdxComponentPlugin } from '../../../src/editor/milkdown-mdx-plugin'
import { mdxDirectiveSafetyPlugin, styledListPlugin } from '../../../src/editor/styled-list-plugin'

const editors: Editor[] = []

// Mirrors the inline editor's `.mdx` pipeline (markdown-inline-editor.tsx): commonmark +
// directive safety + gfm + the MDX component plugin (which brings remark-mdx). Before the
// directive plugin was wired in, `:::list{.class}` crashed acorn during parse.
async function createMdxEditor(useListStyles: boolean): Promise<Editor> {
	const root = document.createElement('div')
	document.body.append(root)
	const builder = Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, root)
			ctx.set(defaultValueCtx, '')
		})
		.use(commonmark)
		.use(useListStyles ? styledListPlugin : mdxDirectiveSafetyPlugin)
		.use(gfm)
	for (const plugin of mdxComponentPlugin) builder.use(plugin as never)
	const editor = await builder.create()
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

// The regression: under remark-mdx without remark-directive, this threw
// "Could not parse expression with acorn" — even for sites without list styles.
test('mdx editor without list styles: styled-list directive does not crash acorn', async () => {
	const editor = await createMdxEditor(false)
	const doc = parse(editor, ':::list{.dots-pink}\n- a\n- b\n:::')
	const list = doc.child(0)

	expect(list.type.name).toBe('bullet_list')
	expect(list.attrs.listStyle).toBe('dots-pink')
	expect(collectText(doc)).not.toContain(':::')
})

test('mdx editor without list styles: a stray colon in prose survives and round-trips', async () => {
	const editor = await createMdxEditor(false)
	const doc = parse(editor, 'klíč:hodnota dál')

	expect(collectText(doc)).toBe('klíč:hodnota dál')
	expect(serialize(editor, doc)).toBe('klíč:hodnota dál')
})

test('mdx editor with list styles: styled-list round-trips with `-` bullets', async () => {
	const editor = await createMdxEditor(true)
	const doc = parse(editor, ':::list{.dots-pink}\n- a\n- b\n:::')

	expect(doc.child(0).attrs.listStyle).toBe('dots-pink')
	expect(serialize(editor, doc)).toBe(':::list{.dots-pink}\n- a\n- b\n:::')
})

test('real MDX component blocks still parse', async () => {
	const editor = await createMdxEditor(false)
	const doc = parse(editor, '<Callout type="info">\n\nHello\n\n</Callout>')

	expect(doc.childCount).toBeGreaterThan(0)
})
