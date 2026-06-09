/**
 * Nested WYSIWYG editor for a component block's default-slot markdown (`children`).
 * A self-contained mini Milkdown (commonmark + gfm) with the shared formatting
 * toolbar — the React port of the original in-iframe `MiniMilkdownEditor`. Replaces
 * the plain textarea so slot content is edited richly and still round-trips as
 * markdown text stored on the node's `children` attr.
 *
 * Emits `onChange` on blur (not per keystroke) so typing never triggers a node-view
 * re-render that would clobber the focused editor.
 */
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { replaceAll } from '@milkdown/utils'
import { useEffect, useRef, useState } from 'react'
import { FormatToolbar } from './format-toolbar'

const wrapper: React.CSSProperties = { border: '1px solid #e4e4e7', borderRadius: 6, background: '#fff' }
const host: React.CSSProperties = { padding: '6px 10px', minHeight: 60, fontSize: 13, lineHeight: 1.5, outline: 'none' }

export function SlotEditor({ value, onChange }: { value: string; onChange: (markdown: string) => void }) {
	const hostRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<Editor | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const latest = useRef(value)
	const focused = useRef(false)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange

	useEffect(() => {
		const el = hostRef.current
		if (!el) return
		let destroyed = false

		const init = async () => {
			const ed = await Editor.make()
				.config((ctx) => {
					ctx.set(rootCtx, el)
					ctx.set(defaultValueCtx, latest.current)
					ctx.get(listenerCtx).markdownUpdated((_, md) => {
						latest.current = md
					})
				})
				.use(commonmark)
				.use(gfm)
				.use(listener)
				.create()

			if (destroyed) {
				ed.destroy()
				return
			}
			editorRef.current = ed
			setEditor(ed)
		}
		void init()

		return () => {
			destroyed = true
			editorRef.current?.destroy()
			editorRef.current = null
			setEditor(null)
		}
	}, [])

	// Adopt external value changes (node re-render with different children) while
	// the user isn't actively typing.
	useEffect(() => {
		if (!editorRef.current || focused.current) return
		if (value === latest.current) return
		editorRef.current.action(replaceAll(value))
		latest.current = value
	}, [value])

	return (
		<div style={wrapper}>
			<FormatToolbar editor={editor} />
			<div
				ref={hostRef}
				style={host}
				onFocusCapture={() => {
					focused.current = true
				}}
				onBlurCapture={() => {
					focused.current = false
					if (latest.current !== value) onChangeRef.current(latest.current)
				}}
			/>
		</div>
	)
}
