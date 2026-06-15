/**
 * Inline popover for the YouTube toolbar button: paste a URL or bare id. Apply
 * extracts the 11-char video id and inserts a `:::youtube{<id>}` directive; if no
 * id can be parsed the popover stays open with an error rather than emitting junk.
 * Mirrors the LinkPopover style.
 */
import { useState } from 'react'
import { popoverBtn, popoverInput, popoverWrap } from './link-popover'
import { extractYoutubeId } from './youtube'

export interface YoutubePopoverProps {
	onApply: (id: string) => void
	onClose: () => void
}

const error: React.CSSProperties = { fontSize: 11, color: '#dc2626', whiteSpace: 'nowrap' }

export function YoutubePopover({ onApply, onClose }: YoutubePopoverProps) {
	const [value, setValue] = useState('')
	const [invalid, setInvalid] = useState(false)

	const apply = () => {
		const id = extractYoutubeId(value)
		if (!id) {
			setInvalid(true)
			return
		}
		onApply(id)
	}

	return (
		<div style={popoverWrap} data-mdx-action="youtube" onMouseDown={e => e.stopPropagation()}>
			<input
				style={popoverInput}
				autoFocus
				placeholder="YouTube URL or ID"
				value={value}
				onChange={e => {
					setValue(e.currentTarget.value)
					if (invalid) setInvalid(false)
				}}
				onKeyDown={e => {
					if (e.key === 'Enter') {
						e.preventDefault()
						apply()
					}
					if (e.key === 'Escape') onClose()
				}}
			/>
			{invalid ? <span style={error}>No video id found</span> : null}
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
