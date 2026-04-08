/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks'

interface SuggestPopoverProps {
	rect: { x: number; y: number; width: number; height: number }
	originalText: string
	defaultAuthor: string
	onCancel: () => void
	onSubmit: (input: { suggestedText: string; rationale: string; body: string; author: string }) => void | Promise<void>
}

/**
 * Google Docs-style suggestion popover. Shows the original text crossed out
 * (read-only), then a textarea pre-filled with the same text the reviewer
 * can edit, an optional rationale, and a one-line note. The author input
 * mirrors CommentPopover so the user only types their name once per session.
 */
export function SuggestPopover({ rect, originalText, defaultAuthor, onCancel, onSubmit }: SuggestPopoverProps) {
	const [suggested, setSuggested] = useState(originalText)
	const [rationale, setRationale] = useState('')
	const [body, setBody] = useState('')
	const [author, setAuthor] = useState(defaultAuthor)
	const [submitting, setSubmitting] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		// Focus the suggested text input and select-all so the reviewer can
		// just start typing the replacement.
		const ta = textareaRef.current
		if (ta) {
			ta.focus()
			ta.select()
		}
	}, [])

	const dirty = suggested.trim() !== originalText.trim()

	const handleSubmit = async () => {
		if (!dirty || submitting) return
		setSubmitting(true)
		try {
			await onSubmit({
				suggestedText: suggested,
				rationale: rationale.trim(),
				body: body.trim(),
				author: author.trim() || 'Anonymous',
			})
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

	const sidebarWidth = 360
	const popoverWidth = 360
	const margin = 12
	const viewportW = window.innerWidth - sidebarWidth
	let left = rect.x + rect.width + margin
	if (left + popoverWidth > viewportW) {
		left = Math.max(margin, rect.x - popoverWidth - margin)
		if (left < margin) left = margin
	}
	const top = Math.max(56, Math.min(rect.y, window.innerHeight - 360))

	return (
		<div
			class='notes-popover notes-popover--suggest'
			style={{ left: `${left}px`, top: `${top}px`, width: `${popoverWidth}px` }}
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			onKeyDown={handleKey}
		>
			<h4 class='notes-popover__title'>Suggest edit</h4>
			<div class='notes-popover__original'>
				<span class='notes-popover__label'>Original</span>
				<span class='notes-strikethrough'>{originalText}</span>
			</div>
			<div>
				<label class='notes-popover__label' for='nua-suggest-text'>Replacement</label>
				<textarea
					ref={textareaRef}
					id='nua-suggest-text'
					value={suggested}
					onInput={(e) => setSuggested((e.target as HTMLTextAreaElement).value)}
				/>
			</div>
			<div>
				<label class='notes-popover__label' for='nua-suggest-rationale'>Why? (optional)</label>
				<input
					type='text'
					id='nua-suggest-rationale'
					placeholder='Stronger framing, fixes typo, ...'
					value={rationale}
					onInput={(e) => setRationale((e.target as HTMLInputElement).value)}
				/>
			</div>
			<div>
				<label class='notes-popover__label' for='nua-suggest-body'>Note (optional)</label>
				<input
					type='text'
					id='nua-suggest-body'
					placeholder='Anything else for the agency'
					value={body}
					onInput={(e) => setBody((e.target as HTMLInputElement).value)}
				/>
			</div>
			<input
				type='text'
				placeholder='Your name'
				value={author}
				onInput={(e) => setAuthor((e.target as HTMLInputElement).value)}
			/>
			<div class='notes-popover__row'>
				<span class='notes-sidebar__hint'>{dirty ? '⌘+Enter to save' : 'Edit the replacement to enable save'}</span>
				<div style={{ display: 'flex', gap: '6px' }}>
					<button class='notes-btn notes-btn--ghost' onClick={onCancel} disabled={submitting}>
						Cancel
					</button>
					<button
						class='notes-btn notes-btn--primary'
						onClick={handleSubmit}
						disabled={!dirty || submitting}
					>
						{submitting ? 'Saving...' : 'Save suggestion'}
					</button>
				</div>
			</div>
		</div>
	)
}
