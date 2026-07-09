import type { CmsFileSystem } from './fs/types'

/** Project-root-relative path where the integration writes, and the sidecar reads, the route map. */
export const ROUTE_MAP_PATH = '.nua/cms/routes.json'

/** On-disk schema version of {@link ROUTE_MAP_PATH}. Bump on a breaking shape change. */
export const ROUTE_MAP_VERSION = 1

/**
 * How the route that renders a collection turns an entry into a URL:
 * - `perItem`: a dynamic route (`[slug].astro`) → one page per entry at `<base>/<slug>`.
 * - shared page (`perItem: false`): a static page listing the collection → every entry
 *   maps to that one page's URL (`base`), no slug.
 */
export interface CollectionRoute {
	base: string
	perItem: boolean
}

/** On-disk shape of the route map file. */
export interface RouteMapFile {
	version: number
	/** Collection name → the route that renders it. */
	collections: Record<string, CollectionRoute>
}

/** Build an entry's page URL from its collection route. */
export function entryPathname(route: CollectionRoute, slug: string): string {
	if (!route.perItem) return route.base || '/'
	// A root-level `[slug]` route has base `/`; joining naively would double the slash.
	return `${route.base === '/' ? '' : route.base}/${slug}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCollectionRoute(value: unknown): value is CollectionRoute {
	return isRecord(value) && typeof value.base === 'string' && typeof value.perItem === 'boolean'
}

/** Parse + validate the route map file's JSON text. Returns the collections map, or null if unusable. */
export function parseRouteMap(json: string): Record<string, CollectionRoute> | null {
	let data: unknown
	try {
		data = JSON.parse(json)
	} catch {
		return null
	}
	if (!isRecord(data) || data.version !== ROUTE_MAP_VERSION || !isRecord(data.collections)) return null
	const out: Record<string, CollectionRoute> = {}
	for (const [name, route] of Object.entries(data.collections)) {
		if (isCollectionRoute(route)) out[name] = { base: route.base, perItem: route.perItem }
	}
	return out
}

/** Serialize a collections map to the on-disk file text (a trailing newline for tidy diffs). */
export function serializeRouteMap(collections: Record<string, CollectionRoute>): string {
	const file: RouteMapFile = { version: ROUTE_MAP_VERSION, collections }
	return `${JSON.stringify(file, null, '\t')}\n`
}

/**
 * Read the integration-written route map through the fs port. Returns null when the file is
 * absent — the common case when the Astro integration isn't running (e.g. a standalone
 * sidecar or `cms-studio`) — or unparseable, so the caller falls back to its own source scan.
 */
export async function readRouteMap(fs: CmsFileSystem): Promise<Map<string, CollectionRoute> | null> {
	let json: string
	try {
		json = await fs.readFile(ROUTE_MAP_PATH)
	} catch {
		return null
	}
	const parsed = parseRouteMap(json)
	if (!parsed || Object.keys(parsed).length === 0) return null
	return new Map(Object.entries(parsed))
}
