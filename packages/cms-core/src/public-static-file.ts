import { statSync } from 'node:fs'
import path from 'node:path'

/**
 * Build a checker that decides whether a request URL maps to an existing file
 * under Astro's `publicDir`. Used to bypass HTML rewriting for vendor pages
 * whose inline scripts can be corrupted by injected markers or content-length
 * mismatches.
 *
 * Cache lives for the dev server's lifetime; vendor HTML is essentially static,
 * and the cache is cleared on restart.
 */
export function createPublicStaticFileChecker(publicDir: string | undefined): (urlPath: string) => boolean {
	if (!publicDir) return () => false
	const cache = new Map<string, boolean>()

	return (urlPath: string) => {
		const cleaned = urlPath.split('?')[0] || ''
		if (!cleaned.startsWith('/') || cleaned.includes('..')) return false

		const cached = cache.get(cleaned)
		if (cached !== undefined) return cached

		const candidates = [path.join(publicDir, cleaned)]
		if (cleaned.endsWith('/')) {
			candidates.push(path.join(publicDir, cleaned, 'index.html'))
		}

		let exists = false
		for (const p of candidates) {
			try {
				if (statSync(p).isFile()) {
					exists = true
					break
				}
			} catch {}
		}

		cache.set(cleaned, exists)
		return exists
	}
}
