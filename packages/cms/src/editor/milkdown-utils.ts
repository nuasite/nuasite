import type { Editor } from '@milkdown/core'
import { editorViewCtx } from '@milkdown/core'
import type { EditorView } from '@milkdown/prose/view'

export interface ActiveFormats {
	bold: boolean
	italic: boolean
	strikethrough: boolean
	link: boolean
	linkHref: string | null
	bulletList: boolean
	orderedList: boolean
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
	blockquote: false,
	heading: null,
}

/**
 * Detect active inline/block formats at the current selection in a ProseMirror view.
 */
export function getActiveFormats(view: EditorView): ActiveFormats {
	const { state } = view
	const { $from, from, to } = state.selection

	// Check marks (inline formatting)
	let bold = false
	let italic = false
	let strikethrough = false
	let link = false
	let linkHref: string | null = null

	const marks = state.storedMarks || $from.marks()
	for (const mark of marks) {
		if (mark.type.name === 'strong') bold = true
		if (mark.type.name === 'emphasis') italic = true
		if (mark.type.name === 'strikethrough') strikethrough = true
		if (mark.type.name === 'link') {
			link = true
			linkHref = mark.attrs.href as string
		}
	}

	// Also check marks in the selection range
	if (from !== to) {
		state.doc.nodesBetween(from, to, (node) => {
			if (node.marks) {
				for (const mark of node.marks) {
					if (mark.type.name === 'strong') bold = true
					if (mark.type.name === 'emphasis') italic = true
					if (mark.type.name === 'strikethrough') strikethrough = true
					if (mark.type.name === 'link') {
						link = true
						linkHref = mark.attrs.href as string
					}
				}
			}
		})
	}

	// Check block types (lists, blockquote, heading)
	let bulletList = false
	let orderedList = false
	let blockquote = false
	let heading: number | null = null

	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth)
		if (node.type.name === 'bullet_list') bulletList = true
		if (node.type.name === 'ordered_list') orderedList = true
		if (node.type.name === 'blockquote') blockquote = true
	}

	if ($from.parent.type.name === 'heading') {
		heading = $from.parent.attrs.level as number
	}

	return { bold, italic, strikethrough, link, linkHref, bulletList, orderedList, blockquote, heading }
}

/**
 * Check whether the current selection is inside a list of the given type.
 */
export function isInListType(view: EditorView, listType: string): boolean {
	const { $from } = view.state.selection
	for (let depth = $from.depth; depth > 0; depth--) {
		if ($from.node(depth).type.name === listType) return true
	}
	return false
}

/**
 * Toggle a heading level at the current selection. If the selection is already
 * a heading of the given level, convert it back to a paragraph.
 */
export function toggleHeading(view: EditorView, level: number): void {
	const { state } = view
	const headingType = state.schema.nodes.heading
	const paragraphType = state.schema.nodes.paragraph
	if (!headingType) return

	const { $from } = state.selection
	const isCurrentHeading = $from.parent.type.name === 'heading' && $from.parent.attrs.level === level
	const targetType = isCurrentHeading ? paragraphType : headingType
	const attrs = isCurrentHeading ? undefined : { level }
	if (!targetType) return

	const blockFrom = $from.before($from.depth)
	const blockTo = state.selection.$to.after(state.selection.$to.depth)
	view.dispatch(state.tr.setBlockType(blockFrom, blockTo, targetType, attrs))
	view.focus()
}

function formatsEqual(a: ActiveFormats, b: ActiveFormats): boolean {
	return a.bold === b.bold
		&& a.italic === b.italic
		&& a.strikethrough === b.strikethrough
		&& a.link === b.link
		&& a.linkHref === b.linkHref
		&& a.bulletList === b.bulletList
		&& a.orderedList === b.orderedList
		&& a.blockquote === b.blockquote
		&& a.heading === b.heading
}

/**
 * Intercept dispatch on the editor view to track active formats via rAF
 * debouncing. Fires the callback only when formats actually change.
 * Returns a cleanup function that cancels the pending rAF.
 */
export function setupFormatTracking(editor: Editor, callback: (formats: ActiveFormats) => void): () => void {
	let formatRaf = 0
	let lastFormats: ActiveFormats = defaultActiveFormats

	const update = () => {
		try {
			const view = editor.ctx.get(editorViewCtx)
			const formats = getActiveFormats(view)
			if (!formatsEqual(formats, lastFormats)) {
				lastFormats = formats
				callback(formats)
			}
		} catch { /* ignore */ }
	}

	try {
		const view = editor.ctx.get(editorViewCtx)
		const origDispatch = view.dispatch.bind(view)
		view.dispatch = (tr) => {
			origDispatch(tr)
			if (tr.selectionSet || tr.docChanged) {
				cancelAnimationFrame(formatRaf)
				formatRaf = requestAnimationFrame(update)
			}
		}
	} catch { /* ignore */ }

	// Fire initial check
	update()

	return () => {
		cancelAnimationFrame(formatRaf)
	}
}
