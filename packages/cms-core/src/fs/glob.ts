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
