import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/core'
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
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { uploadMedia } from '../markdown-api'
import { config, openMediaLibraryWithCallback, resetMarkdownEditorState, showToast, updateMarkdownContent } from '../signals'

export interface MarkdownInlineEditorProps {
	elementId: string
	initialContent: string
	onSave: (content: string) => void
	onCancel: () => void
	onEditorReady?: (editor: Editor) => void
}

export function MarkdownInlineEditor({
	elementId,
	initialContent,
	onSave,
	onCancel,
	onEditorReady,
}: MarkdownInlineEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null)
	const editorInstanceRef = useRef<Editor | null>(null)
	const [content, setContent] = useState(initialContent)
	const [isReady, setIsReady] = useState(false)
	const [isDragging, setIsDragging] = useState(false)
	const [uploadProgress, setUploadProgress] = useState<number | null>(null)

	// Track active formatting for toolbar highlighting
	const [activeFormats, setActiveFormats] = useState<{
		bold: boolean
		italic: boolean
		strikethrough: boolean
		link: boolean
		linkHref: string | null
		bulletList: boolean
		orderedList: boolean
		blockquote: boolean
		heading: number | null
	}>({
		bold: false,
		italic: false,
		strikethrough: false,
		link: false,
		linkHref: null,
		bulletList: false,
		orderedList: false,
		blockquote: false,
		heading: null,
	})

	// Store initial content in ref to avoid stale closure issues
	const initialContentRef = useRef(initialContent)
	// Track current content in ref for use in callbacks
	const contentRef = useRef(content)
	contentRef.current = content
	// Store onEditorReady in ref to avoid re-initializing editor when callback changes
	const onEditorReadyRef = useRef(onEditorReady)
	onEditorReadyRef.current = onEditorReady

	// Check active formatting at current selection
	const updateActiveFormats = useCallback(() => {
		if (!editorInstanceRef.current) return

		try {
			const view = editorInstanceRef.current.ctx.get(editorViewCtx)
			const { state } = view
			const { $from, from, to } = state.selection

			// Check marks (inline formatting)
			let bold = false
			let italic = false
			let strikethrough = false
			let link = false
			let linkHref: string | null = null

			// Check if marks are active in the selection
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

			// Check heading at current position
			const parentNode = $from.parent
			if (parentNode.type.name === 'heading') {
				heading = parentNode.attrs.level as number
			}

			setActiveFormats({
				bold,
				italic,
				strikethrough,
				link,
				linkHref,
				bulletList,
				orderedList,
				blockquote,
				heading,
			})
		} catch {
			// Ignore errors during format checking
		}
	}, [])

	// Initialize Milkdown editor
	useEffect(() => {
		if (!editorRef.current) return

		const initEditor = async () => {
			try {
				const editor = await Editor.make()
					.config((ctx) => {
						ctx.set(rootCtx, editorRef.current)
						ctx.set(defaultValueCtx, initialContentRef.current)
						ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
							setContent(markdown)
							updateMarkdownContent(markdown)
						})
					})
					.use(commonmark)
					.use(gfm)
					.use(listener)
					.create()

				editorInstanceRef.current = editor
				setIsReady(true)
				onEditorReadyRef.current?.(editor)

				// Set up selection change listener
				const view = editor.ctx.get(editorViewCtx)
				const originalDispatch = view.dispatch.bind(view)
				view.dispatch = (tr) => {
					originalDispatch(tr)
					if (tr.selectionSet || tr.docChanged) {
						updateActiveFormats()
					}
				}

				// Initial format check
				updateActiveFormats()
			} catch (error) {
				console.error('Milkdown editor initialization failed:', error)
				showToast('Failed to initialize markdown editor', 'error')
			}
		}

		initEditor()

		return () => {
			editorInstanceRef.current?.destroy()
			editorInstanceRef.current = null
		}
	}, [updateActiveFormats])

	const handleSave = useCallback(() => {
		onSave(content)
		resetMarkdownEditorState()
	}, [content, onSave])

	const handleCancel = useCallback(() => {
		onCancel()
		resetMarkdownEditorState()
	}, [onCancel])

	const handleInsertImage = useCallback(() => {
		openMediaLibraryWithCallback((url, alt) => {
			const imageMarkdown = `\n\n![${alt}](${url})\n\n`

			// Insert at cursor position using Milkdown's insert command
			if (editorInstanceRef.current) {
				try {
					editorInstanceRef.current.action(insert(imageMarkdown))
				} catch (error) {
					console.error('Failed to insert image:', error)
					// Fallback: append to content
					const newContent = `${contentRef.current}\n\n![${alt}](${url})`
					setContent(newContent)
					editorInstanceRef.current.action(replaceAll(newContent))
				}
			}
		})
	}, [])

	// Formatting commands
	const runCommand = useCallback(
		(command: Parameters<typeof callCommand>[0]) => {
			if (editorInstanceRef.current) {
				try {
					editorInstanceRef.current.action(callCommand(command))
				} catch (error) {
					console.error('Failed to run command:', error)
				}
			}
		},
		[],
	)

	const handleBold = useCallback(
		() => runCommand(toggleStrongCommand.key),
		[runCommand],
	)
	const handleItalic = useCallback(
		() => runCommand(toggleEmphasisCommand.key),
		[runCommand],
	)
	const handleStrikethrough = useCallback(
		() => runCommand(toggleStrikethroughCommand.key),
		[runCommand],
	)
	const handleQuote = useCallback(
		() => runCommand(wrapInBlockquoteCommand.key),
		[runCommand],
	)

	// Check if selection is inside a list of given type
	const isInList = useCallback(
		(listType: 'bullet_list' | 'ordered_list'): boolean => {
			if (!editorInstanceRef.current) return false
			try {
				const view = editorInstanceRef.current.ctx.get(editorViewCtx)
				const { state } = view
				const { $from } = state.selection
				for (let depth = $from.depth; depth > 0; depth--) {
					const node = $from.node(depth)
					if (node.type.name === listType) return true
				}
				return false
			} catch {
				return false
			}
		},
		[],
	)

	// Toggle bullet list - if in bullet list, remove it; otherwise add it
	const handleBulletList = useCallback(() => {
		if (isInList('bullet_list')) {
			runCommand(liftListItemCommand.key)
		} else {
			runCommand(wrapInBulletListCommand.key)
		}
	}, [runCommand, isInList])

	// Toggle ordered list - if in ordered list, remove it; otherwise add it
	const handleOrderedList = useCallback(() => {
		if (isInList('ordered_list')) {
			runCommand(liftListItemCommand.key)
		} else {
			runCommand(wrapInOrderedListCommand.key)
		}
	}, [runCommand, isInList])

	const handleInsertLink = useCallback(() => {
		if (!editorInstanceRef.current) return

		// If already in a link, remove it
		if (activeFormats.link) {
			try {
				// Use toggleLinkCommand with empty href to remove link
				editorInstanceRef.current.action(
					callCommand(toggleLinkCommand.key, { href: '' }),
				)
				return
			} catch (error) {
				console.error('Failed to remove link:', error)
			}
		}

		// Get selected text from editor
		let selectedText = ''
		try {
			const view = editorInstanceRef.current.ctx.get(editorViewCtx)
			const { state } = view
			const { from, to } = state.selection
			if (from !== to) {
				selectedText = state.doc.textBetween(from, to, ' ')
			}
		} catch {
			// Ignore errors
		}

		// Prompt for URL (pre-fill with existing URL if editing)
		const defaultUrl = activeFormats.linkHref || ''
		const url = prompt('Enter URL:', defaultUrl)
		if (url) {
			try {
				// Use toggleLinkCommand to add/update link
				editorInstanceRef.current.action(
					callCommand(toggleLinkCommand.key, { href: url }),
				)
			} catch (error) {
				console.error('Failed to add link:', error)
				// Fallback: use markdown insertion
				const linkText = selectedText || prompt('Enter link text:', 'Link') || 'Link'
				const linkMarkdown = `[${linkText}](${url})`
				editorInstanceRef.current.action(insert(linkMarkdown))
			}
		}
	}, [activeFormats.link, activeFormats.linkHref])

	const handleInsertHeading = useCallback((level: number) => {
		const prefix = '#'.repeat(level) + ' '
		const headingMarkdown = `\n\n${prefix}Heading\n\n`

		// Insert at cursor position
		if (editorInstanceRef.current) {
			try {
				editorInstanceRef.current.action(insert(headingMarkdown))
			} catch (error) {
				console.error('Failed to insert heading:', error)
			}
		}
	}, [])

	// Drag and drop handlers for direct image upload
	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}, [])

	const handleDrop = useCallback(async (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)

		const file = e.dataTransfer?.files[0]
		if (!file || !file.type.startsWith('image/')) {
			showToast('Please drop an image file', 'error')
			return
		}

		// Upload the image
		setUploadProgress(0)
		try {
			const result = await uploadMedia(config.value, file, (percent) => {
				setUploadProgress(percent)
			})

			if (result.success && result.url) {
				const alt = result.annotation || file.name.replace(/\.[^/.]+$/, '') || 'Image'
				const imageMarkdown = `\n\n![${alt}](${result.url})\n\n`

				// Insert at cursor position
				if (editorInstanceRef.current) {
					try {
						editorInstanceRef.current.action(insert(imageMarkdown))
						showToast('Image uploaded and inserted', 'success')
					} catch (error) {
						console.error('Failed to insert image:', error)
					}
				}
			} else {
				showToast(result.error || 'Upload failed', 'error')
			}
		} catch (error) {
			showToast('Upload failed', 'error')
		} finally {
			setUploadProgress(null)
		}
	}, [])

	// Handle paste for images
	const handlePaste = useCallback(async (e: ClipboardEvent) => {
		const items = e.clipboardData?.items
		if (!items) return

		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault()
				const file = item.getAsFile()
				if (!file) continue

				setUploadProgress(0)
				try {
					const result = await uploadMedia(config.value, file, (percent) => {
						setUploadProgress(percent)
					})

					if (result.success && result.url) {
						const alt = result.annotation || 'Pasted image'
						const imageMarkdown = `\n\n![${alt}](${result.url})\n\n`

						if (editorInstanceRef.current) {
							editorInstanceRef.current.action(insert(imageMarkdown))
							showToast('Image uploaded and inserted', 'success')
						}
					} else {
						showToast(result.error || 'Upload failed', 'error')
					}
				} catch (error) {
					showToast('Upload failed', 'error')
				} finally {
					setUploadProgress(null)
				}
				break
			}
		}
	}, [])

	return (
		<div
			class="markdown-inline-editor flex flex-col h-full min-h-0"
			data-cms-ui
			data-element-id={elementId}
		>
			{/* Formatting Toolbar */}
			<div class="flex items-center gap-1 px-4 py-3 border-b border-white/10 bg-cms-dark/50 flex-wrap shrink-0 sticky top-0 z-50 backdrop-blur-md">
				{/* Text Formatting */}
				<div class="flex items-center gap-0.5 mr-2">
					<ToolbarButton
						onClick={handleBold}
						title="Bold (Ctrl+B)"
						active={activeFormats.bold}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2.5"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"
							/>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"
							/>
						</svg>
					</ToolbarButton>
					<ToolbarButton
						onClick={handleItalic}
						title="Italic (Ctrl+I)"
						active={activeFormats.italic}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<line x1="19" y1="4" x2="10" y2="4" />
							<line x1="14" y1="20" x2="5" y2="20" />
							<line x1="15" y1="4" x2="9" y2="20" />
						</svg>
					</ToolbarButton>
					<ToolbarButton
						onClick={handleStrikethrough}
						title="Strikethrough"
						active={activeFormats.strikethrough}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M6 12h12M6 12a4 4 0 0 1 4-4h4a4 4 0 0 1 0 8H10a4 4 0 0 1-4-4z"
							/>
						</svg>
					</ToolbarButton>
				</div>

				{/* Divider */}
				<div class="w-px h-5 bg-white/20 mx-1" />

				{/* Headings */}
				<div class="flex items-center gap-0.5 mr-2">
					<ToolbarButton
						onClick={() => handleInsertHeading(1)}
						title="Heading 1"
						active={activeFormats.heading === 1}
					>
						<span class="text-xs font-bold">H1</span>
					</ToolbarButton>
					<ToolbarButton
						onClick={() => handleInsertHeading(2)}
						title="Heading 2"
						active={activeFormats.heading === 2}
					>
						<span class="text-xs font-bold">H2</span>
					</ToolbarButton>
					<ToolbarButton
						onClick={() => handleInsertHeading(3)}
						title="Heading 3"
						active={activeFormats.heading === 3}
					>
						<span class="text-xs font-bold">H3</span>
					</ToolbarButton>
					<ToolbarButton
						onClick={() => handleInsertHeading(4)}
						title="Heading 4"
						active={activeFormats.heading === 4}
					>
						<span class="text-xs font-bold">H4</span>
					</ToolbarButton>
				</div>

				{/* Divider */}
				<div class="w-px h-5 bg-white/20 mx-1" />

				{/* Lists & Quote */}
				<div class="flex items-center gap-0.5 mr-2">
					<ToolbarButton
						onClick={handleBulletList}
						title="Bullet List"
						active={activeFormats.bulletList}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<line x1="9" y1="6" x2="20" y2="6" />
							<line x1="9" y1="12" x2="20" y2="12" />
							<line x1="9" y1="18" x2="20" y2="18" />
							<circle cx="4" cy="6" r="1.5" fill="currentColor" />
							<circle cx="4" cy="12" r="1.5" fill="currentColor" />
							<circle cx="4" cy="18" r="1.5" fill="currentColor" />
						</svg>
					</ToolbarButton>
					<ToolbarButton
						onClick={handleOrderedList}
						title="Numbered List"
						active={activeFormats.orderedList}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<line x1="10" y1="6" x2="21" y2="6" />
							<line x1="10" y1="12" x2="21" y2="12" />
							<line x1="10" y1="18" x2="21" y2="18" />
							<text x="3" y="8" font-size="7" fill="currentColor" stroke="none">
								1
							</text>
							<text
								x="3"
								y="14"
								font-size="7"
								fill="currentColor"
								stroke="none"
							>
								2
							</text>
							<text
								x="3"
								y="20"
								font-size="7"
								fill="currentColor"
								stroke="none"
							>
								3
							</text>
						</svg>
					</ToolbarButton>
					<ToolbarButton
						onClick={handleQuote}
						title="Quote"
						active={activeFormats.blockquote}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3 6v12M7 6v12M11 6h10M11 12h7M11 18h4"
							/>
						</svg>
					</ToolbarButton>
				</div>

				{/* Divider */}
				<div class="w-px h-5 bg-white/20 mx-1" />

				{/* Links & Images */}
				<div class="flex items-center gap-0.5">
					<ToolbarButton
						onClick={handleInsertLink}
						title={activeFormats.link ? 'Remove Link' : 'Insert Link'}
						active={activeFormats.link}
					>
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
							/>
						</svg>
					</ToolbarButton>
					<ToolbarButton onClick={handleInsertImage} title="Insert Image">
						<svg
							class="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
					</ToolbarButton>
				</div>
			</div>

			{/* Editor */}
			<div
				class={`flex-1 min-h-0 overflow-auto relative transition-colors ${isDragging ? 'bg-cms-primary/10' : ''}`}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onPaste={handlePaste}
			>
				<div
					ref={editorRef}
					class="milkdown-editor milkdown-dark prose prose-invert prose-sm max-w-none p-6 min-h-75 focus:outline-none"
					data-cms-ui
				/>

				{/* Drag overlay */}
				{isDragging && (
					<div class="absolute inset-0 flex items-center justify-center bg-cms-primary/10 border-2 border-dashed border-cms-primary rounded-lg pointer-events-none">
						<div class="flex flex-col items-center gap-2 text-cms-primary">
							<svg
								class="w-10 h-10"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							<span class="font-medium">Drop image to upload</span>
						</div>
					</div>
				)}

				{/* Upload progress */}
				{uploadProgress !== null && (
					<div class="absolute inset-0 flex items-center justify-center bg-cms-dark/80">
						<div class="flex flex-col items-center gap-3">
							<div class="w-48 h-2 bg-white/10 rounded-full overflow-hidden">
								<div
									class="h-full bg-cms-primary transition-all duration-200 rounded-full"
									style={{ width: `${uploadProgress}%` }}
								/>
							</div>
							<span class="text-sm text-white font-medium">
								Uploading... {uploadProgress}%
							</span>
						</div>
					</div>
				)}

				{/* Loading state */}
				{!isReady && (
					<div class="absolute inset-0 flex items-center justify-center bg-cms-dark/80">
						<div class="animate-spin rounded-full h-6 w-6 border-2 border-white/30 border-t-cms-primary" />
					</div>
				)}
			</div>
		</div>
	)
}

interface ToolbarButtonProps {
	onClick: () => void
	title: string
	children: preact.ComponentChildren
	active?: boolean
}

function ToolbarButton({
	onClick,
	title,
	children,
	active,
}: ToolbarButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			class={`p-2 rounded-cms-sm transition-colors ${
				active
					? 'bg-cms-primary text-cms-primary-text'
					: 'hover:bg-white/10 text-white/70 hover:text-white'
			}`}
			title={title}
			data-cms-ui
		>
			{children}
		</button>
	)
}
