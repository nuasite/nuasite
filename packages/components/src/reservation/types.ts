export interface ReservationTimeSlot {
	id: string
	startTime: string
	endTime: string
	available: boolean
	remainingCapacity?: number
}

export interface ReservationProduct {
	id: string
	name: string
	description?: string
	price: number
	currency: string
	timeSlots?: ReservationTimeSlot[]
}

export interface ReservationError {
	error: string
	code?: string
}
