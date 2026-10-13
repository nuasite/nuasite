import { defaultValueCtx, Editor, parserCtx, rootCtx, schemaCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import type { Mark, Node as PmNode, Schema } from '@milkdown/prose/model'
import { afterEach, expect, test } from 'bun:test'
import { markWhitespacePlugin } from '../src/mark-whitespace'
import { mdxComponentNode, mdxEsmNode, remarkMdxPlugin } from '../src/mdx-plugin'
import { styledListPlugin } from '../src/styled-list-plugin'

const NBSP = '\u00a0'

const editors: Editor[] = []

async function createEditor(): Promise<Editor> {
	const root = document.createElement('div')
	document.body.append(root)
	const editor = await Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, root)
			ctx.set(defaultValueCtx, '')
		})
		.use(commonmark)
		.use(gfm)
		.use(markWhitespacePlugin)
		.create()
	editors.push(editor)
	return editor
}

type Run = string | { text: string; marks: string[] }

/** A document of one paragraph, built the way typing or pasting leaves it: marks on text runs. */
function paragraph(schema: Schema, runs: Run[]): PmNode {
	const nodes = runs.map((run) => {
		if (typeof run === 'string') return schema.text(run)
		const marks: Mark[] = run.marks.map((name) => {
			const type = schema.marks[name]
			if (!type) throw new Error(`The schema has no mark ${name}`)
			return type.create()
		})
		return schema.text(run.text, marks)
	})
	const doc = schema.topNodeType.createAndFill(null, [schema.node('paragraph', null, nodes)])
	if (!doc) throw new Error('The schema did not build a document')
	return doc
}

async function save(runs: Run[]): Promise<string> {
	const editor = await createEditor()
	const markdown = editor.ctx.get(serializerCtx)(paragraph(editor.ctx.get(schemaCtx), runs))
	return markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown
}

/** What the saved Markdown renders as: the text of each run with the marks that reached it. */
async function reopen(markdown: string): Promise<Array<{ text: string; marks: string[] }>> {
	const editor = await createEditor()
	const doc = editor.ctx.get(parserCtx)(markdown)
	const runs: Array<{ text: string; marks: string[] }> = []
	doc.descendants((node) => {
		if (node.isText) runs.push({ text: node.text ?? '', marks: node.marks.map((mark) => mark.type.name).sort() })
	})
	return runs
}

afterEach(async () => {
	for (const editor of editors.splice(0)) {
		await editor.destroy()
	}
	document.body.innerHTML = ''
})

// Text pasted from Word or an e-mail often ends in a non-breaking space. Left inside the
// markers (`**Question?  **`) it is not emphasis in Markdown, and the site shows the asterisks.
test('bold ending in non-breaking spaces is saved with the spaces after the markers', async () => {
	const markdown = await save([{ text: `Question?${NBSP}${NBSP}`, marks: ['strong'] }, 'Answer.'])

	expect(markdown).toBe(`**Question?**${NBSP}${NBSP}Answer.`)
	expect(await reopen(markdown)).toEqual([
		{ text: 'Question?', marks: ['strong'] },
		{ text: `${NBSP}${NBSP}Answer.`, marks: [] },
	])
})

test('italic starting with a non-breaking space and ending in a tab keeps both outside the markers', async () => {
	const markdown = await save(['Some ', { text: `${NBSP}italic\t`, marks: ['emphasis'] }, 'text.'])

	expect(markdown).toBe(`Some ${NBSP}*italic*\ttext.`)
	expect(await reopen(markdown)).toEqual([
		{ text: `Some ${NBSP}`, marks: [] },
		{ text: 'italic', marks: ['emphasis'] },
		{ text: '\ttext.', marks: [] },
	])
})

test('bold that holds nothing but a non-breaking space is saved as the space alone', async () => {
	const markdown = await save(['Before', { text: NBSP, marks: ['strong'] }, 'after.'])

	expect(markdown).toBe(`Before${NBSP}after.`)
})

// Milkdown moves a plain space out itself and leaves the emptied mark behind (`****`).
test('a mark that held only whitespace leaves no markers, whichever whitespace it was', async () => {
	expect(await save(['Before', { text: ' ', marks: ['strong'] }, 'after.'])).toBe('Before after.')
	expect(await save(['Before', { text: ` ${NBSP}`, marks: ['strong'] }, 'after.'])).toBe(`Before ${NBSP}after.`)
	expect(await save(['Before', { text: `${NBSP} `, marks: ['emphasis'] }, 'after.'])).toBe(`Before${NBSP} after.`)
})

// Written before the markers, a tab at the start of a paragraph would make it a code block.
test('a tab moved out at the start of a paragraph is not written', async () => {
	const markdown = await save([{ text: '\tIndented', marks: ['strong'] }, ' rest.'])

	expect(markdown).toBe('**Indented** rest.')
	expect(await reopen(markdown)).toEqual([
		{ text: 'Indented', marks: ['strong'] },
		{ text: ' rest.', marks: [] },
	])
	expect(await save([{ text: `\t${NBSP}Indented`, marks: ['strong'] }, ' rest.'])).toBe(`${NBSP}**Indented** rest.`)
})

test('a non-breaking space moved out at the start of a paragraph stays', async () => {
	expect(await save([{ text: `${NBSP}Bold`, marks: ['strong'] }, ' rest.'])).toBe(`${NBSP}**Bold** rest.`)
})

test('bold and italic together move the edge whitespace out of both', async () => {
	const markdown = await save([{ text: `Both${NBSP}`, marks: ['strong', 'emphasis'] }, 'end.'])

	expect(await reopen(markdown)).toEqual([
		{ text: 'Both', marks: ['emphasis', 'strong'] },
		{ text: `${NBSP}end.`, marks: [] },
	])
})

test('whitespace uncovered by an emptied inner mark moves out as well', async () => {
	const markdown = await save([
		{ text: NBSP, marks: ['strong', 'emphasis'] },
		{ text: `${NBSP}bold`, marks: ['strong'] },
		' end.',
	])

	expect(markdown).toBe(`${NBSP}${NBSP}**bold** end.`)
})

test('struck-through text gives up its edge whitespace too', async () => {
	const markdown = await save([{ text: `gone${NBSP}`, marks: ['strike_through'] }, 'kept.'])

	expect(markdown).toBe(`~~gone~~${NBSP}kept.`)
	expect(await reopen(markdown)).toEqual([
		{ text: 'gone', marks: ['strike_through'] },
		{ text: `${NBSP}kept.`, marks: [] },
	])
})

test('whitespace inside the marked text stays where it is', async () => {
	const markdown = await save([{ text: `two${NBSP}words`, marks: ['strong'] }, ' end.'])

	expect(markdown).toBe(`**two${NBSP}words** end.`)
})

// The body editor's own pipeline: the tree is corrected next to remark-mdx and the directives.
async function createBodyEditor(fixed: boolean): Promise<Editor> {
	const root = document.createElement('div')
	document.body.append(root)
	const builder = Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, root)
			ctx.set(defaultValueCtx, '')
		})
		.use(commonmark)
		.use(styledListPlugin)
		.use(gfm)
	if (fixed) builder.use(markWhitespacePlugin)
	const editor = await builder
		.use(remarkMdxPlugin)
		.use(mdxEsmNode)
		.use(mdxComponentNode)
		.create()
	editors.push(editor)
	return editor
}

test('an MDX body saves bold from pasted text the same way', async () => {
	const editor = await createBodyEditor(true)
	const doc = paragraph(editor.ctx.get(schemaCtx), [{ text: `Question?${NBSP}`, marks: ['strong'] }, 'Answer.'])

	expect(editor.ctx.get(serializerCtx)(doc)).toBe(`**Question?**${NBSP}Answer.\n`)
})

test('an MDX body with components, lists and marks is saved as it was without the correction', async () => {
	const source = [
		"import Box from '../components/Box.astro'",
		'<Box title="A" />',
		':::list{.checkmarks}\n- one **bold** item\n- *italic* and ~~gone~~\n:::',
		'A **bold** and *italic* word with a [**bold link**](https://example.com).',
	].join('\n\n')
	const roundTrip = async (fixed: boolean) => {
		const editor = await createBodyEditor(fixed)
		return editor.ctx.get(serializerCtx)(editor.ctx.get(parserCtx)(source))
	}

	const saved = await roundTrip(true)
	expect(saved).toBe(await roundTrip(false))
	expect(saved).toContain('<Box title="A" />')
	expect(saved).toContain('**bold**')
})

test('marked text without edge whitespace is saved as before', async () => {
	expect(await save(['A ', { text: 'bold', marks: ['strong'] }, ' and ', { text: 'italic', marks: ['emphasis'] }, ' word.']))
		.toBe('A **bold** and *italic* word.')
})
