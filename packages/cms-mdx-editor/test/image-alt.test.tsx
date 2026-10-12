/**
 * "Edit alt" on an image that is already in the text. Rendered for real — a Milkdown editor
 * with the body editor's MDX pipeline and the toolbar bound to it — because the behaviour lives
 * in the selection tracking, the popover state and the transaction together.
 */
import { defaultValueCtx, Editor, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { NodeSelection, TextSelection } from '@milkdown/prose/state'
import { afterEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FormatToolbar } from '../src/format-toolbar'
import { mdxComponentNode, mdxEsmNode, remarkMdxPlugin } from '../src/mdx-plugin'
import type { MediaSource } from '../src/media-source'
import { styledListPlugin } from '../src/styled-list-plugin'

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let mounted: { editor: Editor; root: Root; host: HTMLElement } | null = null

afterEach(async () => {
	if (mounted === null) return
	const { editor, root, host } = mounted
	mounted = null
	await act(async () => {
		root.unmount()
	})
	await editor.destroy()
	host.remove()
	document.body.innerHTML = ''
})

async function mount(markdown: string, media?: MediaSource): Promise<{ editor: Editor; host: HTMLElement }> {
	const editorRoot = document.createElement('div')
	document.body.append(editorRoot)
	const editor = await Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, editorRoot)
			ctx.set(defaultValueCtx, markdown)
		})
		.use(commonmark)
		.use(styledListPlugin)
		.use(gfm)
		.use(remarkMdxPlugin)
		.use(mdxEsmNode)
		.use(mdxComponentNode)
		.create()

	const host = document.createElement('div')
	document.body.append(host)
	const root = createRoot(host)
	mounted = { editor, root, host }
	await act(async () => {
		root.render(<FormatToolbar editor={editor} media={media} />)
	})
	return { editor, host }
}

/** Format tracking is rAF-debounced, so let a frame pass inside `act`. */
async function settle(): Promise<void> {
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 40))
	})
}

function markdownOf(editor: Editor): string {
	return editor.ctx.get(serializerCtx)(editor.ctx.get(editorViewCtx).state.doc).trimEnd()
}

/** Positions of every image node, in document order. */
function imagePositions(editor: Editor): number[] {
	const positions: number[] = []
	editor.ctx.get(editorViewCtx).state.doc.descendants((node, pos) => {
		if (node.type.name === 'image') positions.push(pos)
	})
	return positions
}

async function selectImage(editor: Editor, index: number): Promise<void> {
	const view = editor.ctx.get(editorViewCtx)
	const pos = imagePositions(editor)[index]
	if (pos === undefined) throw new Error(`no image #${index}`)
	await act(async () => {
		view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
	})
	await settle()
}

async function selectStart(editor: Editor): Promise<void> {
	const view = editor.ctx.get(editorViewCtx)
	await act(async () => {
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
	})
	await settle()
}

function button(host: HTMLElement, label: string): HTMLButtonElement | null {
	for (const el of host.querySelectorAll('button')) {
		if (el.textContent?.trim() === label) return el
	}
	return null
}

async function click(host: HTMLElement, label: string): Promise<void> {
	const el = button(host, label)
	if (el === null) throw new Error(`no "${label}" button`)
	await act(async () => {
		el.click()
	})
	await settle()
}

function altInput(host: HTMLElement): HTMLInputElement {
	const input = host.querySelector('input[placeholder="Alt text for screen readers"]')
	if (!(input instanceof HTMLInputElement)) throw new Error('no alt input')
	return input
}

/** Type into a controlled input the way React's value tracker expects. */
async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
	const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
	await act(async () => {
		nativeValue?.set?.call(el, value)
		el.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

async function editAlt(host: HTMLElement, alt: string): Promise<void> {
	await click(host, 'Edit alt')
	await typeInto(altInput(host), alt)
	await click(host, 'Save')
}

describe('FormatToolbar — Edit alt', () => {
	test('is offered only while an image is selected, and without a media source', async () => {
		const { editor, host } = await mount('Text ![old](/uploads/a.png) text.')
		await selectStart(editor)
		expect(button(host, 'Edit alt')).toBeNull()

		await selectImage(editor, 0)
		expect(button(host, 'Edit alt')).not.toBeNull()
	})

	test('opens with the current alt and a preview of the image', async () => {
		const { editor, host } = await mount('Text ![Current alt](https://cdn.example.com/a.png) text.')
		await selectImage(editor, 0)
		await click(host, 'Edit alt')

		expect(altInput(host).value).toBe('Current alt')
		expect(host.querySelector('[data-mdx-image-preview]')?.getAttribute('src')).toBe('https://cdn.example.com/a.png')
		// An alt edit leaves the title (the insert flow's caption) alone, so it does not offer one.
		expect(host.querySelector('input[placeholder="Caption / source (optional)"]')).toBeNull()
	})

	test('previews a repository path through the media source', async () => {
		const media: MediaSource = {
			listMedia: () => Promise.reject(new Error('unused')),
			uploadMedia: () => Promise.reject(new Error('unused')),
			mediaAssetUrl: path => `https://bff.example.com/asset?path=${encodeURIComponent(path)}`,
		}
		const { editor, host } = await mount('![a](/uploads/a.png)', media)
		await selectImage(editor, 0)
		await click(host, 'Edit alt')

		expect(host.querySelector('[data-mdx-image-preview]')?.getAttribute('src')).toBe('https://bff.example.com/asset?path=%2Fuploads%2Fa.png')
	})

	test('rewrites the alt of an image in the middle of the text, keeping its url, title and surroundings', async () => {
		const { editor, host } = await mount('Before **bold** ![old](/uploads/a.png "The title") after.\n\nNext paragraph.')
		await selectImage(editor, 0)
		await editAlt(host, 'A new description')

		expect(markdownOf(editor)).toBe('Before **bold** ![A new description](/uploads/a.png "The title") after.\n\nNext paragraph.')
		expect(host.querySelector('[data-mdx-image-preview]')).toBeNull()
	})

	test('changes only the selected one of two images with the same url', async () => {
		const { editor, host } = await mount('![first](/uploads/same.png) and ![second](/uploads/same.png)')
		await selectImage(editor, 1)
		await editAlt(host, 'changed')

		expect(markdownOf(editor)).toBe('![first](/uploads/same.png) and ![changed](/uploads/same.png)')
	})

	test('saves an empty alt as an empty alt', async () => {
		const { editor, host } = await mount('Text ![decorative](/uploads/a.png) text.')
		await selectImage(editor, 0)
		await editAlt(host, '   ')

		expect(markdownOf(editor)).toBe('Text ![](/uploads/a.png) text.')
	})

	test('special characters survive a save and a reparse', async () => {
		const alt = 'A [bracketed] "quoted" *starred* _under_ {braced} <angled> back\\slash & ampersand'
		const { editor, host } = await mount('Text ![old](/uploads/a.png) text.')
		await selectImage(editor, 0)
		await editAlt(host, alt)

		const reparsed = editor.ctx.get(parserCtx)(markdownOf(editor))
		const alts: unknown[] = []
		reparsed.descendants(node => {
			if (node.type.name === 'image') alts.push(node.attrs.alt)
		})
		expect(alts).toEqual([alt])
	})

	test('Cancel leaves the document untouched', async () => {
		const input = 'Text ![old](/uploads/a.png "Title") text.'
		const { editor, host } = await mount(input)
		await selectImage(editor, 0)
		await click(host, 'Edit alt')
		await typeInto(altInput(host), 'discarded')
		await click(host, 'Cancel')

		expect(markdownOf(editor)).toBe(input)
		expect(host.querySelector('[data-mdx-image-preview]')).toBeNull()
	})

	test('moving the selection to another image abandons the edit', async () => {
		const input = '![first](/uploads/a.png) and ![second](/uploads/b.png)'
		const { editor, host } = await mount(input)
		await selectImage(editor, 0)
		await click(host, 'Edit alt')
		await typeInto(altInput(host), 'meant for the first')

		await selectImage(editor, 1)
		expect(host.querySelector('[data-mdx-image-preview]')).toBeNull()
		expect(markdownOf(editor)).toBe(input)
	})
})
