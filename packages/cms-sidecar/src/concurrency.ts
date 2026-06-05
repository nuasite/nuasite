import type { CmsFileSystem } from '@nuasite/cms-core'
import { createHash } from 'node:crypto'

/**
 * Hashing + per-file serialization for the sidecar layer.
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
