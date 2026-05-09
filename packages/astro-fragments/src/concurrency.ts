export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length)
	let cursor = 0

	const workerCount = Math.max(1, Math.min(limit, items.length))
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const i = cursor++
			if (i >= items.length) return
			const item = items[i] as T
			results[i] = await fn(item, i)
		}
	})

	await Promise.all(workers)
	return results
}
