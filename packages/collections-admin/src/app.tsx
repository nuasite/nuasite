/**
 * collections-admin SPA — a standalone CMS admin.
 *
 * Layout: a persistent left **sidebar of content types** (collections) and a main
 * pane that shows the selected collection's entries list, the entry editor, or the
 * create form. Navigation is **hash-routed** (`#/c/<collection>/e/<slug>`), so
 * reloads and deep links work and back/forward behave.
 *
 * Host-agnostic: driven only by an `apiBase` prop, and the hash router keeps it
 * self-contained for its standalone consumers (cms-studio, the F7 `/_nua/admin`
 * page) without reaching for a host router. The webmaster Collections tab ships
 * its own UI, so hijacking the URL hash here is safe.
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
// View state + hash routing
// ============================================================================

type View =
	| { view: 'list' }
	| { view: 'entries'; collection: string }
	| { view: 'detail'; collection: string; slug: string }
	| { view: 'create'; collection: string }

/**
 * Parse the URL hash into a view. Slugs may contain `/` (nested glob entries),
 * so they are carried URL-encoded in a single `…/e/<slug>` segment.
 */
function parseRoute(hash: string): View {
	const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
	if (parts[0] !== 'c' || parts[1] === undefined) return { view: 'list' }
	const collection = decodeURIComponent(parts[1])
	if (parts[2] === 'new') return { view: 'create', collection }
	if (parts[2] === 'e' && parts[3] !== undefined) return { view: 'detail', collection, slug: decodeURIComponent(parts[3]) }
	return { view: 'entries', collection }
}

function routeToHash(view: View): string {
	switch (view.view) {
		case 'list':
			return '#/'
		case 'entries':
			return `#/c/${encodeURIComponent(view.collection)}`
		case 'create':
			return `#/c/${encodeURIComponent(view.collection)}/new`
		case 'detail':
			return `#/c/${encodeURIComponent(view.collection)}/e/${encodeURIComponent(view.slug)}`
	}
}

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
// Sidebar — content-type menu
// ============================================================================

function Sidebar({ collections, loading, error, activeCollection, onSelect, onReload, onClose }: {
	collections: CollectionDefinition[]
	loading: boolean
	error: CmsClientError | Error | null
	activeCollection: string | undefined
	onSelect: (collection: string) => void
	onReload: () => void
	onClose?: () => void
}) {
	// Group glob-nested collections (e.g. `jsem-otazky` under `jsem`) below their
	// parent, indented, so the menu mirrors the content structure.
	const childrenByParent = new Map<string, CollectionDefinition[]>()
	for (const c of collections) {
		if (!c.parentCollection) continue
		const arr = childrenByParent.get(c.parentCollection) ?? []
		arr.push(c)
		childrenByParent.set(c.parentCollection, arr)
	}
	const topLevel = collections.filter((c) => !c.parentCollection)

	const item = (c: CollectionDefinition, depth: number) => (
		<button
			key={c.name}
			type="button"
			className={`nua-cadmin-nav-item${c.name === activeCollection ? ' is-active' : ''}`}
			style={depth > 0 ? { paddingLeft: 12 + depth * 14 } : undefined}
			onClick={() => onSelect(c.name)}
			title={c.name}
		>
			<span className="nua-cadmin-nav-label">{c.label || c.name}</span>
			<span className="nua-cadmin-nav-count">{c.entryCount}</span>
		</button>
	)

	return (
		<aside className="nua-cadmin-sidebar">
			<div className="nua-cadmin-sidebar-head">
				<span className="nua-cadmin-brand">Collections</span>
				{onClose ? <button type="button" className="nua-cadmin-close" aria-label="Close" onClick={onClose}>×</button> : null}
			</div>
			<nav className="nua-cadmin-nav">
				{loading ? <div className="nua-cadmin-nav-state">Loading…</div> : null}
				{error
					? <button type="button" className="nua-cadmin-nav-state nua-cadmin-nav-error" onClick={onReload}>Failed to load — retry</button>
					: null}
				{!loading && !error && collections.length === 0 ? <div className="nua-cadmin-nav-state">No content types</div> : null}
				{!loading && !error
					? topLevel.flatMap((c) => [item(c, 0), ...(childrenByParent.get(c.name) ?? []).map((child) => item(child, 1))])
					: null}
			</nav>
		</aside>
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
	/** Optional close affordance shown in the sidebar (e.g. to collapse the WM tab). */
	onClose?: () => void
}

export function CollectionsAdminApp({ apiBase, onClose }: CollectionsAdminAppProps) {
	const client = useMemo(() => createClient(apiBase), [apiBase])
	const [state, setState] = useState<View>(() => typeof window !== 'undefined' ? parseRoute(window.location.hash) : { view: 'list' })

	// The hash is the source of truth for navigation: writing it fires `hashchange`,
	// which syncs React state — so back/forward, reload and deep links all work.
	useEffect(() => {
		const onHash = () => setState(parseRoute(window.location.hash))
		window.addEventListener('hashchange', onHash)
		onHash()
		return () => window.removeEventListener('hashchange', onHash)
	}, [])

	const navigate = useCallback((view: View) => {
		const hash = routeToHash(view)
		if (typeof window !== 'undefined' && window.location.hash !== hash) {
			window.location.hash = hash
		} else {
			setState(view)
		}
	}, [])

	// Collection definitions drive both the sidebar menu and the editor's field
	// rendering; load them once at the root and pass the active one down.
	const collectionsState = useAsync(() => client.getCollections(), [client])
	const collections = collectionsState.data ?? []

	const activeCollectionName = state.view !== 'list' ? state.collection : undefined
	const activeCollection = activeCollectionName ? collections.find((c) => c.name === activeCollectionName) : undefined
	const collectionLabel = activeCollection ? (activeCollection.label || activeCollection.name) : (activeCollectionName ?? '')

	const goEntries = useCallback((collection: string) => navigate({ view: 'entries', collection }), [navigate])
	const goDetail = useCallback((collection: string, slug: string) => navigate({ view: 'detail', collection, slug }), [navigate])
	const goCreate = useCallback((collection: string) => navigate({ view: 'create', collection }), [navigate])

	return (
		<div className="nua-cadmin">
			<Sidebar
				collections={collections}
				loading={collectionsState.loading}
				error={collectionsState.error}
				activeCollection={activeCollectionName}
				onSelect={goEntries}
				onReload={collectionsState.reload}
				onClose={onClose}
			/>

			<main className="nua-cadmin-main">
				<div className="nua-cadmin-header">
					{state.view === 'detail' || state.view === 'create'
						? <button type="button" className="nua-cadmin-back" onClick={() => goEntries(state.collection)}>← {collectionLabel}</button>
						: null}
					<h2 className="nua-cadmin-title">
						{state.view === 'list' ? 'Content' : collectionLabel}
						{state.view === 'detail' ? <span className="nua-cadmin-crumb">/ {state.slug}</span> : null}
						{state.view === 'create' ? <span className="nua-cadmin-crumb">/ new entry</span> : null}
					</h2>
					<span className="nua-cadmin-spacer" />
				</div>

				<div className="nua-cadmin-body">
					{state.view === 'list'
						? (collectionsState.error
							? <ErrorState error={collectionsState.error} onRetry={collectionsState.reload} />
							: <EmptyState label="Pick a content type from the left to browse its entries." />)
						: null}
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
			</main>
		</div>
	)
}
