import type { ComponentChildren } from 'preact'
import { Z_INDEX } from '../constants'
import { cn } from '../lib/cn'

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
				class={cn('bg-cms-dark rounded-cms-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] w-full border border-white/10', maxWidth, extraClass)}
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
		<div class="flex items-center gap-3 px-5 py-4 border-b border-white/10">
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
		<div class="flex items-center justify-end gap-2 py-3.5 px-4 border-t border-white/10 bg-white/5 rounded-b-cms-xl">
			{children}
		</div>
	)
}

export function Section({ title, children, className }: {
	title: string
	children: ComponentChildren
	className?: string
}) {
	return (
		<div class={cn('space-y-4', className)}>
			<h3 class="text-base font-semibold text-white/90">{title}</h3>
			{children}
		</div>
	)
}

export function CloseButton({ onClick, size = 'md' }: { onClick: () => void; size?: 'sm' | 'md' }) {
	return (
		<button
			type="button"
			onClick={onClick}
			class="text-white/50 hover:text-white p-1.5 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
			data-cms-ui
		>
			<svg class={size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>
	)
}

export function CancelButton({ onClick, label = 'Cancel', className }: { onClick: () => void; label?: string; className?: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			class={cn(
				'py-2.5 px-3.5 text-sm text-white/80 font-medium rounded-cms-pill hover:bg-white/10 hover:text-white transition-colors cursor-pointer',
				className,
			)}
			data-cms-ui
		>
			{label}
		</button>
	)
}

export function PrimaryButton({ onClick, children, disabled, type = 'button', className }: {
	onClick?: () => void
	children: ComponentChildren
	disabled?: boolean
	type?: 'button' | 'submit'
	className?: string
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled}
			class={cn(
				'px-5 py-2.5 text-sm font-medium rounded-cms-pill transition-colors cursor-pointer',
				'bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover',
				'disabled:opacity-40 disabled:cursor-not-allowed',
				className,
			)}
			data-cms-ui
		>
			{children}
		</button>
	)
}
