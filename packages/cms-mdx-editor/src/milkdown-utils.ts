/**
 * Selection/format helpers over a ProseMirror `EditorView` — used by the toolbar
 * (`format-toolbar.tsx`) and the nested slot editor to reflect and toggle inline/
 * block formatting. Framework-agnostic port of `@nuasite/cms`'s `milkdown-utils.ts`
 * (it never depended on preact — it operates on the raw view).
 */
import { type Editor, editorViewCtx } from '@milkdown/core'
import type { EditorView } from '@milkdown/prose/view'

export interface ActiveFormats {
	bold: boolean
	italic: boolean
	strikethrough: boolean
	link: boolean
	linkHref: string | null
	bulletList: boolean
	orderedList: boolean
	listStyle: string | null
	blockquote: boolean
	heading: number | null
}

export const defaultActiveFormats: ActiveFormats = {
	bold: false,
	italic: false,
	strikethrough: false,
	link: false,
	linkHref: null,
	bulletList: false,
	orderedList: false,
	listStyle: null,
	blockquote: false,
	heading: null,
}

/** Detect active inline/block formats at the current selection. */
export function getActiveFormats(view: EditorView): ActiveFormats {
	const { state } = view
	const { $from, from, to } = state.selection

	let bold = false
	let italic = false
	let strikethrough = false
	let link = false
	let linkHref: string | null = null

	const marks = state.storedMarks || $from.marks()
	for (const mark of marks) {
		if (mark.type.name === 'strong') bold = true
		if (mark.type.name === 'emphasis') italic = true
		if (mark.type.name === 'strike_through') strikethrough = true
		if (mark.type.name === 'link') {
			link = true
			linkHref = typeof mark.attrs.href === 'string' ? mark.attrs.href : null
		}
	}

	if (from !== to) {
		state.doc.nodesBetween(from, to, (node) => {
			for (const mark of node.marks) {
				if (mark.type.name === 'strong') bold = true
				if (mark.type.name === 'emphasis') italic = true
				if (mark.type.name === 'strike_through') strikethrough = true
				if (mark.type.name === 'link') {
					link = true
					linkHref = typeof mark.attrs.href === 'string' ? mark.attrs.href : null
				}
			}
		})
	}

	let bulletList = false
	let orderedList = false
	let listStyle: string | null = null
	let blockquote = false
	let heading: number | null = null

	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth)
		if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
			if (node.type.name === 'bullet_list') bulletList = true
			if (node.type.name === 'ordered_list') orderedList = true
			if (listStyle === null) listStyle = typeof node.attrs.listStyle === 'string' ? node.attrs.listStyle : null
		}
		if (node.type.name === 'blockquote') blockquote = true
	}

	if ($from.parent.type.name === 'heading') {
		const level = $from.parent.attrs.level
		heading = typeof level === 'number' ? level : null
	}

	return { bold, italic, strikethrough, link, linkHref, bulletList, orderedList, listStyle, blockquote, heading }
}

/** Whether the current selection is inside a list of the given node-type name. */
export function isInListType(view: EditorView, listType: string): boolean {
	const { $from } = view.state.selection
	for (let depth = $from.depth; depth > 0; depth--) {
		if ($from.node(depth).type.name === listType) return true
	}
	return false
}

/**
 * Toggle a heading level at the current selection. A heading already at `level`
 * is converted back to a paragraph.
 */
export function toggleHeading(view: EditorView, level: number): void {
	const { state } = view
	const headingType = state.schema.nodes.heading
	const paragraphType = state.schema.nodes.paragraph
	if (!headingType || !paragraphType) return

	const { $from } = state.selection
	const isCurrentHeading = $from.parent.type.name === 'heading' && $from.parent.attrs.level === level
	const targetType = isCurrentHeading ? paragraphType : headingType
	const attrs = isCurrentHeading ? undefined : { level }

	const blockFrom = $from.before($from.depth)
	const blockTo = state.selection.$to.after(state.selection.$to.depth)
	view.dispatch(state.tr.setBlockType(blockFrom, blockTo, targetType, attrs))
	view.focus()
}

/** Remove the link mark around the current cursor/selection. */
export function removeLinkMark(view: EditorView): void {
	const { state } = view
	const { from, to } = state.selection
	const linkType = state.schema.marks.link
	if (!linkType) return
	let linkFrom = from
	let linkTo = to
	state.doc.nodesBetween(from, from === to ? to + 1 : to, (node, pos) => {
		if (linkType.isInSet(node.marks)) {
			linkFrom = pos
			linkTo = pos + node.nodeSize
			return false
		}
	})
	view.dispatch(state.tr.removeMark(linkFrom, linkTo, linkType))
}

function formatsEqual(a: ActiveFormats, b: ActiveFormats): boolean {
	return a.bold === b.bold
		&& a.italic === b.italic
		&& a.strikethrough === b.strikethrough
		&& a.link === b.link
		&& a.linkHref === b.linkHref
		&& a.bulletList === b.bulletList
		&& a.orderedList === b.orderedList
		&& a.listStyle === b.listStyle
		&& a.blockquote === b.blockquote
		&& a.heading === b.heading
}

/**
 * Wrap the view's `dispatch` to track active formats (rAF-debounced), firing the
 * callback only when they change. Returns a cleanup that cancels a pending frame.
 */
export function setupFormatTracking(editor: Editor, callback: (formats: ActiveFormats) => void): () => void {
	let formatRaf = 0
	let lastFormats: ActiveFormats = defaultActiveFormats

	const update = () => {
		const view = editor.ctx.get(editorViewCtx)
		const formats = getActiveFormats(view)
		if (!formatsEqual(formats, lastFormats)) {
			lastFormats = formats
			callback(formats)
		}
	}

	const view = editor.ctx.get(editorViewCtx)
	const origDispatch = view.dispatch.bind(view)
	view.dispatch = (tr) => {
		origDispatch(tr)
		if (tr.selectionSet || tr.docChanged) {
			cancelAnimationFrame(formatRaf)
			formatRaf = requestAnimationFrame(update)
		}
	}

	update()

	return () => {
		cancelAnimationFrame(formatRaf)
	}
}
