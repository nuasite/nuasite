/**
 * Whether a `/`-separated name holds a `.` or `..` segment as it is spelled. These are
 * the segments a path resolves away.
 */
export function hasDotSegment(value: string): boolean {
	return value.split('/').some((s) => s === '.' || s === '..')
}

/**
 * Whether a folder a caller asks to create or upload into would turn into something
 * else once it is part of a URL. A URL parser reads a segment spelled `%2e`, `.%2e`,
 * `%2e.` or `%2e%2e` (in any case) as `.` or `..`, and a backslash as `/`, so the URL
 * built for a file in such a folder would address a different path than the one the
 * file was stored at. Literal `.` and `..` segments count too.
 *
 * Only new folders are held to this: an id or folder that already exists in storage is
 * still listed and deleted as it is spelled.
 */
export function isUnsafeFolder(folder: string): boolean {
	return folder.includes('\\') || folder.split('/').some((s) => {
		const decoded = s.replace(/%2e/gi, '.')
		return decoded === '.' || decoded === '..'
	})
}
