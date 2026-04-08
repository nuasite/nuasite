/** @jsxImportSource preact */

interface DiffPreviewProps {
	original: string
	suggested: string
}

/**
 * Inline strikethrough + insertion diff for the sidebar suggestion card.
 *
 * v0.1 keeps it dead simple: original on top with strikethrough, suggested
 * underneath with an insertion mark. We don't try to highlight character-
 * level changes — the reviewer already saw the whole substring when they
 * made the suggestion, and the agency mostly cares about the new wording.
 */
export function DiffPreview({ original, suggested }: DiffPreviewProps) {
	return (
		<div class="notes-diff">
			<div class="notes-diff__row notes-diff__row--del">
				<span class="notes-diff__marker">−</span>
				<span class="notes-strikethrough">{original}</span>
			</div>
			<div class="notes-diff__row notes-diff__row--ins">
				<span class="notes-diff__marker">+</span>
				<span>{suggested}</span>
			</div>
		</div>
	)
}
