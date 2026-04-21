import type { ManifestEntry } from '../../types'
import { Z_INDEX } from '../constants'
import { positionFloatingChip } from '../dom'
import { describeSource } from './plain-text-chip-utils'

export interface PlainTextChipProps {
	visible: boolean
	rect: DOMRect | null
	entry: ManifestEntry | undefined
}

export function PlainTextChip({ visible, rect, entry }: PlainTextChipProps) {
	if (!visible || !rect) {
		return null
	}

	const maxChipWidth = 280
	const { left, top } = positionFloatingChip(rect, { width: maxChipWidth, height: 28 })

	const source = describeSource(entry)

	return (
		<div
			data-cms-ui
			onMouseDown={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
			onClick={(e) => e.stopPropagation()}
			style={{
				position: 'fixed',
				left: `${left}px`,
				top: `${top}px`,
				zIndex: Z_INDEX.MODAL,
				fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
				fontSize: '11px',
				maxWidth: `${maxChipWidth}px`,
			}}
		>
			<div class="flex items-center gap-2 px-3 py-1.5 bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-cms-xl text-white/80 min-w-0">
				<svg
					class="shrink-0"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M4 7V4h16v3" />
					<path d="M9 20h6" />
					<path d="M12 4v16" />
				</svg>
				<span class="truncate" title={`Plain text · ${source}`}>Plain text · {source}</span>
			</div>
		</div>
	)
}
