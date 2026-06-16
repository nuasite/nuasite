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
import type { CmsListStyle, ComponentDefinition } from '@nuasite/cms-types'
import { useEffect, useRef, useState } from 'react'
import { ComponentPicker } from './component-picker'
import { FormatToolbar } from './format-toolbar'
import { insertMdxComponentCommand, mdxComponentNode, mdxEsmNode, remarkMdxPlugin } from './mdx-plugin'
import { type ComponentResolver, createMdxComponentView } from './mdx-view'
import type { MediaContext, MediaSource } from './media-source'
import { styledListPlugin } from './styled-list-plugin'
import { insertYoutubeCommand, remarkYoutubeDirectivePlugin, youtubeNode } from './youtube-plugin'
import { createYoutubeView } from './youtube-view'

export interface MdxBodyEditorProps {
	value: string
	onChange: (markdown: string) => void
	/** Project component definitions — drives the insert picker and prop labels. */
	components?: ComponentDefinition[]
	/** Project-defined list styles shown in the toolbar. */
	listStyles?: CmsListStyle[]
	/**
	 * Media source (the host's `CmsClient` satisfies it) — enables the toolbar's
	 * image insert and image-prop browse/upload. Absent → those affordances hide.
	 */
	media?: MediaSource
	/** Upload context (collection/entry) so uploads file against this entry. */
	mediaContext?: MediaContext
	/**
	 * Whether to surface MDX component blocks (the "+ Component" toolbar button + picker).
	 * Component blocks are MDX-only; a host editing plain `.md` should pass `false` so the
	 * affordance is hidden — inserting one would write MDX (`<Comp/>`) into a markdown file.
	 * Defaults to `true` for backward compatibility.
	 */
	allowComponents?: boolean
}

const wrapper: React.CSSProperties = { border: '1px solid #d4d4d8', borderRadius: 6, background: '#fff' }
const editorHost: React.CSSProperties = { padding: '8px 12px', minHeight: 240, outline: 'none' }

// Milkdown's commonmark/gfm presets give the document structure but no typography; a host's
// CSS reset (e.g. Tailwind preflight) then flattens headings/lists to body text inside the
// editable area. Inject scoped content styles once so the rich text *looks* rich regardless
// of the host's global CSS. Scoped to `.nua-mdx-editor .ProseMirror` to avoid leaking out.
const EDITOR_STYLE_ID = 'nua-mdx-editor-styles'
const EDITOR_CSS = `
.nua-mdx-editor .ProseMirror { line-height: 1.6; color: #18181b; }
.nua-mdx-editor .ProseMirror:focus { outline: none; }
.nua-mdx-editor .ProseMirror h1 { font-size: 1.6em; font-weight: 700; line-height: 1.25; margin: 0.7em 0 0.35em; }
.nua-mdx-editor .ProseMirror h2 { font-size: 1.35em; font-weight: 700; line-height: 1.3; margin: 0.7em 0 0.35em; }
.nua-mdx-editor .ProseMirror h3 { font-size: 1.15em; font-weight: 600; line-height: 1.35; margin: 0.6em 0 0.3em; }
.nua-mdx-editor .ProseMirror h4 { font-size: 1em; font-weight: 600; margin: 0.6em 0 0.3em; }
.nua-mdx-editor .ProseMirror p { margin: 0.5em 0; }
.nua-mdx-editor .ProseMirror ul { list-style: disc; padding-left: 1.5em; margin: 0.5em 0; }
.nua-mdx-editor .ProseMirror ol { list-style: decimal; padding-left: 1.5em; margin: 0.5em 0; }
.nua-mdx-editor .ProseMirror li { margin: 0.2em 0; }
.nua-mdx-editor .ProseMirror li > p { margin: 0.1em 0; }
.nua-mdx-editor .ProseMirror blockquote { border-left: 3px solid #d4d4d8; padding-left: 0.8em; margin: 0.6em 0; color: #52525b; }
.nua-mdx-editor .ProseMirror strong { font-weight: 700; }
.nua-mdx-editor .ProseMirror em { font-style: italic; }
.nua-mdx-editor .ProseMirror a { color: #2563eb; text-decoration: underline; }
.nua-mdx-editor .ProseMirror code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f4f4f5; padding: 0.1em 0.3em; border-radius: 3px; }
.nua-mdx-editor .ProseMirror pre { background: #f4f4f5; padding: 0.7em 0.9em; border-radius: 6px; overflow-x: auto; }
.nua-mdx-editor .ProseMirror pre code { background: none; padding: 0; }
.nua-mdx-editor .ProseMirror img { max-width: 100%; height: auto; border-radius: 4px; }
.nua-mdx-editor .ProseMirror hr { border: none; border-top: 1px solid #e4e4e7; margin: 1em 0; }
/* tables (GFM) — PM/prosemirror-tables ship no usable styles; without these the
   cells collapse to 0 width and the table is invisible & uneditable */
.nua-mdx-editor .ProseMirror .tableWrapper { overflow-x: auto; margin: 0.8em 0; }
.nua-mdx-editor .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0.8em 0; overflow: hidden; }
.nua-mdx-editor .ProseMirror th, .nua-mdx-editor .ProseMirror td { border: 1px solid #d4d4d8; padding: 0.4em 0.6em; vertical-align: top; box-sizing: border-box; position: relative; min-width: 5em; }
.nua-mdx-editor .ProseMirror th { background: #f4f4f5; font-weight: 600; text-align: left; }
.nua-mdx-editor .ProseMirror th > p, .nua-mdx-editor .ProseMirror td > p { margin: 0; }
.nua-mdx-editor .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; z-index: 20; background-color: #93c5fd; pointer-events: none; }
.nua-mdx-editor .ProseMirror .selectedCell:after { content: ''; position: absolute; inset: 0; z-index: 2; background: rgba(200,200,255,0.4); pointer-events: none; }
`

function useEditorStyles() {
	useEffect(() => {
		if (typeof document === 'undefined' || document.getElementById(EDITOR_STYLE_ID)) return
		const el = document.createElement('style')
		el.id = EDITOR_STYLE_ID
		el.textContent = EDITOR_CSS
		document.head.appendChild(el)
	}, [])
}

export function MdxBodyEditor({ value, onChange, components, listStyles, media, mediaContext, allowComponents = true }: MdxBodyEditorProps) {
	useEditorStyles()
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
				.use(styledListPlugin)
				.use(gfm)
				.use(listener)
				.use(remarkMdxPlugin)
				.use(mdxEsmNode)
				.use(mdxComponentNode)
				.use(createMdxComponentView(resolver, mediaRef.current, mediaContextRef.current))
				.use(insertMdxComponentCommand)
				.use(remarkYoutubeDirectivePlugin)
				.use(youtubeNode)
				.use(createYoutubeView())
				.use(insertYoutubeCommand)
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
		<div className="nua-mdx-editor" style={wrapper}>
			<FormatToolbar
				editor={editorInstance}
				listStyles={listStyles}
				media={media}
				mediaContext={mediaContext}
				field="body"
				onInsertComponent={allowComponents ? () => setPickerOpen(true) : undefined}
			/>
			<div ref={hostRef} style={editorHost} />
			{allowComponents
				? <ComponentPicker open={pickerOpen} components={components ?? []} onInsert={insert} onClose={() => setPickerOpen(false)} />
				: null}
		</div>
	)
}
