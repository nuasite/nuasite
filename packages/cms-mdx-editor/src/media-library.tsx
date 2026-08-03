/**
 * Media library modal — browse folders, filter/search, upload (button + drag-drop),
 * create folders, and select an asset. React port of `@nuasite/cms`'s in-iframe
 * `media-library.tsx`, driven by an injected `MediaSource` (the host's CmsClient)
 * instead of the old signals/markdown-api globals. Self-contained light-theme
 * inline styles so it renders in any host.
 *
 * Opened from the body/slot toolbar (insert an image into prose) and from `image`
 * props in the block card. Degrades gracefully when the sidecar has no media
 * adapter (`501`): the gallery shows an "unavailable" hint and the manual-URL path
 * stays usable upstream.
 *
 * The listing is paged: each folder is read one `PAGE_SIZE` page at a time and the
 * rest is pulled in by an explicit "Load more". Search and the type filter run over
 * the loaded items only, so turning either on drains the remaining pages first —
 * see `Listing` and the drain effect for how that stays bounded and cancellable.
 */
import type { MediaFolderItem, MediaItem, MediaListResult, MediaTypeFilter } from '@nuasite/cms-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isMediaUnavailableError, type MediaContext, type MediaSource } from './media-source'

const VECTOR_TYPES = new Set(['image/svg+xml', 'image/x-icon'])

/**
 * Items per listing request. Above the server's default of 50 so most folders are
 * one page, low enough that the first paint does not fetch hundreds of thumbnails.
 */
const PAGE_SIZE = 60

/**
 * Hard cap on the pages followed for one folder. The cursor checks below already
 * stop a server that repeats or drops its cursor; this is the backstop for one that
 * keeps minting fresh ones — a client-side infinite loop must not be reachable.
 */
const MAX_PAGES = 200

/**
 * Paging state for one folder. A folder switch replaces the whole object, so its
 * identity doubles as the request token: a response whose listing is no longer
 * `listingRef.current` belongs to a folder the user has left and is dropped.
 */
interface Listing {
	folder: string
	/** Cursor for the next page; `undefined` once the listing is exhausted. */
	cursor: string | undefined
	/** Cursors already followed — one coming back means the server is not advancing. */
	seen: Set<string>
	pages: number
	/** A request is in flight for this listing (guards double-clicks and re-entry). */
	busy: boolean
	/** The last page failed; the drain stops until the user retries. */
	failed: boolean
}

function createListing(folder: string): Listing {
	return { folder, cursor: undefined, seen: new Set(), pages: 0, busy: false, failed: false }
}

/**
 * The cursor to follow after `result`, or `undefined` when the listing ends.
 * `stalled` marks an end nobody asked for: the page claims more but hands back no
 * usable cursor (missing, or one already followed), or the page cap is reached.
 */
function advance(result: MediaListResult, listing: Listing): { cursor: string | undefined; stalled: boolean } {
	if (!result.hasMore) return { cursor: undefined, stalled: false }
	const cursor = result.cursor
	if (cursor === undefined || listing.seen.has(cursor) || listing.pages >= MAX_PAGES) return { cursor: undefined, stalled: true }
	listing.seen.add(cursor)
	return { cursor, stalled: false }
}

/**
 * Fold a page's folder list into the one on screen. Every page is supposed to carry
 * the full list for the listed directory, so after page 1 this is normally a no-op.
 * Merging rather than replacing keeps the list intact when a page omits it, and
 * keeps a folder the user just created from being wiped by the next page.
 */
function mergeFolders(current: MediaFolderItem[], incoming: MediaFolderItem[]): MediaFolderItem[] {
	if (incoming.length === 0) return current
	const merged = new Map(current.map(folder => [folder.path, folder]))
	let added = false
	for (const folder of incoming) {
		if (merged.has(folder.path)) continue
		merged.set(folder.path, folder)
		added = true
	}
	return added ? [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)) : current
}

const TYPE_FILTERS: Array<{ value: MediaTypeFilter; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'photo', label: 'Photos' },
	{ value: 'graphic', label: 'Graphics' },
	{ value: 'document', label: 'Documents' },
]

function matchesTypeFilter(contentType: string, filter: MediaTypeFilter): boolean {
	if (filter === 'all') return true
	if (filter === 'photo') return contentType.startsWith('image/') && !VECTOR_TYPES.has(contentType)
	if (filter === 'graphic') return VECTOR_TYPES.has(contentType)
	if (filter === 'document') return contentType === 'application/pdf'
	return true
}

export interface MediaLibraryProps {
	media: MediaSource
	context?: MediaContext
	/** Field name uploads are filed under (e.g. the image prop name, or 'body'). */
	field?: string
	/** File-input `accept`. Defaults to images + PDF. */
	accept?: string
	onSelect: (url: string, alt?: string) => void
	onClose: () => void
}

// ---- inline styles (light theme) ----
const backdrop: React.CSSProperties = {
	position: 'fixed',
	inset: 0,
	background: 'rgba(0,0,0,0.45)',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	zIndex: 1100,
}
const modal: React.CSSProperties = {
	width: 'min(760px, 94vw)',
	maxHeight: '82vh',
	display: 'flex',
	flexDirection: 'column',
	background: '#fff',
	border: '1px solid #d4d4d8',
	borderRadius: 12,
	boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
	overflow: 'hidden',
	fontSize: 13,
	color: '#27272a',
}
const headerBar: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	padding: '12px 16px',
	borderBottom: '1px solid #ececed',
}
const controls: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px', borderBottom: '1px solid #ececed' }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const input: React.CSSProperties = {
	flex: 1,
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
	whiteSpace: 'nowrap',
}
const primaryBtn: React.CSSProperties = { ...btn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: 16, overflowY: 'auto' }
const tile: React.CSSProperties = {
	position: 'relative',
	aspectRatio: '1 / 1',
	border: '1px solid #e4e4e7',
	borderRadius: 8,
	overflow: 'hidden',
	cursor: 'pointer',
	background: '#fafafa',
	padding: 0,
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	justifyContent: 'center',
	gap: 6,
}
const emptyPanel: React.CSSProperties = { padding: 32, textAlign: 'center', color: '#a1a1aa' }
const pagerBar: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: 8,
	padding: '8px 16px',
	borderTop: '1px solid #ececed',
	fontSize: 12,
	color: '#71717a',
}
const tileCaption: React.CSSProperties = {
	position: 'absolute',
	left: 0,
	right: 0,
	bottom: 0,
	padding: '4px 6px',
	fontSize: 11,
	color: '#fff',
	background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)',
	textAlign: 'left',
	whiteSpace: 'nowrap',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
}

export function MediaLibrary({ media, context, field, accept = 'image/*,application/pdf', onSelect, onClose }: MediaLibraryProps) {
	const [items, setItems] = useState<MediaItem[]>([])
	const [folders, setFolders] = useState<MediaFolderItem[]>([])
	const [currentFolder, setCurrentFolder] = useState('')
	const [searchQuery, setSearchQuery] = useState('')
	const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>('all')
	/** First page of the current folder — the grid is replaced by a placeholder. */
	const [loading, setLoading] = useState(false)
	/** A follow-up page — the grid stays on screen underneath. */
	const [loadingMore, setLoadingMore] = useState(false)
	const [hasMore, setHasMore] = useState(false)
	const [unavailable, setUnavailable] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)
	const [showNewFolder, setShowNewFolder] = useState(false)
	const [newFolderName, setNewFolderName] = useState('')
	const fileInputRef = useRef<HTMLInputElement>(null)
	const listingRef = useRef<Listing>(createListing(''))
	const mountedRef = useRef(true)

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
		}
	}, [])

	/**
	 * Fetch one page for `listing` and append it. Everything that touches state is
	 * gated on the listing still being the current one and the modal still being
	 * mounted, so a response that arrives after a folder switch or an unmount is
	 * dropped instead of landing in the wrong list.
	 */
	const loadPage = useCallback(async (listing: Listing) => {
		if (listing.busy || listingRef.current !== listing) return
		const first = listing.pages === 0
		listing.busy = true
		listing.failed = false
		if (first) setLoading(true)
		else setLoadingMore(true)
		setErrorMsg(null)
		try {
			const result = await media.listMedia({ folder: listing.folder || undefined, limit: PAGE_SIZE, cursor: listing.cursor })
			if (!mountedRef.current || listingRef.current !== listing) return
			listing.pages += 1
			setFolders(prev => mergeFolders(prev, result.folders))
			setItems(prev => (first ? result.items : [...prev, ...result.items]))
			const next = advance(result, listing)
			listing.cursor = next.cursor
			setHasMore(next.cursor !== undefined)
			if (next.stalled) setErrorMsg('Stopped loading this folder early — some files are not shown.')
		} catch (err: unknown) {
			if (!mountedRef.current || listingRef.current !== listing) return
			listing.failed = true
			if (isMediaUnavailableError(err)) {
				setUnavailable(true)
				setHasMore(false)
			} else {
				// Keep the cursor: the pager stays on screen and doubles as a retry.
				setErrorMsg(err instanceof Error ? err.message : 'Failed to load media')
			}
		} finally {
			listing.busy = false
			if (mountedRef.current && listingRef.current === listing) {
				setLoading(false)
				setLoadingMore(false)
			}
		}
	}, [media])

	// A folder switch starts a brand-new listing; the old one is abandoned mid-flight.
	useEffect(() => {
		const listing = createListing(currentFolder)
		listingRef.current = listing
		setItems([])
		setFolders([])
		setHasMore(false)
		void loadPage(listing)
	}, [currentFolder, loadPage])

	const query = searchQuery.trim().toLowerCase()
	const filterActive = query !== '' || typeFilter !== 'all'

	/**
	 * Search and the type filter only see what is loaded, so on a paged listing they
	 * would report "no matches" for a file sitting on page 3. Drain the remaining
	 * pages while a filter is on — one page per landed page, so the drain is
	 * interruptible by a folder switch, stops on error and never runs unbounded.
	 * `items` is the trigger rather than the loading flags: a page always appends
	 * into a fresh array, whereas the flags can flip back before React re-renders.
	 */
	useEffect(() => {
		if (!filterActive) return
		const listing = listingRef.current
		if (listing.busy || listing.failed || listing.cursor === undefined) return
		void loadPage(listing)
	}, [filterActive, items, loadPage])

	const navigateToFolder = (folder: string) => {
		setSearchQuery('')
		setCurrentFolder(folder)
	}

	const handleUpload = async (file: File) => {
		setUploading(true)
		setErrorMsg(null)
		try {
			const result = await media.uploadMedia(file, { ...context, field, folder: currentFolder || undefined })
			if (result.success && result.url) {
				// Astro image() uploads return entry-relative paths (`./foo.jpg`) that live
				// under src/content, not the media adapter — select directly, don't list.
				if (result.url.startsWith('./')) {
					onSelect(result.url, result.annotation ?? '')
					return
				}
				const newItem: MediaItem = {
					id: result.id ?? result.url,
					url: result.url,
					filename: result.filename ?? file.name,
					annotation: result.annotation,
					contentType: file.type || 'application/octet-stream',
					folder: currentFolder || undefined,
				}
				setItems(prev => [newItem, ...prev])
			} else {
				setErrorMsg(result.error ?? 'Upload failed')
			}
		} catch (err: unknown) {
			if (isMediaUnavailableError(err)) setUnavailable(true)
			else setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
		} finally {
			setUploading(false)
		}
	}

	const handleCreateFolder = async () => {
		const name = newFolderName.trim()
		if (!name || !media.createFolder) return
		if (/[/\\:*?"<>|]/.test(name)) {
			setErrorMsg('Invalid folder name')
			return
		}
		const folderPath = currentFolder ? `${currentFolder}/${name}` : name
		try {
			const result = await media.createFolder(folderPath)
			if (result.success) {
				setFolders(prev => [...prev, { name, path: folderPath }].sort((a, b) => a.name.localeCompare(b.name)))
			} else {
				setErrorMsg(result.error ?? 'Failed to create folder')
			}
		} catch (err: unknown) {
			setErrorMsg(err instanceof Error ? err.message : 'Failed to create folder')
		}
		setNewFolderName('')
		setShowNewFolder(false)
	}

	const filteredItems = useMemo(() => {
		const byType = typeFilter === 'all' ? items : items.filter(i => matchesTypeFilter(i.contentType, typeFilter))
		return query === '' ? byType : byType.filter(i => i.filename.toLowerCase().includes(query))
	}, [items, typeFilter, query])

	const breadcrumbs = useMemo(() => {
		if (!currentFolder) return []
		const parts = currentFolder.split('/')
		return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
	}, [currentFolder])

	const showFolders = !filterActive

	return (
		<div style={backdrop} onMouseDown={onClose} data-cms-ui="">
			<div
				style={modal}
				onMouseDown={e => e.stopPropagation()}
				onDrop={e => {
					e.preventDefault()
					const file = e.dataTransfer.files[0]
					if (file) void handleUpload(file)
				}}
				onDragOver={e => e.preventDefault()}
			>
				<div style={headerBar}>
					<strong style={{ fontSize: 15 }}>Media Library</strong>
					<button type="button" style={{ ...btn, border: 'none', fontSize: 18, lineHeight: 1, padding: 2 }} onClick={onClose} aria-label="Close">×</button>
				</div>

				<div style={controls}>
					{breadcrumbs.length > 0
						? (
							<div style={{ ...row, gap: 4, fontSize: 12, color: '#71717a' }}>
								<button type="button" style={{ ...btn, border: 'none', padding: '0 2px' }} onClick={() => navigateToFolder('')}>root</button>
								{breadcrumbs.map((c, i) => (
									<span key={c.path} style={row}>
										<span>/</span>
										{i === breadcrumbs.length - 1
											? <span style={{ color: '#27272a', fontWeight: 600 }}>{c.name}</span>
											: <button type="button" style={{ ...btn, border: 'none', padding: '0 2px' }} onClick={() => navigateToFolder(c.path)}>{c.name}</button>}
									</span>
								))}
							</div>
						)
						: null}

					<div style={row}>
						<input style={input} placeholder="Search files…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
						{media.createFolder ? <button type="button" style={btn} onClick={() => setShowNewFolder(v => !v)}>New folder</button> : null}
						<button type="button" style={primaryBtn} disabled={unavailable || uploading} onClick={() => fileInputRef.current?.click()}>
							{uploading ? 'Uploading…' : 'Upload'}
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept={accept}
							style={{ display: 'none' }}
							onChange={e => {
								const file = e.target.files?.[0]
								if (file) void handleUpload(file)
								e.target.value = ''
							}}
						/>
					</div>

					<div style={{ ...row, gap: 4 }}>
						{TYPE_FILTERS.map(f => (
							<button
								key={f.value}
								type="button"
								style={{
									...btn,
									padding: '3px 10px',
									fontSize: 12,
									// Same shorthand as `btn`, not `borderColor` — mixing the two makes React
									// warn when the selection moves and it has to drop the longhand again.
									...(typeFilter === f.value ? { background: '#2563eb', border: '1px solid #2563eb', color: '#fff' } : {}),
								}}
								onClick={() => setTypeFilter(f.value)}
							>
								{f.label}
							</button>
						))}
					</div>

					{showNewFolder && media.createFolder
						? (
							<div style={row}>
								<input
									style={input}
									autoFocus
									placeholder="Folder name…"
									value={newFolderName}
									onChange={e => setNewFolderName(e.target.value)}
									onKeyDown={e => {
										if (e.key === 'Enter') void handleCreateFolder()
										if (e.key === 'Escape') {
											setShowNewFolder(false)
											setNewFolderName('')
										}
									}}
								/>
								<button type="button" style={primaryBtn} onClick={() => void handleCreateFolder()}>Create</button>
							</div>
						)
						: null}

					{unavailable ? <div style={{ fontSize: 12, color: '#a16207' }}>Media uploads are not configured for this project.</div> : null}
					{errorMsg ? <div style={{ fontSize: 12, color: '#dc2626' }}>{errorMsg}</div> : null}
				</div>

				{loading
					? <div style={emptyPanel}>Loading…</div>
					: folders.length === 0 && filteredItems.length === 0
					? (
						// Never claim "no matches" while more pages are still coming in.
						<div style={emptyPanel}>
							{loadingMore
								? (filterActive ? 'Searching…' : 'Loading…')
								: filterActive
								? 'No matching files.'
								: 'No files yet. Upload one to get started.'}
						</div>
					)
					: (
						<div style={grid}>
							{showFolders
								? folders.map(folder => (
									<button
										key={folder.path}
										type="button"
										style={tile}
										onClick={() => navigateToFolder(folder.path)}
										title={folder.name}
										data-cms-media-folder={folder.path}
									>
										<span style={{ fontSize: 30 }}>📁</span>
										<span style={{ fontSize: 12, color: '#52525b', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
											{folder.name}
										</span>
									</button>
								))
								: null}
							{filteredItems.map(item => (
								<button
									key={item.id}
									type="button"
									style={tile}
									title={item.filename}
									data-cms-media-item={item.id}
									onClick={() => onSelect(item.url, item.annotation || item.filename || 'Image')}
								>
									{item.contentType.startsWith('image/')
										? (
											<img
												src={item.thumbnailUrl ?? item.url}
												alt={item.annotation || item.filename}
												style={{ width: '100%', height: '100%', objectFit: 'cover' }}
											/>
										)
										: <span style={{ fontSize: 30 }}>{item.contentType === 'application/pdf' ? '📄' : '📎'}</span>}
									<span style={tileCaption}>{item.filename}</span>
								</button>
							))}
						</div>
					)}

				{!loading && hasMore
					? (
						<div style={pagerBar}>
							{loadingMore
								? <span>{filterActive ? `Searching the whole folder… ${items.length} files scanned` : 'Loading…'}</span>
								: (
									<button type="button" style={btn} onClick={() => void loadPage(listingRef.current)}>
										Load more
									</button>
								)}
						</div>
					)
					: null}

				<div style={{ padding: '10px 16px', borderTop: '1px solid #ececed', fontSize: 12, color: '#a1a1aa', textAlign: 'center' }}>
					Drag and drop a file here to upload{currentFolder ? ` to ${currentFolder}` : ''}.
				</div>
			</div>
		</div>
	)
}
