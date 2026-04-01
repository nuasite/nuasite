import { useCallback, useEffect, useState } from 'preact/hooks'
import { addRedirect, deleteRedirect, getRedirects, updateRedirect } from '../markdown-api'
import {
	closeRedirectsManager,
	config,
	isRedirectsManagerOpen,
	redirectsManagerState,
	setRedirectsManagerEditing,
	setRedirectsManagerRules,
	showToast,
} from '../signals'
import type { RedirectRule } from '../types'
import { ModalBackdrop, ModalHeader } from './modal-shell'

export function RedirectsManager() {
	const visible = isRedirectsManagerOpen.value
	const state = redirectsManagerState.value

	useLoadRedirects()

	if (!visible) return null

	return (
		<ModalBackdrop onClose={() => closeRedirectsManager()} maxWidth="max-w-2xl" extraClass="max-h-[80vh] flex flex-col">
			<ModalHeader title="Redirects" onClose={() => closeRedirectsManager()} />

			<div class="flex-1 overflow-y-auto p-5 space-y-3">
				{state.isLoading && <div class="text-center py-8 text-white/50">Loading redirects...</div>}

				{!state.isLoading && state.rules.length === 0 && (
					<div class="text-center py-8">
						<p class="text-white/50 mb-2">No redirects configured</p>
						<p class="text-white/30 text-sm">Redirects are stored in src/_redirects</p>
					</div>
				)}

				{!state.isLoading && state.rules.map((rule) => (
					<RedirectRow
						key={rule.lineIndex}
						rule={rule}
						isEditing={state.editingIndex === rule.lineIndex}
					/>
				))}
			</div>

			<div class="shrink-0 p-5 border-t border-white/10 bg-white/5 rounded-b-cms-xl">
				<AddRedirectForm />
			</div>
		</ModalBackdrop>
	)
}

function RedirectRow({ rule, isEditing }: { rule: RedirectRule; isEditing: boolean }) {
	const [source, setSource] = useState(rule.source)
	const [destination, setDestination] = useState(rule.destination)
	const [statusCode, setStatusCode] = useState(String(rule.statusCode))
	const [isSaving, setIsSaving] = useState(false)

	const handleSave = useCallback(async () => {
		const cfg = config.value
		if (!cfg) return

		setIsSaving(true)
		const result = await updateRedirect(cfg, {
			lineIndex: rule.lineIndex,
			source,
			destination,
			statusCode: parseInt(statusCode, 10) || 307,
		})
		setIsSaving(false)

		if (result.success) {
			setRedirectsManagerEditing(null)
			await refreshRedirects()
			showToast('Redirect updated', 'success')
		} else {
			showToast(result.error || 'Failed to update', 'error')
		}
	}, [rule.lineIndex, source, destination, statusCode])

	const handleDelete = useCallback(async () => {
		const cfg = config.value
		if (!cfg) return

		const result = await deleteRedirect(cfg, { lineIndex: rule.lineIndex })
		if (result.success) {
			await refreshRedirects()
			showToast('Redirect deleted', 'success')
		} else {
			showToast(result.error || 'Failed to delete', 'error')
		}
	}, [rule.lineIndex])

	if (isEditing) {
		return (
			<div class="flex flex-col gap-2 p-3 bg-white/5 rounded-cms-lg border border-white/10">
				<div class="flex gap-2">
					<input
						type="text"
						value={source}
						onInput={(e) => setSource((e.target as HTMLInputElement).value)}
						class="flex-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-cms-md text-white text-sm focus:outline-none focus:border-cms-primary/50"
						placeholder="/old-path"
						data-cms-ui
					/>
					<span class="text-white/30 self-center">→</span>
					<input
						type="text"
						value={destination}
						onInput={(e) => setDestination((e.target as HTMLInputElement).value)}
						class="flex-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-cms-md text-white text-sm focus:outline-none focus:border-cms-primary/50"
						placeholder="/new-path"
						data-cms-ui
					/>
					<input
						type="text"
						value={statusCode}
						onInput={(e) => setStatusCode((e.target as HTMLInputElement).value)}
						class="w-16 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-cms-md text-white text-sm text-center focus:outline-none focus:border-cms-primary/50"
						placeholder="307"
						data-cms-ui
					/>
				</div>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onClick={() => setRedirectsManagerEditing(null)}
						class="px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded-cms-md transition-colors cursor-pointer"
						data-cms-ui
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={isSaving}
						class="px-3 py-1.5 text-xs font-medium bg-cms-primary text-cms-primary-text rounded-cms-md hover:bg-cms-primary-hover transition-colors cursor-pointer disabled:opacity-40"
						data-cms-ui
					>
						{isSaving ? 'Saving...' : 'Save'}
					</button>
				</div>
			</div>
		)
	}

	return (
		<div class="flex items-center gap-3 p-3 bg-white/5 rounded-cms-lg border border-white/10 group">
			<div class="flex-1 min-w-0 flex items-center gap-2 text-sm">
				<span class="text-white/80 truncate">{rule.source}</span>
				<span class="text-white/30 shrink-0">→</span>
				<span class="text-white/60 truncate">{rule.destination}</span>
			</div>
			<span class="text-xs text-white/30 tabular-nums shrink-0">{rule.statusCode}</span>
			<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
				<button
					type="button"
					onClick={() => setRedirectsManagerEditing(rule.lineIndex)}
					class="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
					title="Edit"
					data-cms-ui
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
						/>
					</svg>
				</button>
				<button
					type="button"
					onClick={handleDelete}
					class="p-1.5 text-white/40 hover:text-red-400 hover:bg-white/10 rounded transition-colors cursor-pointer"
					title="Delete"
					data-cms-ui
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
				</button>
			</div>
		</div>
	)
}

function AddRedirectForm() {
	const [source, setSource] = useState('')
	const [destination, setDestination] = useState('')
	const [isAdding, setIsAdding] = useState(false)

	const handleAdd = useCallback(async () => {
		const cfg = config.value
		if (!cfg || !source.trim() || !destination.trim()) return

		setIsAdding(true)
		const result = await addRedirect(cfg, {
			source: source.trim(),
			destination: destination.trim(),
			statusCode: 307,
		})
		setIsAdding(false)

		if (result.success) {
			setSource('')
			setDestination('')
			await refreshRedirects()
			showToast('Redirect added', 'success')
		} else {
			showToast(result.error || 'Failed to add redirect', 'error')
		}
	}, [source, destination])

	return (
		<div class="flex gap-2 items-end">
			<div class="flex-1 space-y-1">
				<label class="text-xs text-white/40" data-cms-ui>From</label>
				<input
					type="text"
					value={source}
					onInput={(e) => setSource((e.target as HTMLInputElement).value)}
					placeholder="/old-path"
					class="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-cms-md text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
					data-cms-ui
				/>
			</div>
			<div class="flex-1 space-y-1">
				<label class="text-xs text-white/40" data-cms-ui>To</label>
				<input
					type="text"
					value={destination}
					onInput={(e) => setDestination((e.target as HTMLInputElement).value)}
					placeholder="/new-path"
					class="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-cms-md text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-cms-primary/50"
					data-cms-ui
				/>
			</div>
			<button
				type="button"
				onClick={handleAdd}
				disabled={isAdding || !source.trim() || !destination.trim()}
				class="px-4 py-1.5 text-sm font-medium bg-cms-primary text-cms-primary-text rounded-cms-md hover:bg-cms-primary-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
				data-cms-ui
			>
				{isAdding ? 'Adding...' : 'Add'}
			</button>
		</div>
	)
}

async function refreshRedirects(): Promise<void> {
	const cfg = config.value
	if (!cfg) return
	const result = await getRedirects(cfg)
	setRedirectsManagerRules(result.rules)
}

export function useLoadRedirects() {
	const isOpen = isRedirectsManagerOpen.value
	useEffect(() => {
		if (isOpen) refreshRedirects()
	}, [isOpen])
}
