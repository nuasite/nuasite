import { useEffect, useMemo } from 'preact/hooks'
import { isCreatePageOpen, manifest, openMarkdownEditorForNewPage, resetCreatePageState } from '../signals'

export function CreatePageModal() {
	const visible = isCreatePageOpen.value

	// Get collection definitions from manifest (read signal directly for reactivity)
	const collectionDefinitions = manifest.value.collectionDefinitions ?? {}

	const collections = useMemo(() => {
		return Object.values(collectionDefinitions)
	}, [collectionDefinitions])

	// Single collection — skip picker and go straight to editor
	useEffect(() => {
		if (visible && collections.length === 1) {
			const col = collections[0]
			resetCreatePageState()
			if (col) {
				openMarkdownEditorForNewPage(col?.name, col)
			}
		}
	}, [visible, collections])

	const handleClose = () => {
		resetCreatePageState()
	}

	const handleSelectCollection = (name: string) => {
		const def = collectionDefinitions[name]
		if (def) {
			resetCreatePageState()
			openMarkdownEditorForNewPage(name, def)
		}
	}

	if (!visible) return null

	// No collections available
	if (collections.length === 0) {
		return (
			<div
				class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60 backdrop-blur-sm"
				onClick={handleClose}
				data-cms-ui
			>
				<div
					class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-md w-full border border-white/10"
					onClick={(e) => e.stopPropagation()}
					data-cms-ui
				>
					<div class="flex items-center justify-between p-5 border-b border-white/10">
						<h2 class="text-lg font-semibold text-white">Create New Page</h2>
						<CloseButton onClick={handleClose} />
					</div>
					<div class="p-8 text-center">
						<div class="text-white/60 mb-4">
							No content collections found.
						</div>
						<p class="text-white/40 text-sm">
							Add markdown files to <code class="bg-white/10 px-1.5 py-0.5 rounded">src/content/</code> subdirectories to enable page creation.
						</p>
					</div>
					<div class="flex items-center justify-end p-5 border-t border-white/10 bg-white/5 rounded-b-cms-xl">
						<button
							type="button"
							onClick={handleClose}
							class="px-4 py-2.5 text-sm text-white/80 font-medium rounded-cms-pill hover:bg-white/10 hover:text-white transition-colors"
							data-cms-ui
						>
							Close
						</button>
					</div>
				</div>
			</div>
		)
	}

	// Single collection auto-selected via useEffect above
	if (collections.length === 1) return null

	// Collection picker
	return (
		<div
			class="fixed inset-0 z-2147483647 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={handleClose}
			data-cms-ui
		>
			<div
				class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-md w-full border border-white/10"
				onClick={(e) => e.stopPropagation()}
				data-cms-ui
			>
				<div class="flex items-center justify-between p-5 border-b border-white/10">
					<h2 class="text-lg font-semibold text-white">Choose Collection</h2>
					<CloseButton onClick={handleClose} />
				</div>
				<div class="p-5 space-y-2">
					{collections.map((col) => (
						<button
							key={col.name}
							type="button"
							onClick={() => handleSelectCollection(col.name)}
							class="w-full flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 rounded-cms-lg border border-white/10 hover:border-white/20 transition-colors text-left"
							data-cms-ui
						>
							<div class="shrink-0 w-10 h-10 bg-cms-primary/20 rounded-cms-md flex items-center justify-center">
								<CollectionIcon />
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-white font-medium">{col.label}</div>
								<div class="text-white/50 text-sm">
									{col.entryCount} {col.entryCount === 1 ? 'entry' : 'entries'} &middot; {col.fields.length} fields
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
