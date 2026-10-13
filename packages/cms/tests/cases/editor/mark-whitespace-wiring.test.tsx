/** @jsxImportSource preact */
/**
 * The in-page Markdown editor and the slot editor of a component block each build their own
 * Milkdown editor, so each has to load `markWhitespacePlugin` itself. `mark-whitespace.test.ts`
 * builds its own pipeline and stays green when a component drops the plugin; here the real
 * components are mounted, text is pasted through their editor, and the Markdown they hand on
 * is read. (The pragma: this folder compiles JSX against React, the editor is Preact.)
 */
import { Editor, EditorStatus, editorViewCtx } from '@milkdown/core'
import { listenerCtx } from '@milkdown/plugin-listener'
import { afterAll, afterEach, expect, mock, spyOn, test } from 'bun:test'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { MarkdownInlineEditor } from '../../../src/editor/components/markdown-inline-editor'
import { MdxBlockCard } from '../../../src/editor/components/mdx-block-view'
import { currentMarkdownPage, resetMarkdownEditorState, setMarkdownPage } from '../../../src/editor/signals'

/** Bold text the way Word puts it on the clipboard: the non-breaking space is part of the bold run. */
const PASTED = '<p><b>Question?&nbsp;</b>Answer.</p>'
const SAVED = '**Question?**\u00a0Answer.\n'

// The components keep their editor to themselves; watching `Editor.make` is the way to reach it.
const make = spyOn(Editor, 'make')
const builtEditors = (): Editor[] => make.mock.results.flatMap(result => (result.type === 'return' ? [result.value] : []))

let host: HTMLElement | null = null

afterEach(async () => {
	await act(() => {
		if (host) render(null, host)
	})
	host = null
	// Unmounting makes the component destroy its editor, which takes a moment.
	await until(() => builtEditors().every(editor => editor.status === EditorStatus.Destroyed))
	make.mockClear()
	resetMarkdownEditorState()
	document.body.innerHTML = ''
})

afterAll(() => {
	make.mockRestore()
})

/** The editor is created, and reports its changes, asynchronously. */
async function until(condition: () => boolean): Promise<void> {
	for (let attempt = 0; !condition(); attempt++) {
		if (attempt === 200) throw new Error('Timed out waiting for the editor')
		await act(() => new Promise<void>(resolve => setTimeout(resolve, 10)))
	}
}

async function mount(element: VNode): Promise<Editor> {
	const container = document.body.appendChild(document.createElement('div'))
	host = container
	await act(() => render(element, container))
	const editor = builtEditors().at(-1)
	if (!editor) throw new Error('The component did not build an editor')
	await until(() => editor.status === EditorStatus.Created)
	return editor
}

/** Pastes through the editor's own view, then waits until Milkdown has reported the change to the component. */
async function paste(editor: Editor): Promise<void> {
	let reported = false
	// The component subscribed first, so by the time this runs it has the new Markdown.
	editor.ctx.get(listenerCtx).markdownUpdated(() => {
		reported = true
	})
	await act(() => {
		editor.ctx.get(editorViewCtx).pasteHTML(PASTED)
	})
	await until(() => reported)
}

for (const isMdx of [false, true]) {
	test(`the in-page editor saves pasted bold that ends in a non-breaking space as bold (${isMdx ? '.mdx' : '.md'})`, async () => {
		// The editor writes its Markdown into the page that is open for editing.
		setMarkdownPage({ filePath: 'src/content/blog/post.md', slug: 'post', frontmatter: {}, content: '', isDirty: false })
		const editor = await mount(<MarkdownInlineEditor elementId="post" initialContent="" isMdx={isMdx} onSave={() => {}} onCancel={() => {}} />)

		await paste(editor)

		expect(currentMarkdownPage.value?.content).toBe(SAVED)
	})
}

test('the slot editor of a component block saves it as bold too', async () => {
	const onSlotContentChange = mock((_markdown: string) => {})
	const editor = await mount(
		<MdxBlockCard componentName="Box" props={{}} hasExpressions={false} slotContent="" onRemove={() => {}} onSlotContentChange={onSlotContentChange} />,
	)

	await paste(editor)
	// The slot editor hands over its Markdown when it loses focus.
	await act(() => {
		editor.ctx.get(editorViewCtx).dom.dispatchEvent(new FocusEvent('blur'))
	})

	expect(onSlotContentChange).toHaveBeenLastCalledWith(SAVED)
})
