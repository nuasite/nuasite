/** @jsxImportSource preact */
import type { NoteItem } from '../types'
import { DiffPreview } from './DiffPreview'
import { StaleWarning } from './StaleWarning'

interface SidebarItemProps {
	item: NoteItem
	active: boolean
	stale: boolean
	onFocus: () => void
	onResolve: () => void
	onReopen: () => void
	onDelete: () => void
}

function formatTime(iso: string): string {
	try {
		const d = new Date(iso)
		const now = new Date()
		const diffMs = now.getTime() - d.getTime()
		const diffMin = Math.floor(diffMs / 60000)
		if (diffMin < 1) return 'just now'
		if (diffMin < 60) return `${diffMin}m ago`
		const diffHr = Math.floor(diffMin / 60)
		if (diffHr < 24) return `${diffHr}h ago`
		const diffDays = Math.floor(diffHr / 24)
		if (diffDays < 7) return `${diffDays}d ago`
		return d.toLocaleDateString()
	} catch {
		return iso
	}
}

/**
 * One note card in the sidebar list. Renders both comment and suggestion
 * shapes from a unified data model: comments show the body; suggestions
 * show the inline diff and (if any) a rationale + body.
 */
export function SidebarItem({ item, active, stale, onFocus, onResolve, onReopen, onDelete }: SidebarItemProps) {
	const isResolved = item.status === 'resolved' || item.status === 'applied'
	const isSuggestion = item.type === 'suggestion' && item.range
	return (
		<div
			class={`notes-item ${active ? 'notes-item--active' : ''} ${isResolved ? 'notes-item--resolved' : ''}`}
			onMouseEnter={onFocus}
		>
			<div class='notes-item__head'>
				<div>
					<span class={`notes-item__badge notes-item__badge--${item.type}`}>
						{item.type}
					</span>
					{isResolved
						? <span class='notes-item__badge notes-item__badge--resolved'>{item.status}</span>
						: null}
					<span class='notes-item__author'>{item.author}</span>
				</div>
				<span class='notes-item__time'>{formatTime(item.createdAt)}</span>
			</div>

			{stale && isSuggestion ? <StaleWarning /> : null}

			{isSuggestion && item.range
				? (
					<>
						<DiffPreview original={item.range.originalText} suggested={item.range.suggestedText} />
						{item.range.rationale
							? (
								<div class='notes-item__rationale'>
									<span class='notes-item__rationale-label'>Why:</span> {item.range.rationale}
								</div>
							)
							: null}
						{item.body ? <div class='notes-item__body'>{item.body}</div> : null}
					</>
				)
				: (
					<>
						{item.targetSnippet
							? <div class='notes-item__snippet'>{item.targetSnippet}</div>
							: null}
						<div class='notes-item__body'>{item.body}</div>
					</>
				)}

			<div class='notes-item__actions'>
				{isResolved
					? <button class='notes-btn notes-btn--ghost' onClick={onReopen}>Reopen</button>
					: <button class='notes-btn' onClick={onResolve}>Resolve</button>}
				<button class='notes-btn notes-btn--ghost notes-btn--danger' onClick={onDelete}>Delete</button>
			</div>
		</div>
	)
}
