/** @jsxImportSource preact */
import type { NoteItem } from '../types'
import { SidebarItem } from './SidebarItem'

interface SidebarProps {
	page: string
	items: NoteItem[]
	activeId: string | null
	picking: boolean
	error: string | null
	staleIds: Set<string>
	applyingId: string | null
	onFocus: (id: string) => void
	onResolve: (id: string) => void
	onReopen: (id: string) => void
	onDelete: (id: string) => void
	onApply: (id: string) => void
}

export function Sidebar(
	{ page, items, activeId, picking, error, staleIds, applyingId, onFocus, onResolve, onReopen, onDelete, onApply }: SidebarProps,
) {
	const open = items.filter((i) => i.status !== 'resolved' && i.status !== 'applied')
	const closed = items.filter((i) => i.status === 'resolved' || i.status === 'applied')
	const renderItem = (item: NoteItem) => (
		<SidebarItem
			key={item.id}
			item={item}
			active={item.id === activeId}
			stale={staleIds.has(item.id)}
			applying={applyingId === item.id}
			onFocus={() => onFocus(item.id)}
			onResolve={() => onResolve(item.id)}
			onReopen={() => onReopen(item.id)}
			onDelete={() => onDelete(item.id)}
			onApply={() => onApply(item.id)}
		/>
	)
	return (
		<aside class="notes-sidebar">
			<header class="notes-sidebar__header">
				<h3 class="notes-sidebar__title">Review notes</h3>
				<div class="notes-sidebar__meta">
					{open.length} open · {closed.length} resolved · <code>{page}</code>
				</div>
			</header>
			<div class="notes-sidebar__list">
				{error ? <div class="notes-banner">{error}</div> : null}
				{items.length === 0
					? (
						<div class="notes-sidebar__empty">
							{picking
								? 'Click any text or element on the page to add a comment.'
								: 'Select text on the page to suggest an edit, or click "Pick element" to comment.'}
						</div>
					)
					: null}
				{open.map(renderItem)}
				{closed.length > 0
					? (
						<>
							<div class="notes-sidebar__meta" style={{ marginTop: '4px' }}>Resolved</div>
							{closed.map(renderItem)}
						</>
					)
					: null}
			</div>
		</aside>
	)
}
