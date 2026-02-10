import { cn } from '../lib/cn'
import { confirmDialogState } from '../signals'

export function ConfirmDialog() {
	const state = confirmDialogState.value

	if (!state.isOpen) return null

	const handleConfirm = () => {
		state.onConfirm?.()
	}

	const handleCancel = () => {
		state.onCancel?.()
	}

	const handleBackdropClick = () => {
		handleCancel()
	}

	return (
		<div
			class="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={handleBackdropClick}
			data-cms-ui
		>
			<div
				class="bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] max-w-sm w-full border border-white/10 mx-4"
				onClick={(e) => e.stopPropagation()}
				data-cms-ui
			>
				{/* Header */}
				<div class="p-5 pb-3">
					<h2 class="text-lg font-semibold text-white">{state.title}</h2>
				</div>

				{/* Body */}
				<div class="px-5 pb-5">
					<p class="text-sm text-white/70 leading-relaxed">{state.message}</p>
				</div>

				{/* Footer */}
				<div class="flex items-center justify-end gap-3 p-5 pt-4 border-t border-white/10 bg-white/5 rounded-b-cms-xl">
					<button
						type="button"
						onClick={handleCancel}
						class="px-4 py-2.5 text-sm text-white/80 font-medium rounded-cms-pill hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
						data-cms-ui
					>
						{state.cancelLabel}
					</button>
					<button
						type="button"
						onClick={handleConfirm}
						class={cn(
							'px-5 py-2.5 rounded-cms-pill text-sm font-medium transition-colors cursor-pointer',
							state.variant === 'danger' && 'bg-cms-error text-white hover:bg-red-600',
							state.variant === 'warning' && 'bg-amber-500 text-white hover:bg-amber-600',
							state.variant === 'info' && 'bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover',
						)}
						data-cms-ui
					>
						{state.confirmLabel}
					</button>
				</div>
			</div>
		</div>
	)
}
