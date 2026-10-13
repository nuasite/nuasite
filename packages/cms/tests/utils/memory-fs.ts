import { type CmsFileSystem, globToRegExp } from '@nuasite/cms-core'

export interface MemoryFileSystem extends CmsFileSystem {
	/** The files, by root-relative path. */
	readonly files: Map<string, Uint8Array>
}

function normalize(path: string): string {
	return path.split('/').filter(segment => segment !== '' && segment !== '.').join('/')
}

function missing(path: string): Error {
	return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
}

/** A `CmsFileSystem` held in memory, as a host without `node:fs` provides one. */
export function createMemoryFileSystem(initial: Record<string, string> = {}): MemoryFileSystem {
	const encoder = new TextEncoder()
	const files = new Map(Object.entries(initial).map(([path, content]) => [normalize(path), encoder.encode(content)]))
	const mtimes = new Map<string, number>()
	const isDirectory = (dir: string) => dir === '' || [...files.keys()].some(path => path.startsWith(`${dir}/`))
	const write = (path: string, content: Uint8Array) => {
		files.set(normalize(path), content.slice())
		mtimes.set(normalize(path), Date.now())
	}
	const read = (path: string) => {
		const content = files.get(normalize(path))
		if (content === undefined) throw missing(path)
		return content
	}

	return {
		files,
		readFile: async path => new TextDecoder().decode(read(path)),
		readBytes: async path => read(path).slice(),
		writeFile: async (path, content) => write(path, encoder.encode(content)),
		writeBytes: async (path, content) => write(path, content),
		async rename(from, to) {
			write(to, read(from))
			files.delete(normalize(from))
		},
		async remove(path) {
			files.delete(normalize(path))
		},
		exists: async path => files.has(normalize(path)) || isDirectory(normalize(path)),
		async list(rawDir) {
			const dir = normalize(rawDir)
			const entries = new Map<string, boolean>()
			for (const path of files.keys()) {
				if (dir !== '' && !path.startsWith(`${dir}/`)) continue
				const [name, ...deeper] = (dir === '' ? path : path.slice(dir.length + 1)).split('/')
				if (name !== undefined) entries.set(name, deeper.length > 0 || entries.get(name) === true)
			}
			return [...entries].map(([name, isDir]) => ({ name, isDirectory: isDir }))
		},
		async glob(pattern) {
			const matcher = globToRegExp(pattern)
			return [...files.keys()].filter(path => matcher.test(path))
		},
		async stat(path) {
			const content = read(path)
			return { mtimeMs: mtimes.get(normalize(path)) ?? 0, size: content.byteLength }
		},
	}
}
