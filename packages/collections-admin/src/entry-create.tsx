/**
 * Create-entry form built from a collection's `FieldDefinition[]` (cms-headless F3.2).
 *
 * A required `slug` plus a field for each non-hidden definition (seeded from
 * `defaultValue`). On submit it `POST`s the new entry and hands the created slug
 * back to the host so it can open the editor. Reuses the same field widgets and
 * native draft model as the editor.
 */

import type { CollectionDefinition, FieldDefinition } from '@nuasite/cms-types'
import { useCallback, useMemo, useState } from 'react'
import { type CmsClient, CmsClientError } from './client'
import { type EditorContext, FieldEditor } from './field-editor'
import { draftForCreate, type EntryDraft, setDraftField } from './form-model'

function visibleFields(fields: FieldDefinition[]): FieldDefinition[] {
	return fields.filter(f => !f.hidden)
}

export function EntryCreate({ client, definition, collection, onCreated, onCancel }: {
	client: CmsClient
	definition: CollectionDefinition | undefined
	collection: string
	onCreated: (slug: string) => void
	onCancel: () => void
}) {
	const fields = useMemo(() => definition?.fields ?? [], [definition])
	const [slug, setSlug] = useState('')
	const [draft, setDraft] = useState<EntryDraft>(() => draftForCreate(fields))
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const ctx: EditorContext = useMemo(() => ({ client, collection }), [client, collection])

	const onField = useCallback((name: string, value: unknown) => {
		setDraft(prev => setDraftField(prev, name, value))
	}, [])

	const submit = useCallback(async () => {
		const trimmed = slug.trim()
		if (trimmed === '') {
			setError('A slug is required.')
			return
		}
		setSubmitting(true)
		setError(null)
		try {
			const result = await client.createEntry(collection, {
				slug: trimmed,
				frontmatter: draft.frontmatter,
				body: draft.body,
				fileExtension: definition?.fileExtension,
			})
			if (result.success) {
				onCreated(trimmed)
			} else {
				setError(result.error ?? 'Could not create the entry.')
			}
		} catch (err: unknown) {
			setError(err instanceof CmsClientError ? err.message : 'Could not create the entry.')
		} finally {
			setSubmitting(false)
		}
	}, [client, collection, definition, draft, slug, onCreated])

	const isData = definition?.type === 'data'

	return (
		<div className="nua-cadmin-editor">
			<div className="nua-cadmin-field">
				<div className="nua-cadmin-field-label">
					<span>slug</span>
					<span className="nua-cadmin-field-type">text · required</span>
				</div>
				<input type="text" className="nua-cadmin-input" value={slug} placeholder="my-new-entry" onChange={e => setSlug(e.target.value)} />
			</div>

			{visibleFields(fields).map(field => (
				<div key={field.name} className={`nua-cadmin-field${field.role ? ` nua-cadmin-field-${field.role}` : ''}`}>
					<div className="nua-cadmin-field-label">
						<span>{field.name}</span>
						<span className="nua-cadmin-field-type">{field.type}{field.required ? ' · required' : ''}</span>
					</div>
					<FieldEditor field={field} value={draft.frontmatter[field.name]} onChange={value => onField(field.name, value)} ctx={ctx} />
				</div>
			))}

			{!isData
				? (
					<div className="nua-cadmin-field">
						<div className="nua-cadmin-field-label">
							<span>Body</span>
							<span className="nua-cadmin-field-type">markdown</span>
						</div>
						<textarea
							className="nua-cadmin-body-editor"
							value={draft.body}
							rows={10}
							onChange={e => setDraft(prev => ({ ...prev, body: e.target.value }))}
						/>
					</div>
				)
				: null}

			{error ? <div className="nua-cadmin-media-error">{error}</div> : null}

			<div className="nua-cadmin-editor-toolbar">
				<button type="button" className="nua-cadmin-btn nua-cadmin-btn-ghost" disabled={submitting} onClick={onCancel}>Cancel</button>
				<span className="nua-cadmin-spacer" />
				<button type="button" className="nua-cadmin-btn nua-cadmin-btn-primary" disabled={submitting} onClick={() => void submit()}>
					{submitting ? 'Creating…' : 'Create entry'}
				</button>
			</div>
		</div>
	)
}
