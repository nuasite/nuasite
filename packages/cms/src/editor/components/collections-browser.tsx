import { useMemo } from 'preact/hooks'
import {
	closeCollectionsBrowser,
	isCollectionsBrowserOpen,
	manifest,
	openMarkdownEditorForEntry,
	openMarkdownEditorForNewPage,
	selectBrowserCollection,
	selectedBrowserCollection,
} from '../signals'
import { savePendingEntryNavigation } from '../storage'

export function CollectionsBrowser() {
	const visible = isCollectionsBrowserOpen.value
	const selected = selectedBrowserCollection.value

	const collectionDefinitions = manifest.value.collectionDefinitions ?? {}

	const collections = useMemo(() => {
		return Object.values(collectionDefinitions).sort((a, b) => a.label.localeCompare(b.label))
	}, [collectionDefinitions])

	if (!visible) return null

	const handleClose = () => {
		closeCollectionsBrowser()
	}

	const handleBackdropClick = (e: Event) => {
		handleClose()
	}

	// View 2: Entry list for selected collection
	if (selected) {
		const def = collectionDefinitions[selected]
		if (!def) return null

		const entries = def.entries ?? []

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

		return (
			<div
				class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60 backdrop-blur-sm"
				onClick={handleBackdropClick}
				data-cms-ui
			>
				<div
					class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-md w-full border border-white/10 flex flex-col max-h-[80vh]"
					onClick={(e) => e.stopPropagation()}
					data-cms-ui
				>
					{/* Header */}
					<div class="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
						<div class="flex items-center gap-3">
							<button
								type="button"
								onClick={() => selectBrowserCollection(null)}
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

					{/* Entry list */}
					<div class="p-5 space-y-1 overflow-y-auto flex-1 min-h-0">
						{entries.length === 0 && (
							<div class="text-white/50 text-sm text-center py-8">
								No entries yet. Click "Add New" to create one.
							</div>
						)}
						{entries.map((entry) => (
							<button
								key={entry.slug}
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
								<svg
									class="w-4 h-4 text-white/20 group-hover:text-white/40 shrink-0 transition-colors"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
								</svg>
							</button>
						))}
					</div>
				</div>
			</div>
		)
	}

	// View 1: Collection list
	if (collections.length === 0) {
		return (
			<div
				class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60 backdrop-blur-sm"
				onClick={handleBackdropClick}
				data-cms-ui
			>
				<div
					class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-md w-full border border-white/10"
					onClick={(e) => e.stopPropagation()}
					data-cms-ui
				>
					<div class="flex items-center justify-between p-5 border-b border-white/10">
						<h2 class="text-lg font-semibold text-white">Collections</h2>
						<CloseButton onClick={handleClose} />
					</div>
					<div class="p-8 text-center">
						<div class="text-white/60 mb-4">No content collections found.</div>
						<p class="text-white/40 text-sm">
							Add markdown files to <code class="bg-white/10 px-1.5 py-0.5 rounded">src/content/</code> subdirectories to enable collections.
						</p>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div
			class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={handleBackdropClick}
			data-cms-ui
		>
			<div
				class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-md w-full border border-white/10 flex flex-col max-h-[80vh]"
				onClick={(e) => e.stopPropagation()}
				data-cms-ui
			>
				<div class="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
					<h2 class="text-lg font-semibold text-white">Collections</h2>
					<CloseButton onClick={handleClose} />
				</div>
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
			</div>
		</div>
	)
}

// ============================================================================
// Icons
// ============================================================================

function CloseButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			class="text-white/50 hover:text-white p-1.5 hover:bg-white/10 rounded-full transition-colors"
			data-cms-ui
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	)
}

function CollectionIcon() {
	return (
		<svg class="w-5 h-5 text-cms-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
			/>
		</svg>
	)
}

function ChevronRightIcon() {
	return (
		<svg class="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
		</svg>
	)
}

function BackArrowIcon() {
	return (
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
		</svg>
	)
}
