import { useCallback, useEffect, useState } from 'preact/hooks'
import { TIMING } from '../../constants'
import type { ToastMessage } from './types'

interface ToastProps extends ToastMessage {
	onRemove: (id: string) => void
}

export const Toast = ({ id, message, type, onRemove }: ToastProps) => {
	const [isVisible, setIsVisible] = useState(true)
	const persistent = type === 'error'

	const dismiss = useCallback(() => {
		setIsVisible(false)
		setTimeout(() => onRemove(id), TIMING.TOAST_FADE_DURATION_MS)
	}, [id, onRemove])

	useEffect(() => {
		if (persistent) return

		const hideTimer = setTimeout(() => {
			setIsVisible(false)
		}, TIMING.TOAST_VISIBLE_DURATION_MS)

		const removeTimer = setTimeout(() => {
			onRemove(id)
		}, TIMING.TOAST_VISIBLE_DURATION_MS + TIMING.TOAST_FADE_DURATION_MS)

		return () => {
			clearTimeout(hideTimer)
			clearTimeout(removeTimer)
		}
	}, [id, onRemove, persistent])

	const typeClasses = {
		error: 'bg-cms-dark border-l-4 border-l-cms-error text-white',
		success: 'bg-cms-dark border-l-4 border-l-cms-primary text-white',
		info: 'bg-cms-dark border-l-4 border-l-white/50 text-white',
	}

	return (
		<div
			class={`
        px-3.5 py-2.5 font-sans text-[13px] font-medium
        shadow-[0_8px_32px_rgba(0,0,0,0.25)] border border-white/10 rounded-cms
        transition-all duration-300 ease-out flex items-center gap-3
        ${typeClasses[type]}
        ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'}
      `}
		>
			{type === 'success' && <span class="text-cms-primary text-lg">✓</span>}
			{type === 'error' && <span class="text-cms-error text-lg">✕</span>}
			{type === 'info' && <span class="w-2.5 h-2.5 rounded-full bg-white/50 shrink-0" />}
			{message}
			{persistent && (
				<button
					onClick={dismiss}
					class="ml-1 text-white/60 hover:text-white transition-colors text-lg leading-none cursor-pointer"
					aria-label="Dismiss"
				>
					✕
				</button>
			)}
		</div>
	)
}
