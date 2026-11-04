export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length)
	// One iterator shared by every worker, so each item is taken exactly once.
	const queue = items.entries()

	const workerCount = Math.max(1, Math.min(limit, items.length))
	const workers = Array.from({ length: workerCount }, async () => {
		for (const [index, item] of queue) {
			results[index] = await fn(item, index)
		}
	})

	await Promise.all(workers)
	return results
}
