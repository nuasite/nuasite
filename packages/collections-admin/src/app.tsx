/**
 * collections-admin SPA (cms-headless F3.1 read-only + F3.2 editing).
 *
 * Host-agnostic: driven only by an `apiBase` prop, with internal view-state
 * navigation (list → entries → editor/create) via React state — never the host
 * router. That keeps the same component usable as a webmaster tab today and at
 * `/_nua/admin` for local dev later (F7).
 *
 * Browse collections, list entries (sparse projection + cursor pagination), and
 * edit an entry: a field→widget form built from `FieldDefinition[]` with debounced
 * optimistic save and `409` conflict resolution, plus create/delete/rename flows.
 */

import { type CmsClient, CmsClientError, createClient } from '@nuasite/cms-client'
import type { CollectionDefinition, CollectionEntryInfo } from '@nuasite/cms-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EntryCreate } from './entry-create'
import { EntryEditor } from './entry-editor'
import './styles.css'

// ============================================================================
// View state
// ============================================================================

type View =
	| { view: 'list' }
	| { view: 'entries'; collection: string }
	| { view: 'detail'; collection: string; slug: string }
	| { view: 'create'; collection: string }

// ============================================================================
// Shared async-load hook
// ============================================================================

interface LoadState<T> {
	data: T | null
	error: CmsClientError | Error | null
	loading: boolean
}

function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): LoadState<T> & { reload: () => void } {
	const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true })
	const [nonce, setNonce] = useState(0)
	const loadRef = useRef(load)
	loadRef.current = load

	// `load` is read through a ref; re-runs are driven by the explicit `deps` and
	// the reload `nonce` so the effect deps stay stable and lint-clean.
	const effectDeps = [...deps, nonce]
	useEffect(() => {
		let active = true
		setState({ data: null, error: null, loading: true })
		loadRef.current().then(
			(data) => {
				if (active) setState({ data, error: null, loading: false })
			},
			(error: unknown) => {
				if (active) setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false })
			},
		)
		return () => {
			active = false
		}
	}, effectDeps)

	const reload = useCallback(() => setNonce((n) => n + 1), [])
	return { ...state, reload }
}

// ============================================================================
// Presentational primitives
// ============================================================================

function Spinner({ label }: { label: string }) {
	return (
		<div className="nua-cadmin-state">
			<div className="nua-cadmin-spinner" />
			<div>{label}</div>
		</div>
	)
}

function ErrorState({ error, onRetry }: { error: CmsClientError | Error; onRetry?: () => void }) {
	const title = error instanceof CmsClientError && error.isUnauthorized
		? 'Session expired'
		: error instanceof CmsClientError && error.isForbidden
		? 'No access'
		: 'Something went wrong'
	return (
		<div className="nua-cadmin-error">
			<div className="nua-cadmin-error-title">{title}</div>
			<div>{error.message}</div>
			{onRetry ? <button type="button" className="nua-cadmin-retry" onClick={onRetry}>Try again</button> : null}
		</div>
	)
}

function EmptyState({ label }: { label: string }) {
	return <div className="nua-cadmin-state">{label}</div>
}

// ============================================================================
// Collection list
// ============================================================================

function CollectionList({ client, onOpen }: { client: CmsClient; onOpen: (collection: string) => void }) {
	const { data, error, loading, reload } = useAsync(() => client.getCollections(), [client])

	if (loading) return <Spinner label="Loading collections…" />
	if (error) return <ErrorState error={error} onRetry={reload} />
	if (!data || data.length === 0) return <EmptyState label="No collections found in this project." />

	return (
		<div className="nua-cadmin-list">
			{data.map((collection) => (
				<button key={collection.name} type="button" className="nua-cadmin-card" onClick={() => onOpen(collection.name)}>
					<span className="nua-cadmin-card-main">
						<span className="nua-cadmin-card-label">{collection.label || collection.name}</span>
						<span className="nua-cadmin-card-sub">
							{collection.name}
							{collection.type ? ` · ${collection.type}` : ''}
							{` · ${collection.fileExtension}`}
						</span>
					</span>
					<span className="nua-cadmin-badge">{collection.entryCount} {collection.entryCount === 1 ? 'entry' : 'entries'}</span>
				</button>
			))}
		</div>
	)
}

// ============================================================================
// Entries table (sparse projection + cursor pagination)
// ============================================================================

const ENTRIES_PAGE_SIZE = 50
const ENTRIES_FIELDS = 'slug,title,draft,pathname'

function EntriesTable({ client, collection, onOpen, onCreate }: {
	client: CmsClient
	collection: string
	onOpen: (slug: string) => void
	onCreate: () => void
}) {
	const [rows, setRows] = useState<CollectionEntryInfo[]>([])
	const [cursor, setCursor] = useState<string | undefined>(undefined)
	const [hasMore, setHasMore] = useState(false)
	const [error, setError] = useState<CmsClientError | Error | null>(null)
	const [loading, setLoading] = useState(true)
	const [loadingMore, setLoadingMore] = useState(false)

	const loadPage = useCallback(
		async (nextCursor: string | undefined, append: boolean) => {
			if (append) setLoadingMore(true)
			else setLoading(true)
			setError(null)
			try {
				const result = await client.getEntries(collection, {
					fields: ENTRIES_FIELDS,
					draft: 'all',
					limit: ENTRIES_PAGE_SIZE,
					cursor: nextCursor,
				})
				setRows((prev) => (append ? [...prev, ...result.entries] : result.entries))
				setCursor(result.cursor)
				setHasMore(result.hasMore)
			} catch (e: unknown) {
				setError(e instanceof Error ? e : new Error(String(e)))
			} finally {
				setLoading(false)
				setLoadingMore(false)
			}
		},
		[client, collection],
	)

	useEffect(() => {
		setRows([])
		setCursor(undefined)
		setHasMore(false)
		void loadPage(undefined, false)
	}, [loadPage])

	if (loading) return <Spinner label="Loading entries…" />
	if (error) return <ErrorState error={error} onRetry={() => void loadPage(undefined, false)} />

	const toolbar = (
		<div className="nua-cadmin-entries-toolbar">
			<button type="button" className="nua-cadmin-btn nua-cadmin-btn-primary" onClick={onCreate}>+ New entry</button>
		</div>
	)

	if (rows.length === 0) {
		return (
			<div>
				{toolbar}
				<EmptyState label="This collection has no entries." />
			</div>
		)
	}

	return (
		<div>
			{toolbar}
			<table className="nua-cadmin-table">
				<thead>
					<tr>
						<th>Slug</th>
						<th>Title</th>
						<th>Draft</th>
						<th>Pathname</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((entry) => (
						<tr key={entry.slug} className="nua-cadmin-row" onClick={() => onOpen(entry.slug)}>
							<td className="nua-cadmin-cell-mono">{entry.slug}</td>
							<td>{entry.title ?? <span className="nua-cadmin-field-empty">—</span>}</td>
							<td>{entry.draft ? <span className="nua-cadmin-badge nua-cadmin-badge-draft">draft</span> : ''}</td>
							<td className="nua-cadmin-cell-mono">{entry.pathname ?? '—'}</td>
						</tr>
					))}
				</tbody>
			</table>
			{hasMore
				? (
					<button type="button" className="nua-cadmin-load-more" disabled={loadingMore} onClick={() => void loadPage(cursor, true)}>
						{loadingMore ? 'Loading…' : 'Load more'}
					</button>
				)
				: null}
		</div>
	)
}

// ============================================================================
// Root
// ============================================================================

export interface CollectionsAdminAppProps {
	/**
	 * Base URL the cms-sidecar is mounted under (the host adds the `/cms/v1`
	 * prefix). In webmaster this is `/app/project/:slug/session/:sessionId/cms`.
	 */
	apiBase: string
	/** Optional close affordance shown in the header (e.g. to collapse the WM tab). */
	onClose?: () => void
}

export function CollectionsAdminApp({ apiBase, onClose }: CollectionsAdminAppProps) {
	const client = useMemo(() => createClient(apiBase), [apiBase])
	const [state, setState] = useState<View>({ view: 'list' })

	// The collection definitions drive the editor's field rendering; load them once
	// at the root and pass the active one down.
	const collectionsState = useAsync(() => client.getCollections(), [client])
	const collections = collectionsState.data ?? []

	const goList = useCallback(() => setState({ view: 'list' }), [])
	const goEntries = useCallback((collection: string) => setState({ view: 'entries', collection }), [])
	const goDetail = useCallback((collection: string, slug: string) => setState({ view: 'detail', collection, slug }), [])
	const goCreate = useCallback((collection: string) => setState({ view: 'create', collection }), [])

	const activeCollection = state.view !== 'list'
		? collections.find((c) => c.name === state.collection)
		: undefined
	const collectionLabel = activeCollection ? (activeCollection.label || activeCollection.name) : (state.view !== 'list' ? state.collection : '')

	const isEntryView = state.view === 'detail' || state.view === 'create'

	return (
		<div className="nua-cadmin">
			<div className="nua-cadmin-header">
				{state.view === 'entries' ? <button type="button" className="nua-cadmin-back" onClick={goList}>← Collections</button> : null}
				{isEntryView
					? <button type="button" className="nua-cadmin-back" onClick={() => goEntries(state.collection)}>← {collectionLabel}</button>
					: null}

				{state.view === 'list' ? <h2 className="nua-cadmin-title">Collections</h2> : null}
				{state.view === 'entries' ? <h2 className="nua-cadmin-title">{collectionLabel}</h2> : null}
				{state.view === 'detail'
					? (
						<h2 className="nua-cadmin-title">
							{collectionLabel}
							<span className="nua-cadmin-crumb">/ {state.slug}</span>
						</h2>
					)
					: null}
				{state.view === 'create'
					? (
						<h2 className="nua-cadmin-title">
							{collectionLabel}
							<span className="nua-cadmin-crumb">/ new entry</span>
						</h2>
					)
					: null}

				<span className="nua-cadmin-spacer" />
				{onClose ? <button type="button" className="nua-cadmin-close" aria-label="Close" onClick={onClose}>×</button> : null}
			</div>

			<div className="nua-cadmin-body">
				{state.view === 'list' ? <CollectionList client={client} onOpen={goEntries} /> : null}
				{state.view === 'entries'
					? (
						<EntriesTable
							client={client}
							collection={state.collection}
							onOpen={(slug) => goDetail(state.collection, slug)}
							onCreate={() => goCreate(state.collection)}
						/>
					)
					: null}
				{state.view === 'detail'
					? (
						<EntryEditor
							// Remount the editor when the slug changes so its draft/baseHash reset cleanly.
							key={`${state.collection}/${state.slug}`}
							client={client}
							definition={activeCollection}
							collection={state.collection}
							slug={state.slug}
							onDeleted={() => goEntries(state.collection)}
							onRenamed={(newSlug) => goDetail(state.collection, newSlug)}
						/>
					)
					: null}
				{state.view === 'create'
					? (
						<EntryCreate
							client={client}
							definition={activeCollection}
							collection={state.collection}
							onCreated={(slug) => goDetail(state.collection, slug)}
							onCancel={() => goEntries(state.collection)}
						/>
					)
					: null}
			</div>
		</div>
	)
}
