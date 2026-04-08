/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks'

interface CommentPopoverProps {
	rect: { x: number; y: number; width: number; height: number }
	snippet?: string
	defaultAuthor: string
	onCancel: () => void
	onSubmit: (body: string, author: string) => void | Promise<void>
}

/**
 * Popover anchored to the right of the picked element. Submits a free-form
 * comment body with an author name (persisted in localStorage by the App).
 *
 * Stops propagation on its own clicks so the App's outside-click handler
 * doesn't immediately close it.
 */
export function CommentPopover({ rect, snippet, defaultAuthor, onCancel, onSubmit }: CommentPopoverProps) {
	const [body, setBody] = useState('')
	const [author, setAuthor] = useState(defaultAuthor)
	const [submitting, setSubmitting] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		textareaRef.current?.focus()
	}, [])

	const handleSubmit = async () => {
		if (!body.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit(body.trim(), author.trim() || 'Anonymous')
		} finally {
			setSubmitting(false)
		}
	}

	const handleKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault()
			onCancel()
		} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			handleSubmit()
		}
	}

	// Position to the right of the element when there's room, otherwise left.
	const sidebarWidth = 360
	const popoverWidth = 320
	const margin = 12
	const viewportW = window.innerWidth - sidebarWidth
	let left = rect.x + rect.width + margin
	if (left + popoverWidth > viewportW) {
		left = Math.max(margin, rect.x - popoverWidth - margin)
	}
	const top = Math.max(56, Math.min(rect.y, window.innerHeight - 260))

	return (
		<div
			class="notes-popover"
			style={{ left: `${left}px`, top: `${top}px` }}
			onClick={(e) => e.stopPropagation()}
			onKeyDown={handleKey}
		>
			<h4 class="notes-popover__title">Add comment</h4>
			{snippet
				? <div class="notes-popover__snippet">{snippet}</div>
				: null}
			<textarea
				ref={textareaRef}
				placeholder="Leave a note for the agency..."
				value={body}
				onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
			/>
			<input
				type="text"
				placeholder="Your name"
				value={author}
				onInput={(e) => setAuthor((e.target as HTMLInputElement).value)}
			/>
			<div class="notes-popover__row">
				<span class="notes-sidebar__hint">⌘+Enter to save</span>
				<div style={{ display: 'flex', gap: '6px' }}>
					<button class="notes-btn notes-btn--ghost" onClick={onCancel} disabled={submitting}>
						Cancel
					</button>
					<button class="notes-btn notes-btn--primary" onClick={handleSubmit} disabled={!body.trim() || submitting}>
						{submitting ? 'Saving...' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	)
}
