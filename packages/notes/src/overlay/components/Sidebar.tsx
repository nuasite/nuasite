/** @jsxImportSource preact */
import type { NoteItem } from '../types'
import { SidebarItem } from './SidebarItem'

interface SidebarProps {
	page: string
	items: NoteItem[]
	activeId: string | null
	picking: boolean
	error: string | null
	onFocus: (id: string) => void
	onResolve: (id: string) => void
	onReopen: (id: string) => void
	onDelete: (id: string) => void
}

export function Sidebar({ page, items, activeId, picking, error, onFocus, onResolve, onReopen, onDelete }: SidebarProps) {
	const open = items.filter((i) => i.status !== 'resolved' && i.status !== 'applied')
	const closed = items.filter((i) => i.status === 'resolved' || i.status === 'applied')
	return (
		<aside class='notes-sidebar'>
			<header class='notes-sidebar__header'>
				<h3 class='notes-sidebar__title'>Review notes</h3>
				<div class='notes-sidebar__meta'>
					{open.length} open · {closed.length} resolved · <code>{page}</code>
				</div>
			</header>
			<div class='notes-sidebar__list'>
				{error ? <div class='notes-banner'>{error}</div> : null}
				{items.length === 0
					? (
						<div class='notes-sidebar__empty'>
							{picking
								? 'Click any text or element on the page to add a comment.'
								: 'No notes on this page yet. Click "Pick element" to add one.'}
						</div>
					)
					: null}
				{open.map((item) => (
					<SidebarItem
						key={item.id}
						item={item}
						active={item.id === activeId}
						onFocus={() => onFocus(item.id)}
						onResolve={() => onResolve(item.id)}
						onReopen={() => onReopen(item.id)}
						onDelete={() => onDelete(item.id)}
					/>
				))}
				{closed.length > 0
					? (
						<>
							<div class='notes-sidebar__meta' style={{ marginTop: '4px' }}>Resolved</div>
							{closed.map((item) => (
								<SidebarItem
									key={item.id}
									item={item}
									active={item.id === activeId}
									onFocus={() => onFocus(item.id)}
									onResolve={() => onResolve(item.id)}
									onReopen={() => onReopen(item.id)}
									onDelete={() => onDelete(item.id)}
								/>
							))}
						</>
					)
					: null}
			</div>
		</aside>
	)
}
