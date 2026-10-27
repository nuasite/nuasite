import { cn } from '../lib/cn.ts'
import { confirmDialogState } from '../signals.ts'
import { CancelButton, ModalBackdrop, ModalFooter } from './modal-shell.tsx'

export function ConfirmDialog() {
	const state = confirmDialogState.value

	if (!state.isOpen) return null

	const handleConfirm = () => {
		state.onConfirm?.()
	}

	const handleCancel = () => {
		state.onCancel?.()
	}

	return (
		<ModalBackdrop onClose={handleCancel} maxWidth="max-w-sm" extraClass="mx-4">
			{/* Header */}
			<div class="p-5 pb-3">
				<h2 class="text-lg font-semibold text-white">{state.title}</h2>
			</div>

			{/* Body */}
			<div class="px-5 pb-5">
				<p class="text-sm text-white/70 leading-relaxed">{state.message}</p>
			</div>

			<ModalFooter>
				<CancelButton onClick={handleCancel} label={state.cancelLabel} />
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
			</ModalFooter>
		</ModalBackdrop>
	)
}
