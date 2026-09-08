/**
 * Create-entry form built from a collection's `FieldDefinition[]` (cms-headless F3.2).
 *
 * A required `slug` plus a field for each non-hidden definition (seeded from
 * `defaultValue`). On submit it `POST`s the new entry and hands the created slug
 * back to the host so it can open the editor. Reuses the same field widgets and
 * native draft model as the editor.
 *
 * Field order comes from the same `resolveFormLayout` the editor renders, so a collection reads
 * the same way in both. What create does *not* borrow is the chrome: no tabs and no collapsed
 * blocks, because a form somebody is filling in for the first time should not hide fields behind
 * a click. Sections keep their headings and stay open.
 */

import {
	type CmsClient,
	CmsClientError,
	draftForCreate,
	type EntryDraft,
	fieldLabel,
	missingRequiredFields,
	missingRequiredMessage,
	resolveFormLayout,
	setDraftField,
	slugify,
	withEntrySlug,
} from '@nuasite/cms-client'
import type { CollectionDefinition } from '@nuasite/cms-types'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { type EditorContext, FieldEditor } from './field-editor'

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

	const { title, header, sidebar, sections } = useMemo(() => resolveFormLayout(fields, definition?.layout), [fields, definition?.layout])
	// One stack, in the plan's order. The side column is an editor affordance; here its fields
	// simply come last, after the main sections.
	const ordered = useMemo(
		() => [
			...(title ? [{ heading: undefined, fields: [title, ...header] }] : header.length > 0 ? [{ heading: undefined, fields: header }] : []),
			...sections.map(section => ({ heading: section.title, fields: section.fields })),
			...(sidebar.length > 0 ? [{ heading: undefined, fields: sidebar }] : []),
		],
		[title, header, sections, sidebar],
	)

	// What the server will actually write: `createEntry` fills a declared `slug` field from the
	// file slug, so the form validates and previews the same frontmatter rather than reporting a
	// required field the write would have filled in. `withEntrySlug` is that same rule.
	const normalizedSlug = useMemo(() => slugify(slug), [slug])
	const effectiveFrontmatter = useMemo(() => withEntrySlug(fields, draft.frontmatter, normalizedSlug), [fields, draft.frontmatter, normalizedSlug])

	const ctx: EditorContext = useMemo(() => ({ client, collection }), [client, collection])

	const onField = useCallback((name: string, value: unknown) => {
		setDraft(prev => setDraftField(prev, name, value))
	}, [])

	const submit = useCallback(async () => {
		// The sidecar slugifies whatever it receives, so send what it will actually write —
		// otherwise `onCreated` opens a slug that does not exist ("My Entry" → `my-entry`).
		if (normalizedSlug === '') {
			setError('A slug is required.')
			return
		}
		const missing = missingRequiredFields(fields, effectiveFrontmatter)
		if (missing.length > 0) {
			setError(missingRequiredMessage(missing))
			return
		}
		setSubmitting(true)
		setError(null)
		try {
			const result = await client.createEntry(collection, {
				slug: normalizedSlug,
				frontmatter: effectiveFrontmatter,
				body: draft.body,
				fileExtension: definition?.fileExtension,
			})
			if (result.success) {
				onCreated(normalizedSlug)
			} else {
				setError(result.error ?? 'Could not create the entry.')
			}
		} catch (err: unknown) {
			setError(err instanceof CmsClientError ? err.message : 'Could not create the entry.')
		} finally {
			setSubmitting(false)
		}
	}, [client, collection, definition, draft.body, effectiveFrontmatter, fields, normalizedSlug, onCreated])

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

			{ordered.map((block, index) => (
				<Fragment key={block.heading ?? `block-${index}`}>
					{block.heading ? <div className="nua-cadmin-section-summary">{block.heading}</div> : null}
					{block.fields.map(field => (
						<div key={field.name} className={`nua-cadmin-field${field.role ? ` nua-cadmin-field-${field.role}` : ''}`}>
							<div className="nua-cadmin-field-label">
								<span>{fieldLabel(field)}</span>
								<span className="nua-cadmin-field-type">{field.type}{field.required ? ' · required' : ''}</span>
							</div>
							<FieldEditor field={field} value={effectiveFrontmatter[field.name]} onChange={value => onField(field.name, value)} ctx={ctx} />
						</div>
					))}
				</Fragment>
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
