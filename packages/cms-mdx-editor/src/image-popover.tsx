/**
 * Inline popover for an image's alt text, next to a preview of the image it describes.
 *
 * - `insert` — shown after an image is picked from the media library: confirm the alt text
 *   (prefilled from the library) and optionally add a caption/source. Apply inserts the image;
 *   Cancel aborts insertion entirely.
 * - `edit` — shown for an image already in the text: change its alt text only. The caption is the
 *   image's `title`, which an alt edit leaves untouched, so the field is not offered.
 *
 * Mirrors the LinkPopover style.
 */
import { useState } from 'react'
import { popoverBtn, popoverInput, popoverWrap } from './link-popover'

export interface ImagePopoverProps {
	mode: 'insert' | 'edit'
	initialAlt: string
	/** Loadable URL of the image (see `mediaPreviewSrc`); `''` when nothing can load it. */
	previewSrc: string
	/** `caption` is always `''` in `edit` mode. */
	onApply: (alt: string, caption: string) => void
	onClose: () => void
}

const wrap: React.CSSProperties = { ...popoverWrap, flexWrap: 'wrap' }
const label: React.CSSProperties = { fontSize: 11, color: '#71717a', whiteSpace: 'nowrap' }
const preview: React.CSSProperties = {
	width: 48,
	height: 48,
	objectFit: 'contain',
	border: '1px solid #e4e4e7',
	borderRadius: 4,
	background: '#fafafa',
	flexShrink: 0,
}

export function ImagePopover({ mode, initialAlt, previewSrc, onApply, onClose }: ImagePopoverProps) {
	const [alt, setAlt] = useState(initialAlt)
	const [caption, setCaption] = useState('')

	const apply = () => onApply(alt.trim(), mode === 'insert' ? caption.trim() : '')

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			apply()
		}
		if (e.key === 'Escape') onClose()
	}

	return (
		<div style={wrap} data-mdx-action="image" onMouseDown={e => e.stopPropagation()}>
			{previewSrc !== '' ? <img src={previewSrc} alt="" style={preview} data-mdx-image-preview="" /> : null}
			<span style={label}>Alt</span>
			<input
				style={popoverInput}
				autoFocus
				placeholder="Alt text for screen readers"
				value={alt}
				onChange={e => setAlt(e.currentTarget.value)}
				onKeyDown={onKeyDown}
			/>
			{mode === 'insert'
				? (
					<>
						<span style={label}>Caption</span>
						<input
							style={popoverInput}
							placeholder="Caption / source (optional)"
							value={caption}
							onChange={e => setCaption(e.currentTarget.value)}
							onKeyDown={onKeyDown}
						/>
					</>
				)
				: null}
			<button
				type="button"
				style={{ ...popoverBtn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }}
				onMouseDown={e => e.preventDefault()}
				onClick={apply}
			>
				{mode === 'insert' ? 'Insert' : 'Save'}
			</button>
			<button type="button" style={popoverBtn} onMouseDown={e => e.preventDefault()} onClick={onClose}>Cancel</button>
		</div>
	)
}
