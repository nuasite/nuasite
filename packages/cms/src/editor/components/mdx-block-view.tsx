import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import {
	commonmark,
	liftListItemCommand,
	toggleEmphasisCommand,
	toggleLinkCommand,
	toggleStrongCommand,
	wrapInBlockquoteCommand,
	wrapInBulletListCommand,
	wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark'
import { gfm, toggleStrikethroughCommand } from '@milkdown/preset-gfm'
import { callCommand, insert, replaceAll } from '@milkdown/utils'
import type { ComponentChildren } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { getComponentDefinition } from '../manifest'
import { MDX_EXPR_PREFIX } from '../milkdown-mdx-plugin'
import { type ActiveFormats, defaultActiveFormats, isInListType, setupFormatTracking, toggleHeading } from '../milkdown-utils'
import { manifest, openMediaLibraryWithCallback } from '../signals'
import type { ComponentProp } from '../types'

const MDX_COMPONENT_ICON_PATH =
	'M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5'

export function MdxComponentIcon({ size = 'sm' }: { size?: 'sm' | 'md' }) {
	const iconClass = size === 'md' ? 'w-4 h-4' : 'w-3 h-3'
	const svg = (
		<svg class={`${iconClass} text-cms-primary`} fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d={MDX_COMPONENT_ICON_PATH} />
		</svg>
	)
	if (size === 'md') return svg
	return (
		<div class="w-5 h-5 rounded bg-cms-primary/20 flex items-center justify-center">
			{svg}
		</div>
	)
}

export interface MdxBlockCardProps {
	componentName: string
	props: Record<string, string>
	hasExpressions: boolean
	slotContent?: string
	onRemove: () => void
	onSlotContentChange?: (content: string) => void
	onPropsChange?: (props: Record<string, string>) => void
}

// ============================================================================
// Inline editors — use refs + DOM to avoid Preact render cycle issues
// with imperative render() from ProseMirror node views
// ============================================================================

// ---- Mini Milkdown editor for slot content ----

function MiniToolbarButton(
	{ onClick, title, active, children: content }: { onClick: () => void; title: string; active?: boolean; children: ComponentChildren },
) {
	return (
		<button
			type="button"
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			class={`p-1 rounded transition-colors ${active ? 'bg-cms-primary text-cms-primary-text' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
			title={title}
			data-mdx-action="format"
		>
			{content}
		</button>
	)
}

function MiniMilkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const containerRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<Editor | null>(null)
	const latestMarkdown = useRef(value)
	const isFocused = useRef(false)
	const [formats, setFormats] = useState<ActiveFormats>(defaultActiveFormats)

	useEffect(() => {
		const el = containerRef.current
		if (!el) return

		let destroyed = false
		let cleanupTracking: (() => void) | undefined

		const init = async () => {
			const editor = await Editor.make()
				.config((ctx) => {
					ctx.set(rootCtx, el)
					ctx.set(defaultValueCtx, value)
					ctx.get(listenerCtx).markdownUpdated((_, md) => {
						latestMarkdown.current = md
					})
				})
				.use(commonmark)
				.use(gfm)
				.use(listener)
				.create()

			if (destroyed) {
				editor.destroy()
				return
			}
			editorRef.current = editor
			cleanupTracking = setupFormatTracking(editor, setFormats)
		}

		init()

		return () => {
			destroyed = true
			cleanupTracking?.()
			editorRef.current?.destroy()
			editorRef.current = null
		}
	}, [])

	// Sync external value changes when not focused
	useEffect(() => {
		if (!isFocused.current && editorRef.current && value !== latestMarkdown.current) {
			try {
				editorRef.current.action(replaceAll(value))
				latestMarkdown.current = value
			} catch { /* editor not ready */ }
		}
	}, [value])

	const runCmd = useCallback((cmd: any, payload?: any) => {
		if (!editorRef.current) return
		try {
			editorRef.current.action(callCommand(cmd, payload))
		} catch { /* ignore */ }
	}, [])

	const checkInList = useCallback((listType: string): boolean => {
		if (!editorRef.current) return false
		try {
			const view = editorRef.current.ctx.get(editorViewCtx)
			return isInListType(view, listType)
		} catch { /* ignore */ }
		return false
	}, [])

	const handleLink = useCallback(() => {
		if (!editorRef.current) return
		const url = prompt('Enter URL:', 'https://')
		if (!url) return
		try {
			editorRef.current.action(callCommand(toggleLinkCommand.key, { href: url }))
		} catch {
			const linkText = window.getSelection()?.toString() || 'Link'
			editorRef.current.action(insert(`[${linkText}](${url})`))
		}
	}, [])

	const handleHeadingToggle = useCallback((level: number) => {
		if (!editorRef.current) return
		try {
			const view = editorRef.current.ctx.get(editorViewCtx)
			toggleHeading(view, level)
		} catch { /* ignore */ }
	}, [])

	const handleList = useCallback((type: 'bullet' | 'ordered') => {
		const listType = type === 'bullet' ? 'bullet_list' : 'ordered_list'
		if (checkInList(listType)) {
			runCmd(liftListItemCommand.key)
		} else {
			runCmd(type === 'bullet' ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key)
		}
	}, [runCmd, checkInList])

	return (
		<div>
			{/* Toolbar */}
			<div class="flex items-center gap-0.5 mb-1.5 flex-wrap">
				{/* Text formatting */}
				<MiniToolbarButton onClick={() => runCmd(toggleStrongCommand.key)} title="Bold" active={formats.bold}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
					</svg>
				</MiniToolbarButton>
				<MiniToolbarButton onClick={() => runCmd(toggleEmphasisCommand.key)} title="Italic" active={formats.italic}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<line x1="19" y1="4" x2="10" y2="4" />
						<line x1="14" y1="20" x2="5" y2="20" />
						<line x1="15" y1="4" x2="9" y2="20" />
					</svg>
				</MiniToolbarButton>
				<MiniToolbarButton onClick={() => runCmd(toggleStrikethroughCommand.key)} title="Strikethrough" active={formats.strikethrough}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 12h12M6 12a4 4 0 0 1 4-4h4a4 4 0 0 1 0 8H10a4 4 0 0 1-4-4z" />
					</svg>
				</MiniToolbarButton>

				<div class="w-px h-4 bg-white/15 mx-0.5" />

				{/* Headings */}
				<MiniToolbarButton onClick={() => handleHeadingToggle(2)} title="Heading 2" active={formats.heading === 2}>
					<span class="text-[10px] font-bold leading-none">H2</span>
				</MiniToolbarButton>
				<MiniToolbarButton onClick={() => handleHeadingToggle(3)} title="Heading 3" active={formats.heading === 3}>
					<span class="text-[10px] font-bold leading-none">H3</span>
				</MiniToolbarButton>
				<MiniToolbarButton onClick={() => handleHeadingToggle(4)} title="Heading 4" active={formats.heading === 4}>
					<span class="text-[10px] font-bold leading-none">H4</span>
				</MiniToolbarButton>

				<div class="w-px h-4 bg-white/15 mx-0.5" />

				{/* Lists & quote */}
				<MiniToolbarButton onClick={() => handleList('bullet')} title="Bullet list" active={formats.bulletList}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<line x1="9" y1="6" x2="20" y2="6" />
						<line x1="9" y1="12" x2="20" y2="12" />
						<line x1="9" y1="18" x2="20" y2="18" />
						<circle cx="4" cy="6" r="1.5" fill="currentColor" />
						<circle cx="4" cy="12" r="1.5" fill="currentColor" />
						<circle cx="4" cy="18" r="1.5" fill="currentColor" />
					</svg>
				</MiniToolbarButton>
				<MiniToolbarButton onClick={() => handleList('ordered')} title="Numbered list" active={formats.orderedList}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<line x1="10" y1="6" x2="21" y2="6" />
						<line x1="10" y1="12" x2="21" y2="12" />
						<line x1="10" y1="18" x2="21" y2="18" />
						<text x="3" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
						<text x="3" y="14" font-size="7" fill="currentColor" stroke="none">2</text>
						<text x="3" y="20" font-size="7" fill="currentColor" stroke="none">3</text>
					</svg>
				</MiniToolbarButton>
				<MiniToolbarButton onClick={() => runCmd(wrapInBlockquoteCommand.key)} title="Quote" active={formats.blockquote}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 6v12M7 6v12M11 6h10M11 12h7M11 18h4" />
					</svg>
				</MiniToolbarButton>

				<div class="w-px h-4 bg-white/15 mx-0.5" />

				{/* Link */}
				<MiniToolbarButton onClick={handleLink} title="Link" active={formats.link}>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
						/>
					</svg>
				</MiniToolbarButton>
			</div>

			{/* Editor */}
			<div
				ref={(el) => {
					;(containerRef as any).current = el
				}}
				onFocusCapture={() => {
					isFocused.current = true
				}}
				onBlurCapture={() => {
					isFocused.current = false
					if (latestMarkdown.current !== value) {
						onChange(latestMarkdown.current)
					}
				}}
				class="mini-milkdown milkdown-dark prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed [&_.milkdown]:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:break-words [&_.ProseMirror_p]:my-1 [&_.ProseMirror_p:first-child]:mt-0 [&_.ProseMirror_p:last-child]:mb-0"
			/>
		</div>
	)
}

function InlineInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
	const ref = useRef<HTMLInputElement>(null)
	const isFocused = useRef(false)

	useEffect(() => {
		if (ref.current && !isFocused.current) {
			ref.current.value = value
		}
	}, [value])

	return (
		<input
			ref={(el) => {
				;(ref as any).current = el
				if (el) el.value = value
			}}
			type="text"
			onFocus={() => {
				isFocused.current = true
			}}
			onBlur={(e) => {
				isFocused.current = false
				const el = e.target as HTMLInputElement
				if (el.value !== value) onChange(el.value)
			}}
			placeholder={placeholder}
			class="w-full bg-white/5 border border-white/10 rounded-cms-sm px-2.5 py-1.5 text-[13px] text-white/80 placeholder:text-white/30 outline-none focus:border-white/25 transition-colors"
		/>
	)
}

const INLINE_INPUT_TYPES: Record<string, string> = {
	number: 'number',
	url: 'url',
	date: 'date',
	datetime: 'datetime-local',
	time: 'time',
	email: 'email',
}
const inputClass =
	'w-full bg-white/5 border border-white/10 rounded-cms-sm px-2.5 py-1.5 text-[13px] text-white/80 placeholder:text-white/30 outline-none focus:border-white/25 transition-colors'

function InlinePropField(
	{ name, value, propDef, onChange }: { name: string; value: string; propDef?: ComponentProp; onChange: (v: string) => void },
) {
	const typeLower = propDef?.type.toLowerCase() ?? ''

	if (typeLower === 'boolean') {
		return (
			<div class="flex items-center gap-2">
				<label class="text-[11px] text-white/40 font-medium w-20 shrink-0 text-right">{name}</label>
				<label class="flex items-center gap-2 cursor-pointer py-1">
					<input
						type="checkbox"
						checked={value === 'true'}
						onChange={(e) => onChange((e.target as HTMLInputElement).checked ? 'true' : 'false')}
						class="accent-cms-primary w-4 h-4 rounded"
					/>
					<span class="text-[12px] text-white/60">{value === 'true' ? 'Yes' : 'No'}</span>
				</label>
			</div>
		)
	}

	if (typeLower === 'image') {
		return (
			<div class="flex items-center gap-2">
				<label class="text-[11px] text-white/40 font-medium w-20 shrink-0 text-right">{name}</label>
				<div class="flex gap-1.5 flex-1">
					<InlineInput value={value} onChange={onChange} placeholder="Select an image..." />
					<button
						type="button"
						onClick={() => openMediaLibraryWithCallback((url: string) => onChange(url))}
						class="px-2 py-1.5 bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 rounded-cms-sm transition-colors shrink-0"
						title="Browse media"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
					</button>
				</div>
			</div>
		)
	}

	if (typeLower === 'color') {
		return (
			<div class="flex items-center gap-2">
				<label class="text-[11px] text-white/40 font-medium w-20 shrink-0 text-right">{name}</label>
				<div class="flex gap-1.5 flex-1 items-center">
					<input
						type="color"
						value={value || '#000000'}
						onInput={(e) => onChange((e.target as HTMLInputElement).value)}
						class="w-7 h-7 rounded-cms-sm border border-white/10 bg-transparent cursor-pointer shrink-0"
					/>
					<InlineInput value={value} onChange={onChange} placeholder="#000000" />
				</div>
			</div>
		)
	}

	const htmlType = INLINE_INPUT_TYPES[typeLower]

	return (
		<div class="flex items-center gap-2">
			<label class="text-[11px] text-white/40 font-medium w-20 shrink-0 text-right">{name}</label>
			{htmlType
				? (
					<input
						type={htmlType}
						value={value}
						onInput={(e) => onChange((e.target as HTMLInputElement).value)}
						placeholder={`Enter ${name}...`}
						class={inputClass}
					/>
				)
				: <InlineInput value={value} onChange={onChange} placeholder={`Enter ${name}...`} />}
		</div>
	)
}

// ============================================================================
// Block Card
// ============================================================================

export function MdxBlockCard({ componentName, props, hasExpressions, slotContent, onRemove, onSlotContentChange, onPropsChange }: MdxBlockCardProps) {
	const propEntries = Object.entries(props).filter(([_, v]) => v !== '' || onPropsChange)
	const editableProps = propEntries.filter(([_, v]) => !v.startsWith(MDX_EXPR_PREFIX))
	const expressionProps = propEntries.filter(([_, v]) => v.startsWith(MDX_EXPR_PREFIX))

	const hasSlotContent = onSlotContentChange != null
	const definition = getComponentDefinition(manifest.value, componentName)
	const propTypes = useMemo(() => {
		const map = new Map<string, ComponentProp>()
		if (definition?.props) {
			for (const p of definition.props) map.set(p.name, p)
		}
		return map
	}, [definition])

	const handlePropChange = (name: string, newValue: string) => {
		if (onPropsChange) {
			onPropsChange({ ...props, [name]: newValue })
		}
	}

	return (
		<div
			class="my-3 mx-0 bg-white/5 border border-white/15 rounded-cms-md overflow-hidden select-none"
			data-cms-ui
		>
			{/* Header */}
			<div class="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/10">
				<div class="flex items-center gap-2">
					<MdxComponentIcon />
					<span class="text-[13px] font-semibold text-white">{componentName}</span>
					{hasExpressions && <span class="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded font-mono">expr</span>}
				</div>
				<div class="flex items-center gap-1">
					<button
						type="button"
						data-mdx-action="remove"
						onClick={onRemove}
						class="p-1.5 rounded-cms-sm text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
						title="Remove block"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
					</button>
				</div>
			</div>

			{/* Slot content editor */}
			{hasSlotContent && (
				<div class="px-4 py-2.5 border-b border-white/10" data-mdx-action="children">
					<MiniMilkdownEditor
						value={slotContent || ''}
						onChange={onSlotContentChange}
					/>
				</div>
			)}

			{/* Inline prop editors */}
			{onPropsChange && editableProps.length > 0 && (
				<div class="px-4 py-3 space-y-2" data-mdx-action="props">
					{editableProps.map(([name, value]) => (
						<InlinePropField
							key={name}
							name={name}
							value={value}
							propDef={propTypes.get(name)}
							onChange={(v) => handlePropChange(name, v)}
						/>
					))}
				</div>
			)}

			{/* Read-only expression props */}
			{expressionProps.length > 0 && (
				<div class="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10">
					{expressionProps.map(([name, value]) => (
						<span key={name} class="text-[11px] text-white/40 font-mono">
							<span class="text-white/60">{name}</span>
							<span class="text-white/30">=</span>
							<span class="text-amber-300/60">{`{${value.slice(MDX_EXPR_PREFIX.length)}}`}</span>
						</span>
					))}
				</div>
			)}

			{/* Read-only props fallback when no onPropsChange */}
			{!onPropsChange && propEntries.length > 0 && (
				<div class="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1">
					{propEntries.slice(0, 6).map(([name, value]) => (
						<span key={name} class="text-[11px] text-white/40 font-mono">
							<span class="text-white/60">{name}</span>
							<span class="text-white/30">=</span>
							{value.startsWith(MDX_EXPR_PREFIX)
								? <span class="text-amber-300/60">{`{${value.slice(MDX_EXPR_PREFIX.length)}}`}</span>
								: <span class="text-cms-primary/60">"{value.length > 25 ? value.slice(0, 25) + '...' : value}"</span>}
						</span>
					))}
					{propEntries.length > 6 && <span class="text-[11px] text-white/30">+{propEntries.length - 6} more</span>}
				</div>
			)}
		</div>
	)
}
