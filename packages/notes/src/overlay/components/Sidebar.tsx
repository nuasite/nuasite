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
	isAgency: boolean
	onFocus: (id: string) => void
	onResolve: (id: string) => void
	onReopen: (id: string) => void
	onDelete: (id: string) => void
	onPurge: (id: string) => void
	onApply: (id: string) => void
}

export function Sidebar(
	{
		page,
		items,
		activeId,
		picking,
		error,
		staleIds,
		applyingId,
		isAgency,
		onFocus,
		onResolve,
		onReopen,
		onDelete,
		onPurge,
		onApply,
	}: SidebarProps,
) {
	// Sort items into three buckets. Clients never see deleted items at all.
	const open = items.filter((i) => i.status === 'open' || i.status === 'stale' || i.status === 'rejected')
	const resolved = items.filter((i) => i.status === 'resolved' || i.status === 'applied')
	const deleted = isAgency ? items.filter((i) => i.status === 'deleted') : []
	const visible = [...open, ...resolved, ...deleted]

	const renderItem = (item: NoteItem) => (
		<SidebarItem
			key={item.id}
			item={item}
			active={item.id === activeId}
			stale={staleIds.has(item.id)}
			applying={applyingId === item.id}
			isAgency={isAgency}
			onFocus={() => onFocus(item.id)}
			onResolve={() => onResolve(item.id)}
			onReopen={() => onReopen(item.id)}
			onDelete={() => onDelete(item.id)}
			onPurge={() => onPurge(item.id)}
			onApply={() => onApply(item.id)}
		/>
	)

	return (
		<aside class="notes-sidebar">
			<header class="notes-sidebar__header">
				<h3 class="notes-sidebar__title">Review notes</h3>
				<div class="notes-sidebar__meta">
					{open.length} open · {resolved.length} resolved
					{isAgency && deleted.length > 0 ? ` · ${deleted.length} deleted` : ''} · <code>{page}</code>
				</div>
			</header>
			<div class="notes-sidebar__list">
				{error ? <div class="notes-banner">{error}</div> : null}
				{visible.length === 0
					? (
						<div class="notes-sidebar__empty">
							{picking
								? 'Click any text or element on the page to add a comment.'
								: 'Select text on the page to suggest an edit, or click "Pick element" to comment.'}
						</div>
					)
					: null}
				{open.map(renderItem)}
				{resolved.length > 0
					? (
						<>
							<div class="notes-sidebar__section">Resolved</div>
							{resolved.map(renderItem)}
						</>
					)
					: null}
				{isAgency && deleted.length > 0
					? (
						<details class="notes-sidebar__deleted">
							<summary>Deleted ({deleted.length})</summary>
							{deleted.map(renderItem)}
						</details>
					)
					: null}
			</div>
		</aside>
	)
}
