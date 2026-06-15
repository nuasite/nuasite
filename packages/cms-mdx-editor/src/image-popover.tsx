/**
 * Inline popover shown after an image is picked from the media library: confirm the
 * alt text (prefilled from the library) and optionally add a caption/source. Apply
 * inserts the image; Cancel aborts insertion entirely. Mirrors the LinkPopover style.
 */
import { useState } from 'react'
import { popoverBtn, popoverInput, popoverWrap } from './link-popover'

export interface ImagePopoverProps {
	initialAlt: string
	onApply: (alt: string, caption: string) => void
	onClose: () => void
}

const wrap: React.CSSProperties = { ...popoverWrap, flexWrap: 'wrap' }
const label: React.CSSProperties = { fontSize: 11, color: '#71717a', whiteSpace: 'nowrap' }

export function ImagePopover({ initialAlt, onApply, onClose }: ImagePopoverProps) {
	const [alt, setAlt] = useState(initialAlt)
	const [caption, setCaption] = useState('')

	const apply = () => onApply(alt.trim(), caption.trim())

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			apply()
		}
		if (e.key === 'Escape') onClose()
	}

	return (
		<div style={wrap} data-mdx-action="image" onMouseDown={e => e.stopPropagation()}>
			<span style={label}>Alt</span>
			<input
				style={popoverInput}
				autoFocus
				placeholder="Alt text for screen readers"
				value={alt}
				onChange={e => setAlt(e.currentTarget.value)}
				onKeyDown={onKeyDown}
			/>
			<span style={label}>Caption</span>
			<input
				style={popoverInput}
				placeholder="Caption / source (optional)"
				value={caption}
				onChange={e => setCaption(e.currentTarget.value)}
				onKeyDown={onKeyDown}
			/>
			<button
				type="button"
				style={{ ...popoverBtn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }}
				onMouseDown={e => e.preventDefault()}
				onClick={apply}
			>
				Insert
			</button>
			<button type="button" style={popoverBtn} onMouseDown={e => e.preventDefault()} onClick={onClose}>Cancel</button>
		</div>
	)
}
