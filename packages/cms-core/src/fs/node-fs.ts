import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { globMayMatchUnder, globToRegExp, UnreadableDirectoryError } from './glob'
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

/** What one walk is after, and how far it may go. */
interface Walk {
	absRoot: string
	/** Whether a directory (root-relative) could hold anything the caller is after. */
	mayHold: (dir: string) => boolean
	/** Directories (root-relative) the caller does not want walked at all. */
	skip: (dir: string) => boolean
	/** Enter linked directories and list linked files, which the walk otherwise leaves out. */
	followSymlinks: boolean
	/** The root's own real path, which every linked directory entered has to stay under. */
	realRoot: string
	/** How many directories may be read behind links, and how many of those are left; `undefined` for as many as there are. */
	maxLinkedDirectories: number | undefined
	linkedDirectoriesLeft: number | undefined
}

/** Is `abs` the directory `root` or below it? Both are real paths. */
const isWithin = (root: string, abs: string): boolean => abs === root || abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep)

const relativeTo = (absRoot: string, abs: string): string => path.relative(absRoot, abs).split(path.sep).join('/') || '.'

/**
 * Recursively list files under `absDir`, returning forward-slash paths relative to the root.
 * A directory that cannot hold anything the caller is after is not entered at all.
 *
 * `linked` holds the real paths of the linked directories on the way down, so that a link
 * back into one of them is entered once and not again.
 */
async function walkFiles(walk: Walk, absDir: string, linked: ReadonlySet<string>): Promise<string[]> {
	// The tree itself is as large as it is. What links add to it has no such bound: they can
	// lead anywhere, and into each other.
	if (linked.size > 0 && walk.linkedDirectoriesLeft !== undefined && walk.linkedDirectoriesLeft-- <= 0) {
		throw new Error(`More than ${walk.maxLinkedDirectories} directories to list behind symbolic links`)
	}
	let dirEntries: Dirent[]
	try {
		dirEntries = await fs.readdir(absDir, { withFileTypes: true })
	} catch (error) {
		// Only a directory that is not there is an empty one. One that cannot be read
		// (EACCES) must not pass for it: the caller would take its files for absent.
		if (!isNodeError(error)) throw error
		if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
		// Named by its root-relative path: the runtime's own message spells out the absolute one.
		throw new UnreadableDirectoryError(relativeTo(walk.absRoot, absDir), error.code ?? 'unknown error', { cause: error })
	}
	const out: string[] = []
	for (const entry of dirEntries) {
		const abs = path.join(absDir, entry.name)
		let isDirectory = entry.isDirectory()
		let isFile = entry.isFile()
		let within = linked
		let real: string | null = null
		if (walk.followSymlinks && entry.isSymbolicLink()) {
			// A link that leads nowhere is not a file anyone loads.
			const target = await fs.stat(abs).catch(() => null)
			// Without a real path the link is entered as it is: a directory that cannot be read
			// then fails the walk, as it would unlinked.
			real = target?.isDirectory() ? await fs.realpath(abs).catch(() => abs) : null
			isFile = target?.isFile() ?? false
			isDirectory = real !== null && !linked.has(real)
			if (real !== null) within = new Set([...linked, real])
		}
		if (isDirectory) {
			// Not walked, so not read either: whatever is in there the caller would discard.
			if (walk.skip(relativeTo(walk.absRoot, abs))) continue
			// Nothing the caller wants can be in a directory its pattern cannot reach, so it is
			// neither read nor, when it cannot be read, a reason to fail.
			if (!walk.mayHold(relativeTo(walk.absRoot, abs))) continue
			// A link out of the project leads into a tree nobody vouched for (the host's own
			// files, on a hosted checkout), so it is not walked. Nor is it skipped: the listing
			// would then pass for whole.
			if (real !== null && !isWithin(walk.realRoot, real)) {
				throw new Error(`Symbolic link "${relativeTo(walk.absRoot, abs)}" leads out of the project root`)
			}
			out.push(...await walkFiles(walk, abs, within))
		} else if (isFile) {
			out.push(relativeTo(walk.absRoot, abs))
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

/** Write to a unique temp file in the same directory, then rename: a killed write leaves only the temp file, never a half-written target. */
async function writeAtomically(fullPath: string, content: string | Uint8Array): Promise<void> {
	await fs.mkdir(path.dirname(fullPath), { recursive: true })
	const tempPath = `${fullPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
	try {
		await fs.writeFile(tempPath, content)
		await fs.rename(tempPath, fullPath)
	} catch (error) {
		await fs.rm(tempPath, { force: true })
		throw error
	}
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
			await writeAtomically(resolve(filePath), content)
		},

		async writeBytes(filePath, content) {
			await writeAtomically(resolve(filePath), content)
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

		async glob(pattern, options) {
			const baseRel = staticPrefixDir(pattern)
			const absBase = resolve(baseRel)
			const matcher = globToRegExp(pattern)
			const followSymlinks = options?.followSymlinks ?? false
			const walk: Walk = {
				absRoot: resolvedRoot,
				mayHold: dir => globMayMatchUnder(pattern, dir),
				skip: options?.skipDirectory ?? (() => false),
				followSymlinks,
				// The root may itself sit behind a link (a temporary directory on macOS does).
				realRoot: followSymlinks ? await fs.realpath(resolvedRoot).catch(() => resolvedRoot) : resolvedRoot,
				maxLinkedDirectories: options?.maxLinkedDirectories,
				linkedDirectoriesLeft: options?.maxLinkedDirectories,
			}
			// Asked of the starting directory as of any other, so that one the pattern cannot match
			// under is not read, and not a reason to fail when it cannot be.
			if (!walk.mayHold(relativeTo(resolvedRoot, absBase))) return []
			const files = await walkFiles(walk, absBase, new Set())
			return files.filter(rel => matcher.test(rel))
		},

		async stat(filePath) {
			const s = await fs.stat(resolve(filePath))
			return { mtimeMs: s.mtimeMs, size: s.size }
		},
	}
}
