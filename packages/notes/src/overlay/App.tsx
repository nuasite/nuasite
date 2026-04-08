/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { CommentPopover } from './components/CommentPopover'
import { ElementHighlight } from './components/ElementHighlight'
import { SelectionTooltip } from './components/SelectionTooltip'
import { Sidebar } from './components/Sidebar'
import { SuggestPopover } from './components/SuggestPopover'
import { Toolbar } from './components/Toolbar'
import { isSidebarCollapsed, setSidebarCollapsed } from './lib/cms-bridge'
import { fetchPageManifest } from './lib/manifest-fetch'
import { applyNote, createNote, deleteNote, listNotes, purgeNote, setNoteStatus } from './lib/notes-fetch'
import { findAnchorRange, selectionInsideElement } from './lib/range-anchor'
import { exitReviewMode, getCurrentPagePath, resolveRole } from './lib/url-mode'
import type { CmsPageManifest, NoteItem, NoteRole } from './types'

const COLLAPSED_KEY = 'nua-notes-sidebar-collapsed'

function loadCollapsed(): boolean {
	try {
		return localStorage.getItem(COLLAPSED_KEY) === '1'
	} catch {
		return false
	}
}

function saveCollapsed(value: boolean): void {
	try {
		localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
	} catch {
		// ignore
	}
}

interface AppProps {
	urlFlag: string
	agencyFlag: string
}

interface PickState {
	cmsId: string
	rect: { x: number; y: number; width: number; height: number }
	snippet?: string
}

interface SelectionState {
	cmsId: string
	anchorText: string
	rect: { x: number; y: number; width: number; height: number }
	elementRect: { x: number; y: number; width: number; height: number }
	elementSnippet?: string
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

function rectFromDom(r: DOMRect): { x: number; y: number; width: number; height: number } {
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

export function App({ urlFlag, agencyFlag }: AppProps) {
	const page = useMemo(() => getCurrentPagePath(), [])
	// Role is resolved once at mount. Visiting `?nua-agency` persists the
	// cookie so subsequent navigation stays in agency mode without re-typing.
	const role: NoteRole = useMemo(() => resolveRole(agencyFlag), [agencyFlag])
	const isAgency = role === 'agency'

	const [items, setItems] = useState<NoteItem[]>([])
	const [manifest, setManifest] = useState<CmsPageManifest | null>(null)
	const [picking, setPicking] = useState(false)
	const [hoverRect, setHoverRect] = useState<PickState | null>(null)
	const [pendingPick, setPendingPick] = useState<PickState | null>(null)
	const [pendingSuggest, setPendingSuggest] = useState<SelectionState | null>(null)
	const [pendingSelection, setPendingSelection] = useState<SelectionState | null>(null)
	const [activeId, setActiveId] = useState<string | null>(null)
	const [activeRect, setActiveRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [author, setAuthor] = useState<string>(() => loadAuthor())
	const [staleIds, setStaleIds] = useState<Set<string>>(new Set())
	const [applyingId, setApplyingId] = useState<string | null>(null)
	const [collapsed, setCollapsedState] = useState<boolean>(() => loadCollapsed())

	// Sync the body padding via cms-bridge whenever collapsed changes.
	// Persist to localStorage so the preference sticks across navigation.
	useEffect(() => {
		setSidebarCollapsed(collapsed)
		saveCollapsed(collapsed)
	}, [collapsed])

	// Initialize the body padding to match the loaded preference on mount.
	// This runs once before the first render so there's no flash of
	// uncollapsed sidebar when the user has it saved as collapsed.
	useEffect(() => {
		setSidebarCollapsed(loadCollapsed())
	}, [])

	const toggleCollapsed = useCallback(() => {
		setCollapsedState((c) => !c)
	}, [])

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

	// Re-attach suggestion anchors after items load. A suggestion is "stale"
	// if its anchorText can't be found inside its target element anymore
	// (e.g. the source file changed). Run on items change so HMR-driven
	// edits update the warning live.
	useEffect(() => {
		const stale = new Set<string>()
		for (const item of items) {
			if (item.type !== 'suggestion' || !item.range) continue
			const el = document.querySelector(`[data-cms-id="${item.targetCmsId}"]`)
			if (!el) {
				stale.add(item.id)
				continue
			}
			const match = findAnchorRange(el, item.range.anchorText)
			if (!match) stale.add(item.id)
		}
		setStaleIds(stale)
	}, [items])

	// Reposition the active highlight when the page scrolls or resizes.
	// For suggestion items, prefer the anchor range rect over the element rect.
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
		const updateRect = () => {
			if (item.type === 'suggestion' && item.range) {
				const match = findAnchorRange(el, item.range.anchorText)
				if (match) {
					setActiveRect(rectFromDom(match.rect))
					return
				}
			}
			setActiveRect(getRect(el))
		}
		updateRect()
		window.addEventListener('scroll', updateRect, true)
		window.addEventListener('resize', updateRect)
		return () => {
			window.removeEventListener('scroll', updateRect, true)
			window.removeEventListener('resize', updateRect)
		}
	}, [activeId, items])

	// Picking-mode hover and click handlers
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

	// Text selection capture (for the suggestion flow). Only active when not
	// in pick mode and no popover is open. Listens for selectionchange and
	// translates the current Selection into a SelectionState if it lands
	// inside a single data-cms-id element.
	useEffect(() => {
		if (picking || pendingPick || pendingSuggest) {
			setPendingSelection(null)
			return
		}
		const onSelectionChange = () => {
			const sel = document.getSelection()
			if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
				setPendingSelection(null)
				return
			}
			const range = sel.getRangeAt(0)
			const startEl = range.startContainer.nodeType === 3
				? range.startContainer.parentElement
				: range.startContainer as Element
			if (!startEl) return
			const cmsEl = findCmsAncestor(startEl)
			if (!cmsEl) {
				setPendingSelection(null)
				return
			}
			// Selection must stay inside the same data-cms-id element
			if (!cmsEl.contains(range.endContainer)) {
				setPendingSelection(null)
				return
			}
			const inside = selectionInsideElement(cmsEl, sel)
			if (!inside) {
				setPendingSelection(null)
				return
			}
			const cmsId = cmsEl.getAttribute('data-cms-id')!
			const elementSnippet = (cmsEl.textContent || '').trim().slice(0, 200)
			setPendingSelection({
				cmsId,
				anchorText: inside.text,
				rect: rectFromDom(inside.rect),
				elementRect: getRect(cmsEl),
				elementSnippet,
			})
		}
		document.addEventListener('selectionchange', onSelectionChange)
		return () => document.removeEventListener('selectionchange', onSelectionChange)
	}, [picking, pendingPick, pendingSuggest])

	const handleCreateComment = useCallback(
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

	const handleCreateSuggestion = useCallback(
		async (input: { suggestedText: string; rationale: string; body: string; author: string }) => {
			if (!pendingSuggest) return
			saveAuthor(input.author)
			setAuthor(input.author)
			const entry = manifest?.entries?.[pendingSuggest.cmsId]
			try {
				const item = await createNote({
					page,
					type: 'suggestion',
					targetCmsId: pendingSuggest.cmsId,
					targetSourcePath: entry?.sourcePath,
					targetSourceLine: entry?.sourceLine,
					targetSnippet: entry?.sourceSnippet ?? pendingSuggest.elementSnippet,
					range: {
						anchorText: pendingSuggest.anchorText,
						originalText: pendingSuggest.anchorText,
						suggestedText: input.suggestedText,
						rationale: input.rationale || undefined,
					},
					body: input.body,
					author: input.author,
				})
				setItems((prev) => [...prev, item])
				setActiveId(item.id)
				setPendingSuggest(null)
				setPendingSelection(null)
				// Clear the page selection so the tooltip doesn't reopen
				try {
					document.getSelection()?.removeAllRanges()
				} catch {}
				setError(null)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
			}
		},
		[page, pendingSuggest, manifest],
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
			// Soft delete: server flips status to 'deleted' and returns the
			// updated item. We keep it in the list so the agency sees it move
			// into the collapsed Deleted section. (Clients never see this
			// path because the Delete button is hidden for them.)
			const item = await deleteNote(page, id)
			setItems((prev) => prev.map((i) => (i.id === id ? item : i)))
			if (activeId === id) setActiveId(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [page, activeId])

	const handlePurge = useCallback(async (id: string) => {
		try {
			await purgeNote(page, id)
			setItems((prev) => prev.filter((i) => i.id !== id))
			if (activeId === id) setActiveId(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [page, activeId])

	const handleApply = useCallback(async (id: string) => {
		setApplyingId(id)
		try {
			const result = await applyNote(page, id)
			// On both success and 409 the server returns an updated item
			setItems((prev) => prev.map((i) => (i.id === id ? result.item : i)))
			if (result.error) {
				setError(result.error)
			} else {
				setError(null)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setApplyingId(null)
		}
	}, [page])

	const handleSelectionComment = useCallback(() => {
		if (!pendingSelection) return
		// Convert the selection into a comment on the parent element
		setPendingPick({
			cmsId: pendingSelection.cmsId,
			rect: pendingSelection.elementRect,
			snippet: pendingSelection.anchorText,
		})
		setPendingSelection(null)
	}, [pendingSelection])

	const handleSelectionSuggest = useCallback(() => {
		if (!pendingSelection) return
		setPendingSuggest(pendingSelection)
		setPendingSelection(null)
	}, [pendingSelection])

	return (
		<div class="notes-root">
			<Toolbar
				page={page}
				count={items.filter((i) => i.status !== 'deleted').length}
				picking={picking}
				role={role}
				collapsed={collapsed}
				onTogglePick={() => {
					setPicking((p) => !p)
					setPendingPick(null)
					setPendingSuggest(null)
				}}
				onToggleCollapse={toggleCollapsed}
				onExit={() => exitReviewMode(urlFlag, agencyFlag)}
			/>
			{collapsed
				? null
				: (
					<Sidebar
						page={page}
						items={items}
						activeId={activeId}
						picking={picking}
						error={error}
						staleIds={staleIds}
						applyingId={applyingId}
						isAgency={isAgency}
						onFocus={setActiveId}
						onResolve={handleResolve}
						onReopen={handleReopen}
						onDelete={handleDelete}
						onPurge={handlePurge}
						onApply={handleApply}
					/>
				)}
			{picking && hoverRect ? <ElementHighlight rect={hoverRect.rect} /> : null}
			{activeRect ? <ElementHighlight rect={activeRect} persistent /> : null}
			{pendingSelection && !pendingPick && !pendingSuggest
				? (
					<SelectionTooltip
						rect={pendingSelection.rect}
						onComment={handleSelectionComment}
						onSuggest={handleSelectionSuggest}
					/>
				)
				: null}
			{pendingPick
				? (
					<CommentPopover
						rect={pendingPick.rect}
						snippet={pendingPick.snippet}
						defaultAuthor={author}
						onCancel={() => setPendingPick(null)}
						onSubmit={handleCreateComment}
					/>
				)
				: null}
			{pendingSuggest
				? (
					<SuggestPopover
						rect={pendingSuggest.rect}
						originalText={pendingSuggest.anchorText}
						defaultAuthor={author}
						onCancel={() => {
							setPendingSuggest(null)
							try {
								document.getSelection()?.removeAllRanges()
							} catch {}
						}}
						onSubmit={handleCreateSuggestion}
					/>
				)
				: null}
		</div>
	)
}
