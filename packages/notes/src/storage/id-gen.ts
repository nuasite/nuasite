/**
 * ID generators for notes and replies.
 *
 * Format: `n-YYYY-MM-DD-xxxxxx` for items and `r-YYYY-MM-DD-xxxxxx` for replies.
 * The date prefix makes JSON files trivially scannable in a text editor; the
 * 6-character random suffix is enough for collision-free local-first usage.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function todayIsoDate(now: Date = new Date()): string {
	const y = now.getUTCFullYear()
	const m = String(now.getUTCMonth() + 1).padStart(2, '0')
	const d = String(now.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function randomSuffix(length = 6): string {
	let out = ''
	for (let i = 0; i < length; i++) {
		out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
	}
	return out
}

export function generateNoteId(now: Date = new Date()): string {
	return `n-${todayIsoDate(now)}-${randomSuffix()}`
}

export function generateReplyId(now: Date = new Date()): string {
	return `r-${todayIsoDate(now)}-${randomSuffix()}`
}
