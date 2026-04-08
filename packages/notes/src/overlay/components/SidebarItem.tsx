/** @jsxImportSource preact */
import type { NoteItem } from '../types'

interface SidebarItemProps {
	item: NoteItem
	active: boolean
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
 * One note card in the sidebar list. Phase 2 only renders the comment shape;
 * suggestion-specific UI (diff preview, apply button) ships in Phase 3/4.
 */
export function SidebarItem({ item, active, onFocus, onResolve, onReopen, onDelete }: SidebarItemProps) {
	const isResolved = item.status === 'resolved' || item.status === 'applied'
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
			{item.targetSnippet
				? <div class='notes-item__snippet'>{item.targetSnippet}</div>
				: null}
			<div class='notes-item__body'>{item.body}</div>
			<div class='notes-item__actions'>
				{isResolved
					? <button class='notes-btn notes-btn--ghost' onClick={onReopen}>Reopen</button>
					: <button class='notes-btn' onClick={onResolve}>Resolve</button>}
				<button class='notes-btn notes-btn--ghost notes-btn--danger' onClick={onDelete}>Delete</button>
			</div>
		</div>
	)
}
