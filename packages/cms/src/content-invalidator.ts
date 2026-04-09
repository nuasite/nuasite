/**
 * Vite SSR module cache invalidation + content-sync coordination.
 *
 * Astro's content layer chain (chokidar → glob loader → syncData → data store
 * → fs.watch → invalidateModule) is racy and unreliable under several conditions:
 *
 *   - Native fs.watch on Linux dies after the first atomic rename of the watched
 *     file (Astro writes data-store.json via writeFile-tmp + rename).
 *   - Vite's bundled chokidar 3.6.0 misses the same atomic-write events.
 *   - `invalidateModule(astro:data-layer-content)` alone does not propagate up
 *     the import graph, so route modules that already cached `getCollection`
 *     references keep returning stale data.
 *
 * This module exposes two things:
 *
 *   - `invalidateContentCache(server)` — walks the SSR module graph from
 *     `astro:data-layer-content` upward and invalidates every transitive
 *     importer, then broadcasts `full-reload` to the client.
 *   - `notifyContentStoreUpdated` / `awaitNextContentStoreUpdate` — a shared
 *     rendezvous between the fs.watch plugin (which observes data-store.json
 *     writes) and the CMS API middleware (which needs to hold the HTTP
 *     response until the store is fresh). Keeps invalidation on a single path.
 */

interface SsrModuleNode {
	id: string | null
	importers: Set<SsrModuleNode>
}

interface SsrModuleGraph {
	getModuleById(id: string): SsrModuleNode | undefined
	invalidateModule(
		mod: SsrModuleNode,
		seen?: Set<SsrModuleNode>,
		timestamp?: number,
		isHmr?: boolean,
	): void
}

interface SsrEnvironment {
	moduleGraph: SsrModuleGraph
	hot: { send: (event: string, data?: unknown) => void }
}

interface ClientEnvironment {
	hot: { send: (payload: { type: string; path: string }) => void }
}

export interface ViteServerLike {
	environments: { ssr: SsrEnvironment; client: ClientEnvironment }
}

// Astro exposes the content data store as a virtual module whose resolved id
// is `\0astro:data-layer-content` (see astro/dist/content/consts.js). Earlier
// versions of this file used `\0astro:data-store`, which does not exist and
// silently reduced `invalidateContentCache` to a no-op full-reload broadcast.
const DATA_STORE_VIRTUAL_ID = '\0astro:data-layer-content'

/**
 * Invalidate the SSR `astro:data-layer-content` virtual module and every
 * module that (transitively) imports it. After this returns, the next request
 * that imports any of these modules will re-execute and read fresh content.
 *
 * Also broadcasts `full-reload` so any connected browser refreshes.
 */
export function invalidateContentCache(server: ViteServerLike): void {
	const ssr = server.environments.ssr
	const dataStoreMod = ssr.moduleGraph.getModuleById(DATA_STORE_VIRTUAL_ID)
	if (dataStoreMod) {
		const seen = new Set<SsrModuleNode>()
		const ts = Date.now()
		const walk = (mod: SsrModuleNode) => {
			if (seen.has(mod)) return
			seen.add(mod)
			ssr.moduleGraph.invalidateModule(mod, seen, ts, true)
			for (const importer of mod.importers) {
				walk(importer)
			}
		}
		walk(dataStoreMod)
	}
	ssr.hot.send('astro:content-changed', {})
	server.environments.client.hot.send({ type: 'full-reload', path: '*' })
}

// ---------------------------------------------------------------------------
// Content-sync rendezvous
// ---------------------------------------------------------------------------
//
// The CMS API middleware writes a content file and then needs to hold the HTTP
// response until Astro has actually re-synced the data store — otherwise the
// browser reloads into a stale render. The fs.watch plugin is the component
// that observes the data-store.json write, so it is also the component that
// resolves these waiters.

type StoreUpdateResolver = () => void
const pendingStoreUpdateWaiters = new Set<StoreUpdateResolver>()

/**
 * Called by the data-store fs.watch plugin after it has invalidated the SSR
 * module cache in response to a data-store.json write. Wakes every middleware
 * caller currently parked in `awaitNextContentStoreUpdate`.
 */
export function notifyContentStoreUpdated(): void {
	if (pendingStoreUpdateWaiters.size === 0) return
	const resolvers = Array.from(pendingStoreUpdateWaiters)
	pendingStoreUpdateWaiters.clear()
	for (const resolve of resolvers) resolve()
}

/**
 * Park until the next data-store.json write has been fully processed (store
 * reloaded on disk, SSR module graph invalidated). Resolves with `true` on
 * success or `false` if the timeout elapses first — callers should treat
 * timeout as "best-effort, proceed anyway".
 *
 * The timeout fallback exists because some edits legitimately do not change
 * the data store (e.g. whitespace-only edits are skipped by Astro's atomic
 * write comparator), in which case no fs.watch event will ever fire.
 */
export function awaitNextContentStoreUpdate(timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const resolver = () => {
			clearTimeout(timer)
			pendingStoreUpdateWaiters.delete(resolver)
			resolve(true)
		}
		const timer = setTimeout(() => {
			pendingStoreUpdateWaiters.delete(resolver)
			resolve(false)
		}, timeoutMs)
		pendingStoreUpdateWaiters.add(resolver)
	})
}
