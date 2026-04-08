/** @jsxImportSource preact */

interface SelectionTooltipProps {
	rect: { x: number; y: number; width: number; height: number }
	onComment: () => void
	onSuggest: () => void
}

/**
 * Floating tooltip that appears just above the user's text selection.
 * Two actions: leave a comment on the parent element, or open the
 * suggest popover with the selection as the range anchor.
 *
 * Positioning: centered horizontally over the selection, 36px above its
 * top edge (or below it if there's no room).
 */
export function SelectionTooltip({ rect, onComment, onSuggest }: SelectionTooltipProps) {
	const tooltipWidth = 220
	const tooltipHeight = 36
	const margin = 8

	let left = rect.x + rect.width / 2 - tooltipWidth / 2
	left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin - 360))

	let top = rect.y - tooltipHeight - margin
	if (top < 56) {
		// Below the selection if there's not enough room above
		top = rect.y + rect.height + margin
	}

	return (
		<div
			class="notes-selection-tooltip"
			style={{ left: `${left}px`, top: `${top}px`, width: `${tooltipWidth}px` }}
			onMouseDown={(e) => {
				// Prevent the click from clearing the user's text selection
				e.preventDefault()
			}}
		>
			<button class="notes-btn notes-btn--ghost" onClick={onComment}>
				💬 Comment
			</button>
			<button class="notes-btn notes-btn--primary" onClick={onSuggest}>
				✏️ Suggest edit
			</button>
		</div>
	)
}
