/**
 * The media library's "default alt text" panel for one item. It takes the grid's place inside the
 * modal, so the preview and filename leave no doubt which file the text belongs to, and nothing on
 * screen can insert the image by accident.
 *
 * The saved text only prefills the alt of later insertions; content that already uses the item
 * keeps its own alt.
 */
import type { MediaItem } from '@nuasite/cms-types'
import { useState } from 'react'

export interface MediaAnnotationEditorProps {
	item: MediaItem
	save: (annotation: string) => Promise<{ success: boolean; error?: string }>
	onSaved: (annotation: string) => void
	onCancel: () => void
}

const panel: React.CSSProperties = { display: 'flex', gap: 16, padding: 16, overflowY: 'auto' }
const preview: React.CSSProperties = {
	width: 220,
	height: 220,
	flexShrink: 0,
	objectFit: 'contain',
	border: '1px solid #e4e4e7',
	borderRadius: 8,
	background: '#fafafa',
}
const fields: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }
const input: React.CSSProperties = {
	border: '1px solid #d4d4d8',
	borderRadius: 6,
	padding: '6px 10px',
	font: 'inherit',
	outline: 'none',
}
const btn: React.CSSProperties = {
	border: '1px solid #d4d4d8',
	background: '#fff',
	borderRadius: 6,
	padding: '6px 12px',
	font: 'inherit',
	cursor: 'pointer',
	color: '#3f3f46',
}
const primaryBtn: React.CSSProperties = { ...btn, background: '#2563eb', border: '1px solid #2563eb', color: '#fff' }

export function MediaAnnotationEditor({ item, save, onSaved, onCancel }: MediaAnnotationEditorProps) {
	const [annotation, setAnnotation] = useState(item.annotation ?? '')
	const [saving, setSaving] = useState(false)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)

	const submit = async () => {
		if (saving) return
		const value = annotation.trim()
		setSaving(true)
		setErrorMsg(null)
		try {
			const result = await save(value)
			if (result.success) {
				onSaved(value)
				return
			}
			setErrorMsg(result.error ?? 'Failed to save the alt text')
		} catch (err: unknown) {
			setErrorMsg(err instanceof Error ? err.message : 'Failed to save the alt text')
		}
		setSaving(false)
	}

	return (
		<div style={panel} data-cms-media-annotation={item.id}>
			<img src={item.thumbnailUrl ?? item.url} alt="" style={preview} />
			<div style={fields}>
				<strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.filename}>{item.filename}</strong>
				<label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#52525b' }}>
					Default alt text
					<input
						style={input}
						autoFocus
						placeholder="Describe the image for screen readers"
						value={annotation}
						disabled={saving}
						onChange={e => setAnnotation(e.currentTarget.value)}
						onKeyDown={e => {
							if (e.key === 'Enter') {
								e.preventDefault()
								void submit()
							}
							if (e.key === 'Escape') onCancel()
						}}
					/>
				</label>
				<div style={{ fontSize: 12, color: '#71717a' }}>
					Prefilled as the alt text when this image is inserted. Images already in the content keep their own.
				</div>
				{errorMsg ? <div style={{ fontSize: 12, color: '#dc2626' }}>{errorMsg}</div> : null}
				<div style={{ display: 'flex', gap: 8 }}>
					<button type="button" style={primaryBtn} disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save'}</button>
					<button type="button" style={btn} disabled={saving} onClick={onCancel}>Cancel</button>
				</div>
			</div>
		</div>
	)
}
