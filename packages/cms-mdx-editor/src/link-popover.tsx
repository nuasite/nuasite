/**
 * Small link editor popover used by the toolbar: type/edit a URL, apply, or remove
 * an existing link. Self-contained inline styles. (The original's page-path
 * autocomplete is intentionally dropped — the headless editor has no page manifest;
 * a plain URL covers link parity.)
 */
import { useState } from 'react'

export interface LinkPopoverProps {
	initialUrl: string
	isEdit: boolean
	onApply: (url: string) => void
	onRemove?: () => void
	onClose: () => void
}

const wrap: React.CSSProperties = {
	display: 'flex',
	gap: 6,
	alignItems: 'center',
	padding: 6,
	border: '1px solid #d4d4d8',
	borderRadius: 6,
	background: '#fff',
	boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
	marginTop: 6,
}
const input: React.CSSProperties = { flex: 1, border: '1px solid #d4d4d8', borderRadius: 4, padding: '4px 8px', font: 'inherit', outline: 'none', minWidth: 0 }
const btn: React.CSSProperties = { border: '1px solid #d4d4d8', background: '#fff', borderRadius: 4, padding: '4px 8px', font: 'inherit', fontSize: 12, cursor: 'pointer', color: '#3f3f46', whiteSpace: 'nowrap' }

export function LinkPopover({ initialUrl, isEdit, onApply, onRemove, onClose }: LinkPopoverProps) {
	const [url, setUrl] = useState(initialUrl)

	const apply = () => {
		const trimmed = url.trim()
		if (trimmed !== '') onApply(trimmed)
	}

	return (
		<div style={wrap} data-mdx-action="link" onMouseDown={e => e.stopPropagation()}>
			<input
				style={input}
				autoFocus
				placeholder="https://…"
				value={url}
				onChange={e => setUrl(e.target.value)}
				onKeyDown={e => {
					if (e.key === 'Enter') {
						e.preventDefault()
						apply()
					}
					if (e.key === 'Escape') onClose()
				}}
			/>
			<button type="button" style={{ ...btn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }} onMouseDown={e => e.preventDefault()} onClick={apply}>
				{isEdit ? 'Update' : 'Add'}
			</button>
			{isEdit && onRemove
				? <button type="button" style={{ ...btn, color: '#dc2626' }} onMouseDown={e => e.preventDefault()} onClick={onRemove}>Remove</button>
				: null}
			<button type="button" style={btn} onMouseDown={e => e.preventDefault()} onClick={onClose}>Cancel</button>
		</div>
	)
}
