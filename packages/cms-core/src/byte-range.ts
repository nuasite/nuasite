/** An inclusive byte span of a resource, as a `Content-Range: bytes start-end/size` names it. */
export interface ByteRange {
	start: number
	end: number
}

/**
 * Resolve a request's `Range` header against a resource of `size` bytes.
 *
 * A browser plays `<video>` by asking for byte ranges; without a `206` answer it cannot seek, and
 * Safari refuses to play at all. Only a single `bytes=` range is honoured. `null` means "serve the
 * whole resource": no header, a malformed one, or a multi-range request, all of which RFC 9110 lets
 * a server answer with `200`. `'unsatisfiable'` is a well-formed range lying past the end (`416`).
 */
export function resolveByteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
	if (header === null) return null
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (!match) return null
	const [, first = '', last = ''] = match
	if (first === '' && last === '') return null

	if (first === '') {
		const suffix = Number(last)
		if (suffix === 0 || size === 0) return 'unsatisfiable'
		return { start: Math.max(0, size - suffix), end: size - 1 }
	}

	const start = Number(first)
	const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
	if (last !== '' && Number(last) < start) return null
	if (start >= size) return 'unsatisfiable'
	return { start, end }
}
