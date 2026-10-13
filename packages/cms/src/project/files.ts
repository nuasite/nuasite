import type { CmsFileSystem } from '@nuasite/cms-core'
import path from 'node:path'

export interface ProjectDirEntry {
	name: string
	isDirectory(): boolean
	isFile(): boolean
}

export interface ProjectFileStat {
	isDirectory(): boolean
	isFile(): boolean
	mtimeMs: number
}

/**
 * The file access of the visual editor's source lookup and source writers. Paths are absolute
 * (under the project root) or relative to the project root, as the editor has always spelled them.
 * Reads reject when the path does not exist, like `node:fs`.
 */
export interface ProjectFiles {
	readFile(filePath: string): Promise<string>
	readBytes(filePath: string): Promise<Uint8Array>
	/** Creates the parent directories. */
	writeFile(filePath: string, content: string | Uint8Array): Promise<void>
	readdir(dirPath: string): Promise<ProjectDirEntry[]>
	/** Resolves when the path exists. */
	access(filePath: string): Promise<void>
	stat(filePath: string): Promise<ProjectFileStat>
}

function notFound(filePath: string): Error {
	return Object.assign(new Error(`ENOENT: no such file or directory, '${filePath}'`), { code: 'ENOENT' })
}

/**
 * `ProjectFiles` over a `CmsFileSystem` rooted at `root`. A path outside `root` is refused the
 * way the port refuses one: nothing outside the project is read or written.
 */
export function createProjectFiles(fs: CmsFileSystem, root: string): ProjectFiles {
	const relative = (filePath: string): string => {
		const absolute = path.resolve(root, filePath.startsWith(root) ? filePath : filePath.replace(/^\/+/, ''))
		const rel = path.relative(root, absolute)
		if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path outside the project: ${filePath}`)
		return rel.split(path.sep).join('/')
	}

	async function entryOf(rel: string): Promise<{ isDirectory: boolean } | undefined> {
		if (rel === '') return { isDirectory: true }
		const name = path.posix.basename(rel)
		return (await fs.list(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel))).find(entry => entry.name === name)
	}

	return {
		readFile: async filePath => fs.readFile(relative(filePath)),
		readBytes: async filePath => fs.readBytes(relative(filePath)),
		async writeFile(filePath, content) {
			const rel = relative(filePath)
			if (typeof content === 'string') await fs.writeFile(rel, content)
			else await fs.writeBytes(rel, content)
		},
		async readdir(dirPath) {
			const rel = relative(dirPath)
			const entry = await entryOf(rel)
			if (!entry?.isDirectory) throw notFound(dirPath)
			return (await fs.list(rel)).map(({ name, isDirectory }) => ({ name, isDirectory: () => isDirectory, isFile: () => !isDirectory }))
		},
		async access(filePath) {
			if (!(await fs.exists(relative(filePath)))) throw notFound(filePath)
		},
		async stat(filePath) {
			const rel = relative(filePath)
			const entry = await entryOf(rel)
			if (!entry) throw notFound(filePath)
			const mtimeMs = entry.isDirectory ? 0 : (await fs.stat(rel)).mtimeMs
			return { isDirectory: () => entry.isDirectory, isFile: () => !entry.isDirectory, mtimeMs }
		},
	}
}
