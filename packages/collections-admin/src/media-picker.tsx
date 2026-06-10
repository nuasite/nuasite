/**
 * Media picker widget for `image`/`file`/`astroImage` fields (cms-headless F3.2).
 *
 * Holds a single URL string value. Lets the user paste/clear a URL and (when the
 * sidecar has a media adapter) upload a file via `POST …/media`.
 *
 * Graceful degradation: the deployed sidecar may have NO media adapter wired and
 * answers media routes with `501 unsupported`. The picker probes once via
 * `listMedia`; on `unsupported`/`501` it disables upload and shows a hint while
 * keeping the manual URL field fully usable — the editor is never blocked on media.
 */

import { type CmsClient, isMediaUnavailable } from '@nuasite/cms-client'
import { useEffect, useRef, useState } from 'react'

interface MediaPickerProps {
	client: CmsClient
	value: string
	collection: string
	entry?: string
	field: string
	accept?: string
	onChange: (url: string) => void
}

type MediaState =
	| { kind: 'probing' }
	| { kind: 'ready' }
	| { kind: 'unavailable' }
	| { kind: 'uploading' }
	| { kind: 'error'; message: string }

export function MediaPicker({ client, value, collection, entry, field, accept, onChange }: MediaPickerProps) {
	const [state, setState] = useState<MediaState>({ kind: 'probing' })
	const fileInputRef = useRef<HTMLInputElement>(null)

	// Probe media availability once. We don't render the gallery (out of scope for
	// F3.2) — we only need to know whether uploads are supported.
	useEffect(() => {
		let active = true
		client.listMedia({ limit: 1 }).then(
			() => {
				if (active) setState({ kind: 'ready' })
			},
			(err: unknown) => {
				if (!active) return
				setState(isMediaUnavailable(err) ? { kind: 'unavailable' } : { kind: 'ready' })
			},
		)
		return () => {
			active = false
		}
	}, [client])

	const onFile = async (file: File) => {
		setState({ kind: 'uploading' })
		try {
			const result = await client.uploadMedia(file, { collection, entry, field })
			if (result.success && result.url) {
				onChange(result.url)
				setState({ kind: 'ready' })
			} else {
				setState({ kind: 'error', message: result.error ?? 'Upload failed' })
			}
		} catch (err: unknown) {
			if (isMediaUnavailable(err)) {
				setState({ kind: 'unavailable' })
				return
			}
			setState({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed' })
		}
	}

	const canUpload = state.kind === 'ready' || state.kind === 'error'

	// Preview source: absolute URLs (and host-served root-relative / data URLs) load
	// directly; an entry-relative path (e.g. an Astro `image()` value like
	// `../../src/assets/x.webp`) is resolved + streamed by the sidecar, which needs
	// the owning entry's slug. Only render an `<img>` when the value looks like an
	// image, so `file` fields (PDFs, etc.) don't show a broken thumbnail.
	const isAbsolute = value !== '' && /^(https?:\/\/|data:|\/)/.test(value)
	const previewSrc = value === ''
		? ''
		: isAbsolute
		? value
		: entry !== undefined
		? client.mediaFileUrl(collection, entry, value)
		: ''
	const showPreview = previewSrc !== '' && (value.startsWith('data:image/') || /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(\?|#|$)/i.test(value))

	return (
		<div className="nua-cadmin-media">
			{showPreview ? <img className="nua-cadmin-img" src={previewSrc} alt="" /> : null}
			<div className="nua-cadmin-media-row">
				<input
					type="text"
					className="nua-cadmin-input"
					value={value}
					placeholder="Image URL or path"
					onChange={e => onChange(e.target.value)}
				/>
				{value !== ''
					? (
						<button type="button" className="nua-cadmin-icon-btn" aria-label="Clear" onClick={() => onChange('')}>
							×
						</button>
					)
					: null}
			</div>

			{state.kind === 'uploading' ? <div className="nua-cadmin-field-loading">Uploading…</div> : null}
			{state.kind === 'unavailable' ? <div className="nua-cadmin-media-hint">Media uploads unavailable — paste a URL or path instead.</div> : null}
			{state.kind === 'error' ? <div className="nua-cadmin-media-error">{state.message}</div> : null}

			{canUpload || state.kind === 'probing'
				? (
					<>
						<input
							ref={fileInputRef}
							type="file"
							accept={accept}
							className="nua-cadmin-file-input"
							disabled={!canUpload}
							onChange={e => {
								const file = e.target.files?.[0]
								if (file) void onFile(file)
								// Reset so re-selecting the same file fires `change` again.
								e.target.value = ''
							}}
						/>
						<button
							type="button"
							className="nua-cadmin-add-btn"
							disabled={!canUpload}
							onClick={() => fileInputRef.current?.click()}
						>
							Upload file
						</button>
					</>
				)
				: null}
		</div>
	)
}
