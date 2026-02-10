import { Toast } from './toast'
import type { ToastMessage } from './types'

export interface ToastContainerProps {
	toasts: ToastMessage[]
	onRemove: (id: string) => void
}

export const ToastContainer = ({ toasts, onRemove }: ToastContainerProps) => {
	return (
		<div class="fixed left-1/2 -translate-x-1/2 bottom-28 z-2147483648 flex flex-col gap-2 items-center">
			{toasts.map(toast => <Toast key={toast.id} {...toast} onRemove={onRemove} />)}
		</div>
	)
}
