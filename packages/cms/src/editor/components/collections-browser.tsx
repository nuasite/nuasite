import { signal } from '@preact/signals'
import { useMemo, useState } from 'preact/hooks'
import { deleteMarkdownPage } from '../markdown-api'
import {
	closeCollectionsBrowser,
	config,
	isCollectionsBrowserOpen,
	manifest,
	openMarkdownEditorForEntry,
	openMarkdownEditorForNewPage,
	selectBrowserCollection,
	selectedBrowserCollection,
} from '../signals'
import { savePendingEntryNavigation } from '../storage'
import { ChevronRightIcon, CollectionIcon } from './create-page-modal'
import { CloseButton, ModalBackdrop, ModalHeader } from './modal-shell'

const deletingEntry = signal<string | null>(null)
const confirmDeleteSlug = signal<string | null>(null)

const EMPTY_ENTRIES: never[] = []

export function CollectionsBrowser() {
	const visible = isCollectionsBrowserOpen.value
	const selected = selectedBrowserCollection.value

	const collectionDefinitions = manifest.value.collectionDefinitions ?? {}

	const collections = useMemo(() => {
		return Object.values(collectionDefinitions).sort((a, b) => a.label.localeCompare(b.label))
	}, [collectionDefinitions])

	const [search, setSearch] = useState('')
	const selectedDef = selected ? collectionDefinitions[selected] : undefined
	const entries = selectedDef?.entries ?? EMPTY_ENTRIES

	const filteredEntries = useMemo(() => {
		if (!search) return entries
		const q = search.toLowerCase()
		return entries.filter(e => (e.title || '').toLowerCase().includes(q) || e.slug.toLowerCase().includes(q))
	}, [entries, search])

	if (!visible) return null

	const handleClose = () => {
		closeCollectionsBrowser()
	}

	// View 2: Entry list for selected collection
	if (selected) {
		const def = selectedDef
		if (!def) return null

		const handleEntryClick = (slug: string, sourcePath: string, pathname?: string) => {
			closeCollectionsBrowser()
			if (pathname) {
				// Navigate to the collection detail page to edit inline.
				savePendingEntryNavigation({ collectionName: selected, slug, sourcePath, pathname })
				window.location.href = pathname
			} else {
				// No detail page exists for this entry — open the markdown editor inline.
				openMarkdownEditorForEntry(selected, slug, sourcePath, def)
			}
		}

		const handleAddNew = () => {
			closeCollectionsBrowser()
			openMarkdownEditorForNewPage(selected, def)
		}

		const handleDeleteClick = (e: Event, slug: string) => {
			e.stopPropagation()
			confirmDeleteSlug.value = slug
		}

		const handleConfirmDelete = async (slug: string, sourcePath: string) => {
			deletingEntry.value = slug

			// Optimistically remove the entry from the manifest
			const defs = manifest.value.collectionDefinitions
			const currentDef = defs?.[selected]
			if (currentDef) {
				const updatedEntries = (currentDef.entries ?? []).filter(e => e.slug !== slug)
				manifest.value = {
					...manifest.value,
					collectionDefinitions: {
						...defs,
						[selected]: {
							...currentDef,
							entries: updatedEntries,
							entryCount: updatedEntries.length,
						},
					},
				}
			}

			deletingEntry.value = null
			confirmDeleteSlug.value = null

			// Fire the API call in the background
			deleteMarkdownPage(config.value, sourcePath)
		}

		const handleCancelDelete = (e: Event) => {
			e.stopPropagation()
			confirmDeleteSlug.value = null
		}

		return (
			<ModalBackdrop onClose={handleClose} extraClass="flex flex-col max-h-[80vh]">
				<div class="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
					<div class="flex items-center gap-3">
						<button
							type="button"
							onClick={() => { setSearch(''); selectBrowserCollection(null) }}
							class="text-white/50 hover:text-white p-1 hover:bg-white/10 rounded-full transition-colors"
							data-cms-ui
						>
							<BackArrowIcon />
						</button>
						<h2 class="text-lg font-semibold text-white">{def.label}</h2>
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onClick={handleAddNew}
							class="px-3 py-1.5 text-sm font-medium text-black bg-cms-primary hover:bg-cms-primary/80 rounded-cms-pill transition-colors"
							data-cms-ui
						>
							+ Add New
						</button>
						<CloseButton onClick={handleClose} />
					</div>
				</div>

				{entries.length > 0 && (
					<div class="px-5 pt-4 pb-2 shrink-0">
						<div class="relative">
							<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<circle cx="11" cy="11" r="8" />
								<path stroke-linecap="round" stroke-width="2" d="m21 21-4.3-4.3" />
							</svg>
							<input
								type="text"
								placeholder="Search..."
								value={search}
								onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
								class="w-full pl-9 pr-3 py-2 text-sm text-white bg-white/5 border border-white/10 rounded-cms-lg placeholder:text-white/30 focus:outline-none focus:border-white/20"
								data-cms-ui
							/>
						</div>
						<div class="text-white/30 text-xs mt-2">
							{search
								? `${filteredEntries.length} of ${entries.length}`
								: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
						</div>
					</div>
				)}

				<div class="px-5 pb-5 space-y-1 overflow-y-auto flex-1 min-h-0">
					{entries.length === 0 && (
						<div class="text-white/50 text-sm text-center py-8">
							No entries yet. Click "Add New" to create one.
						</div>
					)}
					{search && filteredEntries.length === 0 && entries.length > 0 && (
						<div class="text-white/50 text-sm text-center py-8">
							No matches for "{search}"
						</div>
					)}
					{filteredEntries.map((entry) => (
						<div key={entry.slug} class="relative" data-cms-ui>
							{confirmDeleteSlug.value === entry.slug
								? (
									<div class="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-cms-lg" data-cms-ui>
										<div class="flex-1 min-w-0 text-sm text-white/70">
											Delete "{entry.title || entry.slug}"?
										</div>
										<button
											type="button"
											onClick={() => handleConfirmDelete(entry.slug, entry.sourcePath)}
											disabled={deletingEntry.value === entry.slug}
											class="px-3 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-cms-pill transition-colors disabled:opacity-50"
											data-cms-ui
										>
											{deletingEntry.value === entry.slug ? 'Deleting...' : 'Delete'}
										</button>
										<button
											type="button"
											onClick={handleCancelDelete}
											class="px-3 py-1 text-xs font-medium text-white/60 hover:text-white bg-white/10 hover:bg-white/20 rounded-cms-pill transition-colors"
											data-cms-ui
										>
											Cancel
										</button>
									</div>
								)
								: (
									<button
										type="button"
										onClick={() => handleEntryClick(entry.slug, entry.sourcePath, entry.pathname)}
										class="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 rounded-cms-lg transition-colors text-left group"
										data-cms-ui
									>
										<div class="flex-1 min-w-0">
											<div class={`font-medium truncate ${entry.draft ? 'text-white/40' : 'text-white'}`}>
												{entry.title || entry.slug}
											</div>
											{entry.title && <div class="text-white/30 text-xs truncate">{entry.slug}</div>}
										</div>
										{entry.draft && (
											<span class="shrink-0 px-2 py-0.5 text-xs font-medium text-amber-400/80 bg-amber-400/10 rounded-full border border-amber-400/20">
												Draft
											</span>
										)}
										<button
											type="button"
											onClick={(e) => handleDeleteClick(e, entry.slug)}
											class="shrink-0 p-1 text-white/0 group-hover:text-white/30 hover:!text-red-400 rounded transition-colors"
											title="Delete entry"
											data-cms-ui
										>
											<TrashIcon />
										</button>
										<svg
											class="w-4 h-4 text-white/20 group-hover:text-white/40 shrink-0 transition-colors"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
										</svg>
									</button>
								)}
						</div>
					))}
				</div>
			</ModalBackdrop>
		)
	}

	// Empty state
	if (collections.length === 0) {
		return (
			<ModalBackdrop onClose={handleClose}>
				<ModalHeader title="Collections" onClose={handleClose} />
				<div class="p-8 text-center">
					<div class="text-white/60 mb-4">No content collections found.</div>
					<p class="text-white/40 text-sm">
						Add markdown files to <code class="bg-white/10 px-1.5 py-0.5 rounded">src/content/</code> subdirectories to enable collections.
					</p>
				</div>
			</ModalBackdrop>
		)
	}

	// Collection list
	return (
		<ModalBackdrop onClose={handleClose} extraClass="flex flex-col max-h-[80vh]">
			<ModalHeader title="Collections" onClose={handleClose} />
			<div class="p-5 space-y-2 overflow-y-auto flex-1 min-h-0">
				{collections.map((col) => (
					<button
						key={col.name}
						type="button"
						onClick={() => selectBrowserCollection(col.name)}
						class="w-full flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 rounded-cms-lg border border-white/10 hover:border-white/20 transition-colors text-left"
						data-cms-ui
					>
						<div class="shrink-0 w-10 h-10 bg-cms-primary/20 rounded-cms-md flex items-center justify-center">
							<CollectionIcon />
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-white font-medium">{col.label}</div>
							<div class="text-white/50 text-sm">
								{col.entryCount} {col.entryCount === 1 ? 'entry' : 'entries'}
							</div>
						</div>
						<ChevronRightIcon />
					</button>
				))}
			</div>
		</ModalBackdrop>
	)
}

function BackArrowIcon() {
	return (
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
		</svg>
	)
}

function TrashIcon() {
	return (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
			/>
		</svg>
	)
}
