/**
 * Rich-text toolbar shared by the body editor and the nested slot editor. Reflects
 * and toggles inline/block formatting on the bound Milkdown editor; optionally
 * surfaces an image button (opens the media library) and an "insert component"
 * button (body editor only). The nested slot editor passes neither, matching the
 * original mini-editor's formatting-only toolbar.
 */
import { type Editor, editorViewCtx } from '@milkdown/core'
import {
	liftListItemCommand,
	toggleEmphasisCommand,
	toggleLinkCommand,
	toggleStrongCommand,
	updateLinkCommand,
	wrapInBlockquoteCommand,
	wrapInBulletListCommand,
	wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark'
import { toggleStrikethroughCommand } from '@milkdown/preset-gfm'
import { callCommand } from '@milkdown/utils'
import { useEffect, useState } from 'react'
import { LinkPopover } from './link-popover'
import { MediaLibrary } from './media-library'
import type { MediaContext, MediaSource } from './media-source'
import { type ActiveFormats, defaultActiveFormats, isInListType, removeLinkMark, setupFormatTracking, toggleHeading } from './milkdown-utils'

/** Track active formats on the editor, re-attaching when the instance changes. */
export function useFormatTracking(editor: Editor | null): ActiveFormats {
	const [formats, setFormats] = useState<ActiveFormats>(defaultActiveFormats)
	useEffect(() => {
		if (!editor) {
			setFormats(defaultActiveFormats)
			return
		}
		return setupFormatTracking(editor, setFormats)
	}, [editor])
	return formats
}

function doHeading(editor: Editor, level: number) {
	toggleHeading(editor.ctx.get(editorViewCtx), level)
}

function toggleList(editor: Editor, type: 'bullet' | 'ordered') {
	const view = editor.ctx.get(editorViewCtx)
	const listType = type === 'bullet' ? 'bullet_list' : 'ordered_list'
	if (isInListType(view, listType)) {
		editor.action(callCommand(liftListItemCommand.key))
	} else {
		editor.action(callCommand(type === 'bullet' ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key))
	}
}

function insertImage(editor: Editor, src: string, alt: string) {
	editor.action((ctx) => {
		const view = ctx.get(editorViewCtx)
		const imageType = view.state.schema.nodes.image
		if (!imageType) return
		view.focus()
		view.dispatch(view.state.tr.replaceSelectionWith(imageType.create({ src, alt })).scrollIntoView())
	})
}

export interface FormatToolbarProps {
	editor: Editor | null
	media?: MediaSource
	mediaContext?: MediaContext
	/** Upload field the image is filed under (e.g. 'body'). */
	field?: string
	onInsertComponent?: () => void
}

const bar: React.CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: 3,
	padding: '4px 6px',
	borderBottom: '1px solid #ececed',
	background: '#fafafa',
}
const sep: React.CSSProperties = { width: 1, height: 18, background: '#e4e4e7', margin: '0 3px' }
const baseBtn: React.CSSProperties = {
	border: '1px solid transparent',
	background: 'transparent',
	borderRadius: 4,
	padding: '2px 7px',
	font: 'inherit',
	fontSize: 12,
	lineHeight: 1.4,
	cursor: 'pointer',
	color: '#52525b',
}
const activeBtn: React.CSSProperties = { ...baseBtn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }

function Btn({ active, title, onClick, style, children }: {
	active?: boolean
	title: string
	onClick: () => void
	style?: React.CSSProperties
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			title={title}
			data-mdx-action="format"
			onMouseDown={e => e.preventDefault()}
			onClick={onClick}
			style={{ ...(active ? activeBtn : baseBtn), ...style }}
		>
			{children}
		</button>
	)
}

export function FormatToolbar({ editor, media, mediaContext, field, onInsertComponent }: FormatToolbarProps) {
	const formats = useFormatTracking(editor)
	const [linkOpen, setLinkOpen] = useState(false)
	const [mediaOpen, setMediaOpen] = useState(false)
	const disabled = editor === null

	const applyLink = (url: string) => {
		setLinkOpen(false)
		if (!editor) return
		const view = editor.ctx.get(editorViewCtx)
		view.focus()
		editor.action(callCommand(formats.link ? updateLinkCommand.key : toggleLinkCommand.key, { href: url }))
	}

	const removeLink = () => {
		setLinkOpen(false)
		if (!editor) return
		const view = editor.ctx.get(editorViewCtx)
		view.focus()
		removeLinkMark(view)
	}

	return (
		<div>
			<div style={bar}>
				<Btn active={formats.bold} title="Bold" onClick={() => editor?.action(callCommand(toggleStrongCommand.key))} style={{ fontWeight: 700 }}>B</Btn>
				<Btn
					active={formats.italic}
					title="Italic"
					onClick={() => editor?.action(callCommand(toggleEmphasisCommand.key))}
					style={{ fontStyle: 'italic' }}
				>
					I
				</Btn>
				<Btn
					active={formats.strikethrough}
					title="Strikethrough"
					onClick={() => editor?.action(callCommand(toggleStrikethroughCommand.key))}
					style={{ textDecoration: 'line-through' }}
				>
					S
				</Btn>
				<span style={sep} />
				<Btn active={formats.heading === 2} title="Heading 2" onClick={() => editor && doHeading(editor, 2)}>H2</Btn>
				<Btn active={formats.heading === 3} title="Heading 3" onClick={() => editor && doHeading(editor, 3)}>H3</Btn>
				<Btn active={formats.heading === 4} title="Heading 4" onClick={() => editor && doHeading(editor, 4)}>H4</Btn>
				<span style={sep} />
				<Btn active={formats.bulletList} title="Bullet list" onClick={() => editor && toggleList(editor, 'bullet')}>• List</Btn>
				<Btn active={formats.orderedList} title="Numbered list" onClick={() => editor && toggleList(editor, 'ordered')}>1. List</Btn>
				<Btn active={formats.blockquote} title="Quote" onClick={() => editor?.action(callCommand(wrapInBlockquoteCommand.key))}>❝</Btn>
				<span style={sep} />
				<Btn active={formats.link || linkOpen} title="Link" onClick={() => !disabled && setLinkOpen(v => !v)}>🔗 Link</Btn>
				{media ? <Btn title="Insert image" onClick={() => !disabled && setMediaOpen(true)}>🖼 Image</Btn> : null}
				{onInsertComponent
					? (
						<>
							<span style={{ flex: 1 }} />
							<Btn title="Insert component block" onClick={() => !disabled && onInsertComponent()} style={{ border: '1px solid #d4d4d8', color: '#3f3f46' }}>
								+ Component
							</Btn>
						</>
					)
					: null}
			</div>

			{linkOpen
				? (
					<div style={{ padding: '0 6px' }}>
						<LinkPopover
							initialUrl={formats.linkHref ?? 'https://'}
							isEdit={formats.link}
							onApply={applyLink}
							onRemove={formats.link ? removeLink : undefined}
							onClose={() => setLinkOpen(false)}
						/>
					</div>
				)
				: null}

			{mediaOpen && media
				? (
					<MediaLibrary
						media={media}
						context={mediaContext}
						field={field}
						accept="image/*"
						onSelect={(url, alt) => {
							setMediaOpen(false)
							if (editor) insertImage(editor, url, alt ?? '')
						}}
						onClose={() => setMediaOpen(false)}
					/>
				)
				: null}
		</div>
	)
}
