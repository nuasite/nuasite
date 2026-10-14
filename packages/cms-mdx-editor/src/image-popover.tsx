/**
 * Inline popover for an image's alt text and caption, next to a preview of the image they describe.
 * The caption is the image's `title`.
 *
 * - `insert` — shown after an image is picked from the media library: confirm the alt text
 *   (prefilled from the library) and optionally add a caption/source. Apply inserts the image;
 *   Cancel aborts insertion entirely.
 * - `edit` — shown for an image already in the text: change its alt text and caption, and swap the
 *   file itself when the host offers `onReplace`. What is typed survives a swap.
 *
 * Mirrors the LinkPopover style.
 */
import { useState } from 'react'
import { popoverBtn, popoverInput, popoverWrap } from './link-popover'

export interface ImagePopoverProps {
	mode: 'insert' | 'edit'
	initialAlt: string
	initialCaption: string
	/** Loadable URL of the image (see `mediaPreviewSrc`); `''` when nothing can load it. */
	previewSrc: string
	/** Pick another file for this image. Only in `edit` mode; absent → no media source to pick from. */
	onReplace?: () => void
	onApply: (alt: string, caption: string) => void
	onClose: () => void
}

const wrap: React.CSSProperties = { ...popoverWrap, flexWrap: 'wrap' }
/** The basis is what makes a narrow editor wrap a field onto its own line instead of squeezing it to nothing. */
const field: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 180px', minWidth: 0 }
const label: React.CSSProperties = { fontSize: 11, color: '#71717a', whiteSpace: 'nowrap' }
const actions: React.CSSProperties = { display: 'flex', gap: 6, marginLeft: 'auto' }
const preview: React.CSSProperties = {
	width: 48,
	height: 48,
	objectFit: 'contain',
	border: '1px solid #e4e4e7',
	borderRadius: 4,
	background: '#fafafa',
	flexShrink: 0,
}

export function ImagePopover({ mode, initialAlt, initialCaption, previewSrc, onReplace, onApply, onClose }: ImagePopoverProps) {
	const [alt, setAlt] = useState(initialAlt)
	const [caption, setCaption] = useState(initialCaption)

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
			{previewSrc !== '' ? <img src={previewSrc} alt="" style={preview} data-mdx-image-preview="" /> : null}
			{onReplace
				? <button type="button" style={popoverBtn} onMouseDown={e => e.preventDefault()} onClick={onReplace}>Replace image</button>
				: null}
			<label style={field}>
				<span style={label}>Alt</span>
				<input
					style={popoverInput}
					autoFocus
					placeholder="Alt text for screen readers"
					value={alt}
					onChange={e => setAlt(e.currentTarget.value)}
					onKeyDown={onKeyDown}
				/>
			</label>
			<label style={field}>
				<span style={label}>Caption</span>
				<input
					style={popoverInput}
					placeholder="Caption / source (optional)"
					value={caption}
					onChange={e => setCaption(e.currentTarget.value)}
					onKeyDown={onKeyDown}
				/>
			</label>
			<div style={actions}>
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
		</div>
	)
}
