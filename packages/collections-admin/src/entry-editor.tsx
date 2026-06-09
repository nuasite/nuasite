/**
 * Entry editor — editable form built from a collection's `FieldDefinition[]`,
 * with debounced optimistic save and `409` conflict resolution (cms-headless F3.2).
 *
 * Layout is driven by the field definitions:
 *  - `hidden` fields are dropped.
 *  - `position: 'header'` fields render in a top strip; `position: 'sidebar'` in a
 *    side column; the rest in the main column. `role` (`publish-toggle`/`publish-date`)
 *    pins a field to the top of the sidebar and styles it as a publish control.
 *  - `group` inserts a section header within a column.
 *  - the markdown `body` is edited as a textarea below the main fields.
 *
 * Save flow (see `phase-3-collections-tab.md`): edits update a native draft and
 * schedule a debounced `PATCH { frontmatter, body, baseHash }`. `GET …/entries/:slug`
 * exposes no hash, so the first save sends no `baseHash` (the sidecar skips the
 * check) and adopts `MutationResult.sourceHash` as the new baseHash; later saves
 * carry it. A `409` opens the conflict dialog: "use server" adopts the server copy
 * + `serverHash`; "use ours" re-PATCHes with `baseHash = serverHash` (force-over).
 */

import {
	type CmsClient,
	CmsClientError,
	type CmsConflict,
	draftFromEntry,
	draftFromServerFrontmatter,
	type EntryDraft,
	setDraftField,
} from '@nuasite/cms-client'
import { MdxBodyEditor } from '@nuasite/cms-mdx-editor'
import type { CollectionDefinition, ComponentDefinition, FieldDefinition } from '@nuasite/cms-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type EditorContext, FieldEditor } from './field-editor'

const SAVE_DEBOUNCE_MS = 700

type SaveStatus =
	| { kind: 'idle' }
	| { kind: 'saving' }
	| { kind: 'saved' }
	| { kind: 'conflict'; conflict: CmsConflict }
	| { kind: 'error'; message: string }

interface PartitionedFields {
	header: FieldDefinition[]
	sidebar: FieldDefinition[]
	main: FieldDefinition[]
}

/**
 * Split visible fields into layout columns. Sidebar leads with `role`-tagged
 * publish fields (toggle then date), then other sidebar-positioned fields.
 */
function partitionFields(fields: FieldDefinition[]): PartitionedFields {
	const visible = fields.filter(f => !f.hidden)
	const header = visible.filter(f => f.position === 'header')
	// A `role`-tagged field lives in the sidebar even without an explicit position.
	const sidebarPositioned = visible.filter(f => f.position === 'sidebar' || (f.role !== undefined && f.position !== 'header'))
	const main = visible.filter(f => f.position === undefined && f.role === undefined)

	const roleRank = (f: FieldDefinition): number => (f.role === 'publish-toggle' ? 0 : f.role === 'publish-date' ? 1 : 2)
	const sidebar = sidebarPositioned.slice().sort((a, b) => roleRank(a) - roleRank(b))
	return { header, sidebar, main }
}

/** Render a column of fields, emitting a section header whenever `group` changes. */
function FieldColumn({ fields, draft, onField, ctx }: {
	fields: FieldDefinition[]
	draft: EntryDraft
	onField: (name: string, value: unknown) => void
	ctx: EditorContext
}) {
	let lastGroup: string | undefined
	const rows: React.ReactNode[] = []
	for (const field of fields) {
		if (field.group && field.group !== lastGroup) {
			rows.push(<h4 key={`group-${field.group}`} className="nua-cadmin-group-title">{field.group}</h4>)
			lastGroup = field.group
		}
		rows.push(
			<div key={field.name} className={`nua-cadmin-field${field.role ? ` nua-cadmin-field-${field.role}` : ''}`}>
				<div className="nua-cadmin-field-label">
					<span>{field.name}</span>
					<span className="nua-cadmin-field-type">{field.type}{field.required ? ' · required' : ''}</span>
				</div>
				<FieldEditor field={field} value={draft.frontmatter[field.name]} onChange={value => onField(field.name, value)} ctx={ctx} />
			</div>,
		)
	}
	return <>{rows}</>
}

// ============================================================================
// Conflict dialog
// ============================================================================

function ConflictDialog({ onUseServer, onUseOurs, onDismiss }: {
	onUseServer: () => void
	onUseOurs: () => void
	onDismiss: () => void
}) {
	return (
		<div className="nua-cadmin-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Edit conflict">
			<div className="nua-cadmin-dialog">
				<div className="nua-cadmin-dialog-title">This entry changed elsewhere</div>
				<div className="nua-cadmin-dialog-body">
					Someone (or the agent) edited this entry after you opened it. Choose which version to keep.
				</div>
				<div className="nua-cadmin-dialog-actions">
					<button type="button" className="nua-cadmin-btn" onClick={onUseServer}>Use server version</button>
					<button type="button" className="nua-cadmin-btn nua-cadmin-btn-primary" onClick={onUseOurs}>Keep my changes</button>
					<button type="button" className="nua-cadmin-btn nua-cadmin-btn-ghost" onClick={onDismiss}>Keep editing</button>
				</div>
			</div>
		</div>
	)
}

// ============================================================================
// Status badge
// ============================================================================

function StatusBadge({ status }: { status: SaveStatus }) {
	switch (status.kind) {
		case 'saving':
			return <span className="nua-cadmin-status nua-cadmin-status-saving">Saving…</span>
		case 'saved':
			return <span className="nua-cadmin-status nua-cadmin-status-saved">Saved</span>
		case 'conflict':
			return <span className="nua-cadmin-status nua-cadmin-status-conflict">Conflict</span>
		case 'error':
			return <span className="nua-cadmin-status nua-cadmin-status-error">{status.message}</span>
		default:
			return null
	}
}

// ============================================================================
// Editor
// ============================================================================

export function EntryEditor({ client, definition, collection, slug, onDeleted, onRenamed }: {
	client: CmsClient
	definition: CollectionDefinition | undefined
	collection: string
	slug: string
	onDeleted: () => void
	onRenamed: (newSlug: string) => void
}) {
	const fields = useMemo(() => definition?.fields ?? [], [definition])
	const isMdx = definition?.fileExtension === 'mdx'
	const [draft, setDraft] = useState<EntryDraft | null>(null)
	const [loadError, setLoadError] = useState<Error | null>(null)
	const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
	// Component definitions for the MDX block picker/labels. Only needed for mdx
	// bodies; degrades to an empty list against an older sidecar (no /components).
	const [components, setComponents] = useState<ComponentDefinition[]>([])

	// `baseHash` is the optimistic-concurrency token. It starts undefined (GET
	// exposes no hash) and is adopted from each successful `MutationResult.sourceHash`.
	const baseHashRef = useRef<string | undefined>(undefined)
	const draftRef = useRef<EntryDraft | null>(null)
	draftRef.current = draft
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const ctx: EditorContext = useMemo(() => ({ client, collection, slug }), [client, collection, slug])
	// Upload context for the MDX editor's media library (files entry-relative uploads).
	const mediaContext = useMemo(() => ({ collection, entry: slug }), [collection, slug])

	// Load the entry → build the native draft.
	useEffect(() => {
		let active = true
		baseHashRef.current = undefined
		setDraft(null)
		setLoadError(null)
		setStatus({ kind: 'idle' })
		client.getEntry(collection, slug).then(
			entry => {
				if (active) setDraft(draftFromEntry(entry, fields))
			},
			(err: unknown) => {
				if (active) setLoadError(err instanceof Error ? err : new Error(String(err)))
			},
		)
		return () => {
			active = false
			if (timerRef.current) clearTimeout(timerRef.current)
		}
	}, [client, collection, slug, fields])

	// Load component definitions for the MDX editor (once per client; mdx only).
	useEffect(() => {
		if (!isMdx) return
		let active = true
		client.getComponents().then(
			defs => { if (active) setComponents(defs) },
			() => { if (active) setComponents([]) },
		)
		return () => { active = false }
	}, [client, isMdx])

	// Persist the current draft. `force` re-uses the server hash to win a conflict.
	const persist = useCallback(
		async (next: EntryDraft, baseHash: string | undefined) => {
			setStatus({ kind: 'saving' })
			try {
				const outcome = await client.updateEntry(collection, slug, {
					frontmatter: next.frontmatter,
					body: next.body,
					baseHash,
				})
				if (outcome.status === 'conflict') {
					setStatus({ kind: 'conflict', conflict: outcome.conflict })
					return
				}
				if (outcome.result.sourceHash !== undefined) baseHashRef.current = outcome.result.sourceHash
				setStatus({ kind: 'saved' })
			} catch (err: unknown) {
				setStatus({ kind: 'error', message: err instanceof CmsClientError ? err.message : 'Save failed' })
			}
		},
		[client, collection, slug],
	)

	const scheduleSave = useCallback(
		(next: EntryDraft) => {
			if (timerRef.current) clearTimeout(timerRef.current)
			timerRef.current = setTimeout(() => {
				void persist(next, baseHashRef.current)
			}, SAVE_DEBOUNCE_MS)
		},
		[persist],
	)

	const onField = useCallback(
		(name: string, value: unknown) => {
			setDraft(prev => {
				if (!prev) return prev
				const next = setDraftField(prev, name, value)
				scheduleSave(next)
				return next
			})
		},
		[scheduleSave],
	)

	const onBody = useCallback(
		(body: string) => {
			setDraft(prev => {
				if (!prev) return prev
				const next = { ...prev, body }
				scheduleSave(next)
				return next
			})
		},
		[scheduleSave],
	)

	// --- Conflict resolution ---
	// These act on the current `conflict` status; the dialog only renders while
	// `status.kind === 'conflict'`, so reading `status` directly here is safe.

	const resolveUseServer = useCallback(() => {
		if (status.kind !== 'conflict') return
		const adopted = draftFromServerFrontmatter(status.conflict.serverFrontmatter, status.conflict.serverBody, fields)
		baseHashRef.current = status.conflict.serverHash
		setDraft(adopted)
		setStatus({ kind: 'saved' })
	}, [status, fields])

	const resolveUseOurs = useCallback(() => {
		if (status.kind !== 'conflict') return
		const current = draftRef.current
		if (current) void persist(current, status.conflict.serverHash)
	}, [status, persist])

	const dismissConflict = useCallback(() => {
		if (status.kind === 'conflict') setStatus({ kind: 'idle' })
	}, [status])

	// --- Delete / rename ---

	const onDelete = useCallback(async () => {
		if (typeof window !== 'undefined' && !window.confirm(`Delete entry "${slug}"? This cannot be undone.`)) return
		try {
			await client.deleteEntry(collection, slug)
			onDeleted()
		} catch (err: unknown) {
			setStatus({ kind: 'error', message: err instanceof CmsClientError ? err.message : 'Delete failed' })
		}
	}, [client, collection, slug, onDeleted])

	const onRename = useCallback(async () => {
		if (typeof window === 'undefined') return
		const to = window.prompt('Rename entry to (new slug):', slug)
		if (to === null || to.trim() === '' || to === slug) return
		try {
			await client.renameEntry(collection, slug, to.trim())
			onRenamed(to.trim())
		} catch (err: unknown) {
			setStatus({ kind: 'error', message: err instanceof CmsClientError ? err.message : 'Rename failed' })
		}
	}, [client, collection, slug, onRenamed])

	if (loadError) {
		return (
			<div className="nua-cadmin-error">
				<div className="nua-cadmin-error-title">Could not load entry</div>
				<div>{loadError.message}</div>
			</div>
		)
	}
	if (!draft) {
		return (
			<div className="nua-cadmin-state">
				<div className="nua-cadmin-spinner" />
				<div>Loading entry…</div>
			</div>
		)
	}

	const { header, sidebar, main } = partitionFields(fields)

	return (
		<div className="nua-cadmin-editor">
			<div className="nua-cadmin-editor-toolbar">
				<StatusBadge status={status} />
				<span className="nua-cadmin-spacer" />
				<button type="button" className="nua-cadmin-btn nua-cadmin-btn-ghost" onClick={() => void onRename()}>Rename</button>
				<button type="button" className="nua-cadmin-btn nua-cadmin-btn-danger" onClick={() => void onDelete()}>Delete</button>
			</div>

			{header.length > 0
				? (
					<div className="nua-cadmin-editor-header-fields">
						<FieldColumn fields={header} draft={draft} onField={onField} ctx={ctx} />
					</div>
				)
				: null}

			<div className="nua-cadmin-editor-grid">
				<div className="nua-cadmin-editor-main">
					<FieldColumn fields={main} draft={draft} onField={onField} ctx={ctx} />
					{definition?.type !== 'data'
						? (
							<div className="nua-cadmin-field">
								<div className="nua-cadmin-field-label">
									<span>Body</span>
									<span className="nua-cadmin-field-type">{isMdx ? 'mdx' : 'markdown'}</span>
								</div>
								{isMdx
									? <MdxBodyEditor value={draft.body} onChange={onBody} components={components} media={client} mediaContext={mediaContext} />
									: <textarea className="nua-cadmin-body-editor" value={draft.body} rows={16} onChange={e => onBody(e.target.value)} />}
							</div>
						)
						: null}
				</div>
				{sidebar.length > 0
					? (
						<div className="nua-cadmin-editor-sidebar">
							<FieldColumn fields={sidebar} draft={draft} onField={onField} ctx={ctx} />
						</div>
					)
					: null}
			</div>

			{status.kind === 'conflict'
				? <ConflictDialog onUseServer={resolveUseServer} onUseOurs={resolveUseOurs} onDismiss={dismissConflict} />
				: null}
		</div>
	)
}
