export type ReservationStatusProps =
	& {
		loadingMessage?: string
		errorMessage?: string
		missingBookingMessage?: string
		notFoundMessage?: string
	}
	& (
		| { reservationId: string; action?: string }
		| { reservationId?: string; action: string }
	)
