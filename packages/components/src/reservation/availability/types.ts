export type ReservationAvailabilityProps =
	& {
		loadingMessage?: string
		errorMessage?: string
		pollInterval?: number
	}
	& (
		| { reservationId: string; action?: string }
		| { reservationId?: string; action: string }
	)
