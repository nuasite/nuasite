import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { globToRegExp } from './glob'
import type { CmsFileSystem } from './types'

/**
 * Resolve a port-relative (or absolute) path against `root` and ensure it stays
 * within `root`. Mirrors the previous `resolveAndValidatePath` behavior:
 * - absolute filesystem paths under the root pass through;
 * - a project-relative path with a leading slash (e.g. `/src/content/...`) has
 *   it stripped before joining with the root;
 * - any path that escapes the root throws.
 */
function resolveWithinRoot(root: string, filePath: string): string {
	const resolvedRoot = path.resolve(root)
	const isAbsoluteFs = filePath.startsWith(resolvedRoot)
	const normalizedPath = (!isAbsoluteFs && filePath.startsWith('/')) ? filePath.slice(1) : filePath
	const fullPath = path.isAbsolute(normalizedPath) ? path.resolve(normalizedPath) : path.resolve(resolvedRoot, normalizedPath)

	if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
		throw new Error(`Path traversal detected: ${filePath}`)
	}

	return fullPath
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error
}

/** Recursively list files under `absDir`, returning forward-slash paths relative to `absRoot`. */
async function walkFiles(absRoot: string, absDir: string): Promise<string[]> {
	let dirEntries: Dirent[]
	try {
		dirEntries = await fs.readdir(absDir, { withFileTypes: true })
	} catch {
		return []
	}
	const out: string[] = []
	for (const entry of dirEntries) {
		const abs = path.join(absDir, entry.name)
		if (entry.isDirectory()) {
			out.push(...await walkFiles(absRoot, abs))
		} else if (entry.isFile()) {
			out.push(path.relative(absRoot, abs).split(path.sep).join('/'))
		}
	}
	return out
}

/** The longest leading directory of a glob pattern that contains no glob metacharacters. */
function staticPrefixDir(pattern: string): string {
	const segments = pattern.split('/')
	const staticSegments: string[] = []
	for (const segment of segments) {
		if (/[*?{}[\]]/.test(segment)) break
		staticSegments.push(segment)
	}
	// Drop the last segment if it is the (potentially globbed) file part: a static prefix
	// must be a directory, so only keep segments that precede the first globbed segment.
	if (staticSegments.length === segments.length) {
		staticSegments.pop()
	}
	return staticSegments.join('/')
}

/**
 * Create a `CmsFileSystem` backed by `node:fs`, rooted at `root`.
 * Every path is resolved relative to `root` and validated to stay within it.
 */
export function createNodeFs(root: string): CmsFileSystem {
	const resolvedRoot = path.resolve(root)
	const resolve = (p: string) => resolveWithinRoot(resolvedRoot, p)

	return {
		async readFile(filePath) {
			return fs.readFile(resolve(filePath), 'utf-8')
		},

		async readBytes(filePath) {
			return fs.readFile(resolve(filePath))
		},

		async writeFile(filePath, content) {
			const fullPath = resolve(filePath)
			await fs.mkdir(path.dirname(fullPath), { recursive: true })
			// Atomic write: write to a unique temp file in the same directory, then rename.
			// A killed write leaves only the temp file, never a half-written target.
			const tempPath = `${fullPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
			try {
				await fs.writeFile(tempPath, content, 'utf-8')
				await fs.rename(tempPath, fullPath)
			} catch (error) {
				await fs.rm(tempPath, { force: true })
				throw error
			}
		},

		async rename(from, to) {
			const fullTo = resolve(to)
			await fs.mkdir(path.dirname(fullTo), { recursive: true })
			await fs.rename(resolve(from), fullTo)
		},

		async remove(filePath) {
			await fs.rm(resolve(filePath), { force: true })
		},

		async exists(filePath) {
			try {
				await fs.access(resolve(filePath))
				return true
			} catch {
				return false
			}
		},

		async list(dir) {
			try {
				const entries = await fs.readdir(resolve(dir), { withFileTypes: true })
				return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
			} catch (error) {
				if (isNodeError(error) && error.code === 'ENOENT') return []
				throw error
			}
		},

		async glob(pattern) {
			const baseRel = staticPrefixDir(pattern)
			const absBase = resolve(baseRel)
			const matcher = globToRegExp(pattern)
			const files = await walkFiles(resolvedRoot, absBase)
			return files.filter(rel => matcher.test(rel))
		},

		async stat(filePath) {
			const s = await fs.stat(resolve(filePath))
			return { mtimeMs: s.mtimeMs, size: s.size }
		},
	}
}
