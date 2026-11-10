import { AsyncLocalStorage } from 'node:async_hooks'

/** How many files a pass over the project takes between two turns of the host's event loop. */
const YIELD_EVERY = 50

const yielding = new AsyncLocalStorage<() => Promise<void>>()

/**
 * Runs `work` so that the passes over the project's files inside it give the host's event loop a turn
 * every {@link YIELD_EVERY} files. For background work the host keeps alive: a host that shares its
 * thread with other work stays responsive while a large project is indexed.
 */
export function runYieldingToHost<T>(work: () => Promise<T>): Promise<T> {
	return yielding.run(() => new Promise<void>(resolve => setTimeout(resolve, 0)), work)
}

/**
 * Runs `run` over `items` all at once; inside {@link runYieldingToHost}, in chunks with a turn of the
 * event loop between them. Within a chunk, items still run concurrently.
 */
export async function forEachYielding<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
	const pause = yielding.getStore()
	if (pause === undefined) {
		await Promise.all(items.map(run))
		return
	}
	for (let start = 0; start < items.length; start += YIELD_EVERY) {
		await Promise.all(items.slice(start, start + YIELD_EVERY).map(run))
		if (start + YIELD_EVERY < items.length) await pause()
	}
}
