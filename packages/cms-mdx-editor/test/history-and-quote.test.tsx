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

/** The position right after the first occurrence of `text`. */
function positionAfter(editor: Editor, text: string): number {
	let pos: number | null = null
	editor.ctx.get(editorViewCtx).state.doc.descendants((node, nodePos) => {
		if (pos !== null || !node.isText) return pos === null
		const index = node.text?.indexOf(text) ?? -1
		if (index >= 0) pos = nodePos + index + text.length
		return false
	})
	if (pos === null) throw new Error(`"${text}" is not in the document`)
	return pos
}

/** Selects from right after `from` to right after `to`; without `to` it just places the cursor. */
function select(editor: Editor, from: string, to = from): void {
	const view = editor.ctx.get(editorViewCtx)
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, positionAfter(editor, from), positionAfter(editor, to))))
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

/** Clicks the first toolbar button whose title starts with `label`; the body editor's toolbar comes first. */
function click(label: string): Promise<void> {
	const button = document.querySelector<HTMLButtonElement>(`button[title^="${label}"]`)
	if (!button) throw new Error(`No "${label}" button in the toolbar`)
	return act(async () => button.click())
}

const press = (editor: Editor, label: string): Promise<void> => change(editor, () => click(label))

/**
 * Sends the shortcut to the editor the way a keyboard does: `Mod` is Cmd on a Mac and Ctrl
 * elsewhere, and with Shift held the browser reports the capital letter.
 */
function shortcut(editor: Editor, letter: string, shift = false): Promise<void> {
	const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
	const event = new KeyboardEvent('keydown', {
		key: shift ? letter.toUpperCase() : letter,
		keyCode: letter.toUpperCase().charCodeAt(0),
		shiftKey: shift,
		metaKey: mac,
		ctrlKey: !mac,
		bubbles: true,
		cancelable: true,
	})
	return change(editor, () =>
		act(async () => {
			editor.ctx.get(editorViewCtx).dom.dispatchEvent(event)
		}))
}

describe.each([
	['body editor', (value: string, onChange: (markdown: string) => void = () => {}) => <MdxBodyEditor value={value} onChange={onChange} />],
	['slot editor', (value: string, onChange: (markdown: string) => void = () => {}) => <SlotEditor value={value} onChange={onChange} />],
])('undo and redo in the %s', (_name, render) => {
	test('the toolbar buttons take back typing and bring it back', async () => {
		const editor = await mount(render('Hello'))
		select(editor, 'Hello')
		await type(editor, ' world')

		await press(editor, 'Undo')
		expect(markdown(editor)).toBe('Hello\n')

		await press(editor, 'Redo')
		expect(markdown(editor)).toBe('Hello world\n')
	})

	test('the keyboard shortcuts do the same', async () => {
		const editor = await mount(render('Hello'))
		select(editor, 'Hello')
		await type(editor, ' world')

		await shortcut(editor, 'z')
		expect(markdown(editor)).toBe('Hello\n')

		await shortcut(editor, 'z', true)
		expect(markdown(editor)).toBe('Hello world\n')

		// Mod-y redoes everywhere but on a Mac, where Cmd+Y belongs to the browser.
		await shortcut(editor, 'z')
		await shortcut(editor, 'y')
		expect(markdown(editor)).toBe('Hello world\n')
	})

	test('there is nothing to undo in the text the editor was opened with', async () => {
		const editor = await mount(render('Hello'))

		await click('Undo')

		expect(markdown(editor)).toBe('Hello\n')
	})

	test('undo does not bring back the text the host replaced', async () => {
		const onChange = mock((_markdown: string) => {})
		const editor = await mount(render('Hello', onChange))
		select(editor, 'Hello')
		await type(editor, ' local')

		await change(editor, () => act(async () => root?.render(render('Server copy', onChange))))
		await click('Undo')

		expect(markdown(editor)).toBe('Server copy\n')
		expect(onChange).not.toHaveBeenCalledWith('Hello\n')
	})
})

test('the body editor saves the text as it is after an undo', async () => {
	const onChange = mock((_markdown: string) => {})
	const editor = await mount(<MdxBodyEditor value="Hello" onChange={onChange} />)
	select(editor, 'Hello')
	await type(editor, ' world')

	await press(editor, 'Undo')

	expect(onChange).toHaveBeenLastCalledWith('Hello\n')
})

test('undo in the body toolbar takes back what was typed in a block that still has the focus', async () => {
	const components = [{ name: 'Note', file: 'src/components/Note.astro', props: [], slots: ['default'] }]
	await mount(<MdxBodyEditor value={'<Note>\n  one\n</Note>'} onChange={() => {}} components={components} />)
	await until(() => builtEditors().length === 2 && builtEditors().every(editor => editor.status === EditorStatus.Created))
	const [body, slot] = builtEditors()
	if (!body || !slot) throw new Error('The block did not build a slot editor')
	await act(async () => slot.ctx.get(editorViewCtx).focus())
	select(slot, 'one')
	await type(slot, ' two')

	// The slot hands its text to the block as it loses the focus, and then the undo takes it back.
	// The block is back where it started, so it is the slot that reports the change.
	await change(slot, () => click('Undo'))
	expect(markdown(body)).toBe('<Note>\n  one\n</Note>\n')
	expect(markdown(slot)).toBe('one\n')

	await change(slot, () => click('Redo'))
	expect(markdown(body)).toBe('<Note>\n  one two\n</Note>\n')
})

test('the slot editor hands over what was typed just before it lost the focus', async () => {
	const onChange = mock((_markdown: string) => {})
	const editor = await mount(<SlotEditor value="Hello" onChange={onChange} />)
	const view = editor.ctx.get(editorViewCtx)
	await act(async () => view.focus())
	select(editor, 'Hello')

	// Blurred before Milkdown has reported the typing.
	await act(async () => {
		view.dispatch(view.state.tr.insertText(' world'))
		view.dom.blur()
	})

	expect(onChange).toHaveBeenLastCalledWith('Hello world\n')
})

describe('the quote button', () => {
	test('quotes a paragraph that is not in a quote', async () => {
		const editor = await mount(<MdxBodyEditor value="Plain" onChange={() => {}} />)
		select(editor, 'Plain')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('> Plain\n')
	})

	test('takes the quote away when the cursor is in one', async () => {
		const editor = await mount(<MdxBodyEditor value={'Before\n\n> Quoted\n\nAfter'} onChange={() => {}} />)
		select(editor, 'Quoted')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('Before\n\nQuoted\n\nAfter\n')
	})

	test('takes the quote away from a selection that runs past it', async () => {
		const editor = await mount(<MdxBodyEditor value={'> Quoted\n\nAfter'} onChange={() => {}} />)
		select(editor, 'Quo', 'Aft')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('Quoted\n\nAfter\n')
	})

	test('takes away one level of a nested quote at a time', async () => {
		const editor = await mount(<MdxBodyEditor value="> > Nested" onChange={() => {}} />)
		select(editor, 'Nested')

		await press(editor, 'Quote')
		expect(markdown(editor)).toBe('> Nested\n')

		await press(editor, 'Quote')
		expect(markdown(editor)).toBe('Nested\n')
	})

	test('keeps a list in the quote a list', async () => {
		const editor = await mount(<MdxBodyEditor value={'> * one\n> * two'} onChange={() => {}} />)
		select(editor, 'one')

		await press(editor, 'Quote')

		expect(markdown(editor)).toBe('* one\n* two\n')
	})

	test('can be undone', async () => {
		const editor = await mount(<MdxBodyEditor value="> Quoted" onChange={() => {}} />)
		select(editor, 'Quoted')

		await press(editor, 'Quote')
		await press(editor, 'Undo')

		expect(markdown(editor)).toBe('> Quoted\n')
	})
})
