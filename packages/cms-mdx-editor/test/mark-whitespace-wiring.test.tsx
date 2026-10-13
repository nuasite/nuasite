/**
 * The body editor and the slot editor each build their own Milkdown editor, so each has to
 * load `markWhitespacePlugin` itself. `mark-whitespace.test.ts` builds its own pipeline and
 * stays green when a component drops the plugin; here the real components are mounted, text
 * is pasted through their editor, and the Markdown they hand to `onChange` is read.
 */
import { Editor, EditorStatus, editorViewCtx } from '@milkdown/core'
import { listenerCtx } from '@milkdown/plugin-listener'
import { afterAll, afterEach, expect, mock, spyOn, test } from 'bun:test'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MdxBodyEditor } from '../src/mdx-body-editor'
import { SlotEditor } from '../src/slot-editor'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Bold text the way Word puts it on the clipboard: the non-breaking space is part of the bold run. */
const PASTED = '<p><b>Question?&nbsp;</b>Answer.</p>'
const SAVED = '**Question?**\u00a0Answer.\n'

// The components keep their editor to themselves; watching `Editor.make` is the way to reach it.
const make = spyOn(Editor, 'make')
const builtEditors = (): Editor[] => make.mock.results.flatMap(result => (result.type === 'return' ? [result.value] : []))

let root: Root | null = null

afterEach(async () => {
	await act(async () => root?.unmount())
	root = null
	// Unmounting makes the component destroy its editor, which takes a moment.
	await until(() => builtEditors().every(editor => editor.status === EditorStatus.Destroyed))
	make.mockClear()
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

async function mount(element: ReactElement): Promise<Editor> {
	root = createRoot(document.body.appendChild(document.createElement('div')))
	await act(async () => root?.render(element))
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
	await act(async () => editor.ctx.get(editorViewCtx).pasteHTML(PASTED))
	await until(() => reported)
}

test('the body editor saves pasted bold that ends in a non-breaking space as bold', async () => {
	const onChange = mock((_markdown: string) => {})
	const editor = await mount(<MdxBodyEditor value="" onChange={onChange} />)

	await paste(editor)

	expect(onChange).toHaveBeenLastCalledWith(SAVED)
})

test('the slot editor of a component block saves it as bold too', async () => {
	const onChange = mock((_markdown: string) => {})
	const editor = await mount(<SlotEditor value="" onChange={onChange} />)

	await paste(editor)
	// The slot editor hands over its Markdown when it loses focus.
	await act(async () => editor.ctx.get(editorViewCtx).dom.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

	expect(onChange).toHaveBeenLastCalledWith(SAVED)
})
