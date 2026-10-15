/**
 * Undo/redo and the quote button, driven the way an editor uses them: the real components are
 * mounted, text is typed through their view, and the toolbar buttons and shortcuts are pressed.
 */
import { Editor, EditorStatus, editorViewCtx } from '@milkdown/core'
import { listenerCtx } from '@milkdown/plugin-listener'
import { TextSelection } from '@milkdown/prose/state'
import { getMarkdown } from '@milkdown/utils'
import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MdxBodyEditor } from '../src/mdx-body-editor'
import { SlotEditor } from '../src/slot-editor'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

/** The editor is created asynchronously. */
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

const markdown = (editor: Editor): string => editor.action(getMarkdown())

/** Puts the cursor right after the first occurrence of `text`. */
function placeCursorAfter(editor: Editor, text: string): void {
	const view = editor.ctx.get(editorViewCtx)
	let pos: number | null = null
	view.state.doc.descendants((node, nodePos) => {
		if (pos !== null || !node.isText) return pos === null
		const index = node.text?.indexOf(text) ?? -1
		if (index >= 0) pos = nodePos + index + text.length
		return false
	})
	if (pos === null) throw new Error(`"${text}" is not in the document`)
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/**
 * Runs a change and waits until Milkdown has reported it to the component. The report comes a
 * moment later, and once the editor is gone it can no longer be made.
 */
async function change(editor: Editor, run: () => void | Promise<void>): Promise<void> {
	let reported = false
	// The component subscribed first, so by the time this runs it has the new Markdown.
	editor.ctx.get(listenerCtx).markdownUpdated(() => {
		reported = true
	})
	await run()
	await until(() => reported)
}

function type(editor: Editor, text: string): Promise<void> {
	return change(editor, () => {
		const view = editor.ctx.get(editorViewCtx)
		view.dispatch(view.state.tr.insertText(text))
	})
}

function click(title: string): Promise<void> {
	const button = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
	if (!button) throw new Error(`No "${title}" button in the toolbar`)
	return act(async () => button.click())
}

const press = (editor: Editor, title: string): Promise<void> => change(editor, () => click(title))

/** Sends the shortcut to the editor the way a keyboard does; `Mod` is Cmd on a Mac and Ctrl elsewhere. */
function shortcut(editor: Editor, key: string, shift = false): Promise<void> {
	const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
	const event = new KeyboardEvent('keydown', { key, shiftKey: shift, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
	return change(editor, () =>
		act(async () => {
			editor.ctx.get(editorViewCtx).dom.dispatchEvent(event)
		}))
}

describe.each([
	['body editor', (value: string) => <MdxBodyEditor value={value} onChange={() => {}} />],
	['slot editor', (value: string) => <SlotEditor value={value} onChange={() => {}} />],
])('undo and redo in the %s', (_name, render) => {
	test('the toolbar buttons take back typing and bring it back', async () => {
		const editor = await mount(render('Hello'))
		placeCursorAfter(editor, 'Hello')
		await type(editor, ' world')

		await press(editor, 'Undo (Ctrl+Z)')
		expect(markdown(editor)).toBe('Hello\n')

		await press(editor, 'Redo (Ctrl+Shift+Z)')
		expect(markdown(editor)).toBe('Hello world\n')
	})

	test('the keyboard shortcuts do the same', async () => {
		const editor = await mount(render('Hello'))
		placeCursorAfter(editor, 'Hello')
		await type(editor, ' world')

		await shortcut(editor, 'z')
		expect(markdown(editor)).toBe('Hello\n')

		await shortcut(editor, 'z', true)
		expect(markdown(editor)).toBe('Hello world\n')

		await shortcut(editor, 'z')
		await shortcut(editor, 'y')
		expect(markdown(editor)).toBe('Hello world\n')
	})

	test('there is nothing to undo in the text the editor was opened with', async () => {
		const editor = await mount(render('Hello'))

		await click('Undo (Ctrl+Z)')

		expect(markdown(editor)).toBe('Hello\n')
	})
})

test('the body editor saves the text as it is after an undo', async () => {
	const onChange = mock((_markdown: string) => {})
	const editor = await mount(<MdxBodyEditor value="Hello" onChange={onChange} />)
	placeCursorAfter(editor, 'Hello')
	await type(editor, ' world')

	await press(editor, 'Undo (Ctrl+Z)')

	expect(onChange).toHaveBeenLastCalledWith('Hello\n')
})

describe('the quote button', () => {
	test('quotes a paragraph that is not in a quote', async () => {
		const editor = await mount(<MdxBodyEditor value="Plain" onChange={() => {}} />)
		placeCursorAfter(editor, 'Plain')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('> Plain\n')
	})

	test('takes the quote away when the cursor is in one', async () => {
		const editor = await mount(<MdxBodyEditor value={'Before\n\n> Quoted\n\nAfter'} onChange={() => {}} />)
		placeCursorAfter(editor, 'Quoted')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('Before\n\nQuoted\n\nAfter\n')
	})

	test('takes away one level of a nested quote at a time', async () => {
		const editor = await mount(<MdxBodyEditor value="> > Nested" onChange={() => {}} />)
		placeCursorAfter(editor, 'Nested')

		await press(editor, 'Quote')
		expect(markdown(editor)).toBe('> Nested\n')

		await press(editor, 'Quote')
		expect(markdown(editor)).toBe('Nested\n')
	})

	test('keeps a list in the quote a list', async () => {
		const editor = await mount(<MdxBodyEditor value={'> * one\n> * two'} onChange={() => {}} />)
		placeCursorAfter(editor, 'one')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('* one\n* two\n')
	})

	test('can be undone', async () => {
		const editor = await mount(<MdxBodyEditor value="> Quoted" onChange={() => {}} />)
		placeCursorAfter(editor, 'Quoted')

		await press(editor, 'Quote')
		await press(editor, 'Undo (Ctrl+Z)')

		expect(markdown(editor)).toBe('> Quoted\n')
	})
})
