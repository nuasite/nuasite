import { createHash } from 'node:crypto'
import { globToRegExp } from './glob.ts'
import type { CmsFileSystem } from './types.ts'

/**
 * Compare-and-commit for CMS mutations.
 *
 * A mutation runs over a staged view of the filesystem: reads go to the real filesystem and
 * record what they saw, writes and removals stay in memory. When the mutation is done, its
 * changeset goes to a commit function that applies the changes only if every file the mutation
 * looked at is still as it saw it. A host whose files can also change by other means (an agent
 * editing the same checkout) implements that commit atomically, so a CMS write never overwrites
 * a change it did not see.
 */

/** What a mutation saw of a path. */
export type CmsFileVersion =
	| { kind: 'absent' }
	/** It existed. Recorded by `exists`/`stat`, which do not read the content. */
	| { kind: 'present' }
	/** Its bytes, as {@link digestBytes} gives them. */
	| { kind: 'content'; digest: string }

export type CmsStagedChange = { kind: 'write'; path: string; content: Uint8Array } | { kind: 'remove'; path: string }

export interface CmsChangeset {
	/** Each path the mutation read, tested or changed, with the version it first saw. Paths are root-relative, without a leading slash. */
	readonly reads: ReadonlyMap<string, CmsFileVersion>
	/** The final state of each changed path, in the order the paths were first changed. A rename is a removal plus a write. */
	readonly changes: readonly CmsStagedChange[]
}

/**
 * Applies a changeset when every path in `reads` still has the recorded version, and applies
 * nothing otherwise, rejecting with {@link CmsCommitConflictError}. The check and the writes must
 * not interleave with other writes to the same files.
 */
export type CmsCommit = (changeset: CmsChangeset) => Promise<void>

export class CmsCommitConflictError extends Error {
	readonly paths: readonly string[]

	constructor(paths: readonly string[]) {
		super(`Changed since the edit read them: ${paths.join(', ')}`)
		this.paths = paths
		this.name = 'CmsCommitConflictError'
	}
}

/** `sha256:<hex>` of the bytes; for UTF-8 text, the same value the sidecar reports as a source hash. */
export function digestBytes(content: Uint8Array): string {
	return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export interface StagedFileSystem extends CmsFileSystem {
	changeset(): CmsChangeset
}

/** Root-relative, no leading slash, no `.` segments: one spelling per file, so a staged write is found again. */
function normalize(path: string): string {
	const segments: string[] = []
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.') continue
		if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') segments.pop()
		else segments.push(segment)
	}
	return segments.join('/')
}

function isBelow(path: string, dir: string): boolean {
	return dir === '' || path.startsWith(`${dir}/`)
}

function missing(path: string): Error {
	return Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: 'ENOENT' })
}

export function createStagedFileSystem(base: CmsFileSystem): StagedFileSystem {
	const reads = new Map<string, CmsFileVersion>()
	const staged = new Map<string, { content: Uint8Array; mtimeMs: number } | null>()
	const encoder = new TextEncoder()
	const decoder = new TextDecoder()

	/** Keeps the first version seen, except that content read later sharpens a bare `present`. */
	function observe(path: string, version: CmsFileVersion): void {
		const recorded = reads.get(path)
		if (recorded === undefined || (recorded.kind === 'present' && version.kind === 'content')) reads.set(path, version)
	}

	/** A path changed without its content read first is fenced on its content from the moment it is changed. */
	async function observeBeforeChange(path: string): Promise<void> {
		if (staged.has(path)) return
		const recorded = reads.get(path)
		if (recorded !== undefined && recorded.kind !== 'present') return
		observe(path, await versionOf(base, path))
	}

	async function readBytes(rawPath: string): Promise<Uint8Array> {
		const path = normalize(rawPath)
		const change = staged.get(path)
		if (change === null) throw missing(path)
		if (change !== undefined) return change.content.slice()
		try {
			const content = await base.readBytes(path)
			observe(path, { kind: 'content', digest: digestBytes(content) })
			return content
		} catch (error) {
			if (!(await base.exists(path))) observe(path, { kind: 'absent' })
			throw error
		}
	}

	async function write(rawPath: string, content: Uint8Array): Promise<void> {
		const path = normalize(rawPath)
		await observeBeforeChange(path)
		staged.set(path, { content: content.slice(), mtimeMs: Date.now() })
	}

	async function remove(rawPath: string): Promise<void> {
		const path = normalize(rawPath)
		await observeBeforeChange(path)
		staged.set(path, null)
	}

	function stagedBelow(dir: string): string[] {
		return [...staged].filter(([path, change]) => change !== null && isBelow(path, dir)).map(([path]) => path)
	}

	return {
		async readFile(path) {
			return decoder.decode(await readBytes(path))
		},
		readBytes,
		writeFile(path, content) {
			return write(path, encoder.encode(content))
		},
		writeBytes: write,
		async rename(from, to) {
			const content = await readBytes(from)
			await remove(from)
			await write(to, content)
		},
		remove,
		async exists(rawPath) {
			const path = normalize(rawPath)
			const change = staged.get(path)
			if (change !== undefined) return change !== null
			if (stagedBelow(path).length > 0) return true
			const exists = await base.exists(path)
			observe(path, exists ? { kind: 'present' } : { kind: 'absent' })
			return exists
		},
		async list(rawDir) {
			const dir = normalize(rawDir)
			const entries = new Map((await base.list(dir)).map(entry => [entry.name, entry.isDirectory]))
			for (const [path, change] of staged) {
				if (!isBelow(path, dir)) continue
				const rest = dir === '' ? path : path.slice(dir.length + 1)
				const [name, ...deeper] = rest.split('/')
				if (name === undefined) continue
				if (deeper.length > 0) {
					if (change !== null) entries.set(name, true)
				} else if (change === null) {
					entries.delete(name)
				} else {
					entries.set(name, false)
				}
			}
			return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }))
		},
		async glob(pattern, options) {
			const matcher = globToRegExp(pattern)
			const files = new Set(await base.glob(pattern, options))
			for (const [path, change] of staged) {
				if (change === null) files.delete(path)
				else if (matcher.test(path)) files.add(path)
			}
			return [...files]
		},
		async stat(rawPath) {
			const path = normalize(rawPath)
			const change = staged.get(path)
			if (change === null) throw missing(path)
			if (change !== undefined) return { mtimeMs: change.mtimeMs, size: change.content.byteLength }
			const stat = await base.stat(path)
			observe(path, { kind: 'present' })
			return stat
		},
		changeset() {
			const changes: CmsStagedChange[] = [...staged].map(([path, change]) =>
				change === null ? { kind: 'remove', path } : { kind: 'write', path, content: change.content }
			)
			return { reads: new Map(reads), changes }
		},
	}
}

/** The version of `path` now, in the terms {@link CmsFileVersion} records. */
export async function versionOf(fs: CmsFileSystem, path: string): Promise<CmsFileVersion> {
	if (!(await fs.exists(path))) return { kind: 'absent' }
	try {
		return { kind: 'content', digest: digestBytes(await fs.readBytes(path)) }
	} catch {
		// A directory exists without content.
		return { kind: 'present' }
	}
}

/** Whether a path whose version was `recorded` may be overwritten now that it is `current`. */
export function versionMatches(recorded: CmsFileVersion, current: CmsFileVersion): boolean {
	if (recorded.kind === 'absent') return current.kind === 'absent'
	if (recorded.kind === 'present') return current.kind !== 'absent'
	return current.kind === 'content' && current.digest === recorded.digest
}

/**
 * A commit over `fs` that checks the recorded versions and then applies the changes. It is atomic
 * only when nothing else writes to `fs` between its awaits; a host with concurrent writers does
 * both steps inside its own critical section instead.
 */
export function commitChangeset(fs: CmsFileSystem): CmsCommit {
	return async ({ reads, changes }) => {
		const conflicts: string[] = []
		for (const [path, recorded] of reads) {
			if (!versionMatches(recorded, await versionOf(fs, path))) conflicts.push(path)
		}
		if (conflicts.length > 0) throw new CmsCommitConflictError(conflicts)
		for (const change of changes) {
			if (change.kind === 'write') await fs.writeBytes(change.path, change.content)
			else await fs.remove(change.path)
		}
	}
}
