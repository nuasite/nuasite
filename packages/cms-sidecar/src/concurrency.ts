import type { CmsFileSystem } from '@nuasite/cms-core'
import { createHash } from 'node:crypto'

/**
 * Hashing, per-file serialization and shared reads for the sidecar layer.
 *
 * cms-core stays hash-agnostic: the optimistic-concurrency `baseHash`/`sourceHash`
 * comparison and the in-process mutex live here. Hashing reads the on-disk source
 * through the same `CmsFileSystem` port cms-core uses, so the hash reflects exactly
 * the bytes a subsequent `getEntry` would parse.
 */

/** Stable content hash of a UTF-8 string: `sha256:<hex>`. */
export function hashContent(content: string): string {
	return `sha256:${createHash('sha256').update(content, 'utf-8').digest('hex')}`
}

/**
 * Hash the current on-disk source at `sourcePath`, or `null` when the file does
 * not exist. Reads via the port so the hash matches the bytes cms-core sees.
 */
export async function hashSource(fs: CmsFileSystem, sourcePath: string): Promise<string | null> {
	if (!(await fs.exists(sourcePath))) return null
	const raw = await fs.readFile(sourcePath)
	return hashContent(raw)
}

/**
 * One run of an expensive read at a time, shared by every caller that asks while it is in flight.
 * `invalidate()` makes the next caller start a fresh run, so a caller never gets a result that
 * predates a write which already completed.
 */
export class SharedRun<T> {
	private current: { generation: number; promise: Promise<T> } | null = null
	private generation = 0

	constructor(private readonly run: () => Promise<T>) {}

	get(): Promise<T> {
		if (this.current !== null && this.current.generation === this.generation) return this.current.promise
		const entry = { generation: this.generation, promise: this.run() }
		this.current = entry
		const release = () => {
			if (this.current === entry) this.current = null
		}
		entry.promise.then(release, release)
		return entry.promise
	}

	invalidate(): void {
		this.generation++
	}
}

/**
 * Serializes async work keyed by a string (a source path). Concurrent mutations
 * of the same entry run one-after-another; different entries run in parallel.
 * The chain self-cleans: a key's tail is dropped once its last waiter settles.
 */
export class KeyedMutex {
	private readonly tails = new Map<string, Promise<unknown>>()

	async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve()
		// Chain after the previous holder, swallowing its result/rejection so one
		// failed mutation never poisons the next waiter on the same key.
		const run = previous.then(() => task(), () => task())
		this.tails.set(key, run)
		try {
			return await run
		} finally {
			// Drop the entry only if no later waiter has chained onto it.
			if (this.tails.get(key) === run) {
				this.tails.delete(key)
			}
		}
	}
}
