/** @jsxImportSource preact */

interface ToolbarProps {
	page: string
	count: number
	picking: boolean
	onTogglePick: () => void
	onExit: () => void
}

/**
 * Top bar for notes review mode. Shows the brand mark, current page path,
 * note count, a "Pick element" button (to enter the click-to-comment flow),
 * and an "Exit review" button that drops the cookie + reloads.
 */
export function Toolbar({ page, count, picking, onTogglePick, onExit }: ToolbarProps) {
	return (
		<div class='notes-toolbar'>
			<div class='notes-toolbar__brand'>
				<span class='notes-toolbar__dot' />
				<span>Notes</span>
				<span class='notes-toolbar__page'>{page} · {count} {count === 1 ? 'item' : 'items'}</span>
			</div>
			<div class='notes-toolbar__actions'>
				<button
					class={`notes-btn ${picking ? 'notes-btn--primary' : ''}`}
					onClick={onTogglePick}
					title='Click any text or element on the page to leave a comment'
				>
					{picking ? 'Cancel pick' : 'Pick element'}
				</button>
				<button class='notes-btn notes-btn--ghost' onClick={onExit} title='Leave review mode'>
					Exit
				</button>
			</div>
		</div>
	)
}
