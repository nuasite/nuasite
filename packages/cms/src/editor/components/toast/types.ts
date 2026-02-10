export type ToastType = 'info' | 'success' | 'error'

export interface ToastMessage {
	id: string
	message: string
	type: ToastType
}
