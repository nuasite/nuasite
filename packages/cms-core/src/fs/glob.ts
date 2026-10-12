/**
 * A directory a glob had to read and could not. Kept apart from every other failure so a
 * caller can report it as a finding and still let a bug (or a path traversal) surface.
 */
export class UnreadableDirectoryError extends Error {
	/** Root-relative, forward slashes; the root itself is `.`. */
	readonly directory: string
	/** The runtime's error code, e.g. `EACCES`. */
	readonly code: string

	constructor(directory: string, code: string, options?: ErrorOptions) {
		super(`Cannot read directory "${directory}" (${code})`, options)
		this.name = 'UnreadableDirectoryError'
		this.directory = directory
		this.code = code
	}
}

/** Convert a glob pattern (supports `*`, `**`, `?`, `{a,b}`) to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
	let re = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!
		if (c === '*') {
			if (glob[i + 1] === '*') {
				re += '.*'
				i++
				if (glob[i + 1] === '/') i++
			} else {
				re += '[^/]*'
			}
		} else if (c === '?') {
			re += '[^/]'
		} else if (c === '{') {
			const end = glob.indexOf('}', i)
			if (end === -1) {
				re += '\\{'
			} else {
				const opts = glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
				re += `(?:${opts.join('|')})`
				i = end
			}
		} else if ('.+^$()|[]\\'.includes(c)) {
			re += `\\${c}`
		} else {
			re += c
		}
	}
	return new RegExp(`^${re}$`)
}

/**
 * Whether `glob` could match a file somewhere below the directory `dir` (both root-relative,
 * forward slashes). Errs on the side of yes: only a directory that no path the pattern
 * matches can run through is ruled out.
 */
export function globMayMatchUnder(glob: string, dir: string): boolean {
	// A brace that spans a slash does not split into segments; do not guess.
	if (/\{[^}]*\//.test(glob)) return true
	const segments = glob.split('/').filter(segment => segment !== '' && segment !== '.')
	const dirs = dir.split('/').filter(segment => segment !== '' && segment !== '.')
	const reaches = (i: number, j: number): boolean => {
		// Inside `dir`: the pattern has to have a segment left for a file below it.
		if (j === dirs.length) return i < segments.length
		if (i >= segments.length) return false
		// `**` runs through any number of directories.
		if (segments[i]!.includes('**')) return true
		return globToRegExp(segments[i]!).test(dirs[j]!) && reaches(i + 1, j + 1)
	}
	return reaches(0, 0)
}
