/**
 * `MdxBodyEditor` — a Milkdown rich-text editor for a collection entry's markdown/
 * MDX body. Component blocks round-trip via the MDX plugin (`mdx-plugin` + the
 * React node-view in `mdx-view`); a picker inserts new ones. String in / string
 * out (`value` / `onChange`) so it drops into any host's save flow.
 *
 * Pass `components` (from `cmsClient.getComponents()`) to drive the picker and the
 * block-card prop labels; without it blocks still render and round-trip, just
 * without rich labels.
 */
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { callCommand, replaceAll } from '@milkdown/utils'
import type { ComponentDefinition } from '@nuasite/cms-types'
import { useEffect, useRef, useState } from 'react'
import { ComponentPicker } from './component-picker'
import { FormatToolbar } from './format-toolbar'
import { insertMdxComponentCommand, mdxComponentNode, mdxEsmNode, remarkMdxPlugin } from './mdx-plugin'
import { type ComponentResolver, createMdxComponentView } from './mdx-view'
import type { MediaContext, MediaSource } from './media-source'

export interface MdxBodyEditorProps {
	value: string
	onChange: (markdown: string) => void
	/** Project component definitions — drives the insert picker and prop labels. */
	components?: ComponentDefinition[]
	/**
	 * Media source (the host's `CmsClient` satisfies it) — enables the toolbar's
	 * image insert and image-prop browse/upload. Absent → those affordances hide.
	 */
	media?: MediaSource
	/** Upload context (collection/entry) so uploads file against this entry. */
	mediaContext?: MediaContext
}

const wrapper: React.CSSProperties = { border: '1px solid #d4d4d8', borderRadius: 6, background: '#fff' }
const editorHost: React.CSSProperties = { padding: '8px 12px', minHeight: 240, outline: 'none' }

export function MdxBodyEditor({ value, onChange, components, media, mediaContext }: MdxBodyEditorProps) {
	const hostRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<Editor | null>(null)
	const latest = useRef(value)
	const ready = useRef(false)
	const settingExternal = useRef(false)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange

	// Component map kept in a ref so the node-view resolver always sees the latest
	// list even though the editor is created once.
	const componentMap = useRef<Map<string, ComponentDefinition>>(new Map())
	useEffect(() => {
		componentMap.current = new Map((components ?? []).map(c => [c.name, c]))
	}, [components])

	// Read inside the create-effect via refs so an inline `mediaContext` object from
	// the host doesn't re-create the editor every render (deps stay `[]`). Both hosts
	// remount per entry, so the value captured at mount is the right one.
	const mediaRef = useRef(media)
	mediaRef.current = media
	const mediaContextRef = useRef(mediaContext)
	mediaContextRef.current = mediaContext

	const [pickerOpen, setPickerOpen] = useState(false)
	// The created editor, surfaced as state so the toolbar (re)attaches once ready.
	const [editorInstance, setEditorInstance] = useState<Editor | null>(null)

	useEffect(() => {
		const el = hostRef.current
		if (!el) return
		let destroyed = false

		const resolver: ComponentResolver = (name) => componentMap.current.get(name)

		const init = async () => {
			const editor = await Editor.make()
				.config((ctx) => {
					ctx.set(rootCtx, el)
					ctx.set(defaultValueCtx, latest.current)
					ctx.get(listenerCtx).markdownUpdated((_, md) => {
						latest.current = md
						if (ready.current && !settingExternal.current) onChangeRef.current(md)
					})
				})
				.use(commonmark)
				.use(gfm)
				.use(listener)
				.use(remarkMdxPlugin)
				.use(mdxEsmNode)
				.use(mdxComponentNode)
				.use(createMdxComponentView(resolver, mediaRef.current, mediaContextRef.current))
				.use(insertMdxComponentCommand)
				.create()

			if (destroyed) {
				editor.destroy()
				return
			}
			editorRef.current = editor
			setEditorInstance(editor)
			// Ignore the value-set that happens during creation; only user edits emit.
			queueMicrotask(() => {
				ready.current = true
			})
		}
		void init()

		return () => {
			destroyed = true
			ready.current = false
			editorRef.current?.destroy()
			editorRef.current = null
			setEditorInstance(null)
		}
	}, [])

	// Adopt external value changes (e.g. conflict resolution) without clobbering
	// the user's own edits — when value already equals what we last emitted, skip.
	useEffect(() => {
		if (!editorRef.current || !ready.current) return
		if (value === latest.current) return
		settingExternal.current = true
		editorRef.current.action(replaceAll(value))
		latest.current = value
		queueMicrotask(() => {
			settingExternal.current = false
		})
	}, [value])

	const insert = (componentName: string, props: Record<string, string>, children?: string) => {
		editorRef.current?.action(callCommand(insertMdxComponentCommand.key, { componentName, props, children }))
	}

	return (
		<div style={wrapper}>
			<FormatToolbar
				editor={editorInstance}
				media={media}
				mediaContext={mediaContext}
				field="body"
				onInsertComponent={() => setPickerOpen(true)}
			/>
			<div ref={hostRef} style={editorHost} />
			<ComponentPicker open={pickerOpen} components={components ?? []} onInsert={insert} onClose={() => setPickerOpen(false)} />
		</div>
	)
}
