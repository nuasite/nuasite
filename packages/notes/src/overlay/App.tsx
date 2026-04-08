/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { CommentPopover } from './components/CommentPopover'
import { ElementHighlight } from './components/ElementHighlight'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { fetchPageManifest } from './lib/manifest-fetch'
import { createNote, deleteNote, listNotes, setNoteStatus } from './lib/notes-fetch'
import { exitReviewMode, getCurrentPagePath } from './lib/url-mode'
import type { CmsPageManifest, NoteItem } from './types'

interface AppProps {
	urlFlag: string
}

interface PickState {
	cmsId: string
	rect: { x: number; y: number; width: number; height: number }
	snippet?: string
}

const AUTHOR_KEY = 'nua-notes-author'

function loadAuthor(): string {
	try {
		return localStorage.getItem(AUTHOR_KEY) || ''
	} catch {
		return ''
	}
}

function saveAuthor(name: string): void {
	try {
		localStorage.setItem(AUTHOR_KEY, name)
	} catch {
		// ignore
	}
}

function getRect(el: Element): { x: number; y: number; width: number; height: number } {
	const r = el.getBoundingClientRect()
	return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function findCmsAncestor(target: EventTarget | null): Element | null {
	let el = target as Element | null
	while (el && el.nodeType === 1) {
		if (el.hasAttribute?.('data-cms-id')) return el
		el = el.parentElement
	}
	return null
}

export function App({ urlFlag }: AppProps) {
	const page = useMemo(() => getCurrentPagePath(), [])
	const [items, setItems] = useState<NoteItem[]>([])
	const [manifest, setManifest] = useState<CmsPageManifest | null>(null)
	const [picking, setPicking] = useState(false)
	const [hoverRect, setHoverRect] = useState<PickState | null>(null)
	const [pendingPick, setPendingPick] = useState<PickState | null>(null)
	const [activeId, setActiveId] = useState<string | null>(null)
	const [activeRect, setActiveRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [author, setAuthor] = useState<string>(() => loadAuthor())

	// Load notes + manifest on mount
	useEffect(() => {
		let alive = true
		Promise.all([listNotes(page), fetchPageManifest(page)])
			.then(([file, mf]) => {
				if (!alive) return
				setItems(file.items)
				setManifest(mf)
			})
			.catch((err) => {
				if (!alive) return
				setError(err instanceof Error ? err.message : String(err))
			})
		return () => {
			alive = false
		}
	}, [page])

	// Reposition the active highlight when the page scrolls or resizes
	useEffect(() => {
		if (!activeId) {
			setActiveRect(null)
			return
		}
		const item = items.find((i) => i.id === activeId)
		if (!item) return
		const el = document.querySelector(`[data-cms-id="${item.targetCmsId}"]`)
		if (!el) {
			setActiveRect(null)
			return
		}
		const updateRect = () => setActiveRect(getRect(el))
		updateRect()
		window.addEventListener('scroll', updateRect, true)
		window.addEventListener('resize', updateRect)
		return () => {
			window.removeEventListener('scroll', updateRect, true)
			window.removeEventListener('resize', updateRect)
		}
	}, [activeId, items])

	// Picking-mode hover and click handlers, attached to the document
	useEffect(() => {
		if (!picking) {
			setHoverRect(null)
			return
		}
		const onMove = (e: MouseEvent) => {
			const el = findCmsAncestor(e.target)
			if (!el) {
				setHoverRect(null)
				return
			}
			const cmsId = el.getAttribute('data-cms-id')!
			setHoverRect({ cmsId, rect: getRect(el) })
		}
		const onClick = (e: MouseEvent) => {
			const el = findCmsAncestor(e.target)
			if (!el) return
			e.preventDefault()
			e.stopPropagation()
			const cmsId = el.getAttribute('data-cms-id')!
			const text = (el.textContent || '').trim().slice(0, 200)
			setPendingPick({ cmsId, rect: getRect(el), snippet: text })
			setPicking(false)
		}
		document.addEventListener('mousemove', onMove, true)
		document.addEventListener('click', onClick, true)
		return () => {
			document.removeEventListener('mousemove', onMove, true)
			document.removeEventListener('click', onClick, true)
		}
	}, [picking])

	const handleCreate = useCallback(
		async (body: string, authorName: string) => {
			if (!pendingPick) return
			saveAuthor(authorName)
			setAuthor(authorName)
			const entry = manifest?.entries?.[pendingPick.cmsId]
			try {
				const item = await createNote({
					page,
					type: 'comment',
					targetCmsId: pendingPick.cmsId,
					targetSourcePath: entry?.sourcePath,
					targetSourceLine: entry?.sourceLine,
					targetSnippet: entry?.sourceSnippet ?? pendingPick.snippet,
					body,
					author: authorName,
				})
				setItems((prev) => [...prev, item])
				setActiveId(item.id)
				setPendingPick(null)
				setError(null)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
			}
		},
		[page, pendingPick, manifest],
	)

	const handleResolve = useCallback(async (id: string) => {
		try {
			const item = await setNoteStatus(page, id, 'resolved')
			setItems((prev) => prev.map((i) => (i.id === id ? item : i)))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [page])

	const handleReopen = useCallback(async (id: string) => {
		try {
			const item = await setNoteStatus(page, id, 'open')
			setItems((prev) => prev.map((i) => (i.id === id ? item : i)))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [page])

	const handleDelete = useCallback(async (id: string) => {
		try {
			await deleteNote(page, id)
			setItems((prev) => prev.filter((i) => i.id !== id))
			if (activeId === id) setActiveId(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [page, activeId])

	return (
		<div class='notes-root'>
			<Toolbar
				page={page}
				count={items.length}
				picking={picking}
				onTogglePick={() => {
					setPicking((p) => !p)
					setPendingPick(null)
				}}
				onExit={() => exitReviewMode(urlFlag)}
			/>
			<Sidebar
				page={page}
				items={items}
				activeId={activeId}
				picking={picking}
				error={error}
				onFocus={setActiveId}
				onResolve={handleResolve}
				onReopen={handleReopen}
				onDelete={handleDelete}
			/>
			{picking && hoverRect ? <ElementHighlight rect={hoverRect.rect} /> : null}
			{activeRect ? <ElementHighlight rect={activeRect} persistent /> : null}
			{pendingPick
				? (
					<CommentPopover
						rect={pendingPick.rect}
						snippet={pendingPick.snippet}
						defaultAuthor={author}
						onCancel={() => setPendingPick(null)}
						onSubmit={handleCreate}
					/>
				)
				: null}
		</div>
	)
}
