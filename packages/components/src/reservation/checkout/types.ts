export type ReservationCheckoutProps =
	& {
		submittingMessage?: string
		errorMessage?: string
		unavailableMessage?: string
	}
	& (
		| { reservationId: string; action?: string }
		| { reservationId?: string; action: string }
	)
