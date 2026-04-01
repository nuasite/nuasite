import { useCallback } from 'preact/hooks'
import { deletePage } from '../markdown-api'
import {
	config,
	deletePageState,
	isDeletePageOpen,
	resetDeletePageState,
	setDeletePageCreateRedirect,
	setDeletePageRedirectTo,
	setDeletingPage,
	showToast,
} from '../signals'
import { CancelButton, ModalBackdrop, ModalFooter, ModalHeader } from './modal-shell'

export function DeletePageDialog() {
	const visible = isDeletePageOpen.value
	const state = deletePageState.value

	if (!visible || !state.targetPage) return null

	const handleDelete = useCallback(async () => {
		const cfg = config.value
		const currentState = deletePageState.value
		if (!cfg || !currentState.targetPage) return

		setDeletingPage(true)

		const result = await deletePage(cfg, {
			pagePath: currentState.targetPage.pathname,
			createRedirect: currentState.createRedirect,
			redirectTo: currentState.createRedirect ? currentState.redirectTo : undefined,
		})

		setDeletingPage(false)

		if (result.success) {
			resetDeletePageState()
			showToast('Page deleted', 'success')
			window.location.href = currentState.createRedirect && currentState.redirectTo ? currentState.redirectTo : '/'
		} else {
			showToast(result.error || 'Failed to delete page', 'error')
		}
	}, [])

	return (
		<ModalBackdrop onClose={() => resetDeletePageState()} maxWidth="max-w-md">
			<ModalHeader title="Delete Page" onClose={() => resetDeletePageState()} />

			<div class="p-5 space-y-4">
				<p class="text-white/80">
					Are you sure you want to delete <strong class="text-white">{state.targetPage.title || state.targetPage.pathname}</strong>?
				</p>
				<p class="text-sm text-white/50">
					This will remove the file at{' '}
					<code class="bg-white/10 px-1.5 py-0.5 rounded text-white/70">{state.targetPage.pathname}</code>. This action cannot be undone.
				</p>

				<div class="space-y-3 pt-2">
					<label class="flex items-center gap-2.5 cursor-pointer" data-cms-ui>
						<input
							type="checkbox"
							checked={state.createRedirect}
							onChange={(e) => setDeletePageCreateRedirect((e.target as HTMLInputElement).checked)}
							class="w-4 h-4 rounded accent-cms-primary"
							data-cms-ui
						/>
						<span class="text-sm text-white/70">Create redirect (307) to preserve SEO</span>
					</label>

					{state.createRedirect && (
						<div class="space-y-1.5 pl-6.5">
							<label class="text-sm font-medium text-white/50" data-cms-ui>Redirect to</label>
							<input
								type="text"
								value={state.redirectTo}
								onInput={(e) => setDeletePageRedirectTo((e.target as HTMLInputElement).value)}
								placeholder="/"
								class="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-cms-md text-white placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
								data-cms-ui
							/>
						</div>
					)}
				</div>
			</div>

			<ModalFooter>
				<CancelButton onClick={() => resetDeletePageState()} />
				<button
					type="button"
					onClick={handleDelete}
					disabled={state.isDeleting}
					class="px-5 py-2.5 text-sm font-medium rounded-cms-pill transition-colors cursor-pointer bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
					data-cms-ui
				>
					{state.isDeleting ? 'Deleting...' : 'Delete Page'}
				</button>
			</ModalFooter>
		</ModalBackdrop>
	)
}
