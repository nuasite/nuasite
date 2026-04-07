import type { ComponentChildren } from 'preact'
import { Z_INDEX } from '../constants'

export function ModalBackdrop({ onClose, maxWidth = 'max-w-lg', extraClass, children }: {
	onClose: () => void
	maxWidth?: string
	extraClass?: string
	children: ComponentChildren
}) {
	return (
		<div
			style={{ zIndex: Z_INDEX.MODAL }}
			class="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onClose}
			data-cms-ui
		>
			<div
				class={`bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${maxWidth} w-full border border-white/10 ${extraClass ?? ''}`}
				onClick={(e) => e.stopPropagation()}
				data-cms-ui
			>
				{children}
			</div>
		</div>
	)
}

export function ModalHeader({ title, onBack, onClose }: {
	title: string
	onBack?: () => void
	onClose: () => void
}) {
	return (
		<div class="flex items-center gap-3 p-5 border-b border-white/10">
			{onBack && (
				<button
					type="button"
					onClick={onBack}
					class="text-white/50 hover:text-white p-1.5 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
					data-cms-ui
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
					</svg>
				</button>
			)}
			<h2 class="text-lg font-semibold text-white flex-1 truncate">{title}</h2>
			<CloseButton onClick={onClose} />
		</div>
	)
}

export function ModalFooter({ children }: { children: ComponentChildren }) {
	return (
		<div class="flex items-center justify-end gap-2 p-5 border-t border-white/10 bg-white/5 rounded-b-cms-xl">
			{children}
		</div>
	)
}

export function CloseButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			class="text-white/50 hover:text-white p-1.5 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
			data-cms-ui
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	)
}

export function CancelButton({ onClick, label = 'Cancel' }: { onClick: () => void; label?: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			class="px-4 py-2.5 text-sm text-white/80 font-medium rounded-cms-pill hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
			data-cms-ui
		>
			{label}
		</button>
	)
}
