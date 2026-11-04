import type { CmsFileSystem } from './fs/types.ts'

/**
 * Where the `@nuasite/cms` integration writes Astro's resolved routes for the sidecar: the directory
 * Astro's `createCodegenDir()` gives the integration, under the project's (gitignored) `.astro/`.
 */
export const ROUTE_MAP_PATH = '.astro/integrations/_nuasite_cms/routes.json'

/** On-disk schema version of {@link ROUTE_MAP_PATH}. Bump on a breaking shape change. */
export const ROUTE_MAP_VERSION = 1

export type TrailingSlash = 'always' | 'never' | 'ignore'

/** One page route as Astro resolved it. */
export interface MappedRoute {
	/** The file rendering the route, relative to the project root (`src/pages/blog/[slug].astro`). */
	entrypoint: string
	/** Astro's route pattern, without `base` (`/blog/[slug]`, `/` for the index). */
	pattern: string
}

/** What the sidecar takes from Astro's routing to turn a route into the URLs a browser opens. */
export interface RouteMap {
	/** The config `base` without its trailing slash: `''` for a site at the root, `/docs` under one. */
	base: string
	trailingSlash: TrailingSlash
	routes: MappedRoute[]
}

/** The config `base` as {@link RouteMap.base} spells it. */
export function normalizeSiteBase(base: string): string {
	const trimmed = base.replace(/\/+$/, '')
	return trimmed === '' ? '' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** A route path (`/blog/post`, `/`) as the site serves it: under `base`, with the configured trailing slash. */
export function sitePathname(pathname: string, site: Pick<RouteMap, 'base' | 'trailingSlash'>): string {
	const path = `${site.base}${pathname === '/' ? '' : pathname.replace(/\/+$/, '')}`
	if (path === '') return '/'
	return site.trailingSlash === 'always' ? `${path}/` : path
}

export function serializeRouteMap(map: RouteMap): string {
	return `${JSON.stringify({ version: ROUTE_MAP_VERSION, ...map }, null, '\t')}\n`
}

/** Parse the route map file. Null when it is not a route map of this version. */
export function parseRouteMap(json: string): RouteMap | null {
	let data: unknown
	try {
		data = JSON.parse(json)
	} catch {
		return null
	}
	if (!isRecord(data) || data.version !== ROUTE_MAP_VERSION) return null
	const { base, trailingSlash, routes } = data
	if (typeof base !== 'string' || !isTrailingSlash(trailingSlash) || !Array.isArray(routes)) return null
	const parsed: MappedRoute[] = []
	for (const route of routes) {
		if (isRecord(route) && typeof route.entrypoint === 'string' && typeof route.pattern === 'string') {
			parsed.push({ entrypoint: route.entrypoint, pattern: route.pattern })
		}
	}
	return { base: normalizeSiteBase(base), trailingSlash, routes: parsed }
}

/**
 * The route map the integration last wrote, or null when there is none (the integration has not
 * run here, as for a standalone sidecar) or it cannot be read.
 */
export async function readRouteMap(fs: CmsFileSystem): Promise<RouteMap | null> {
	try {
		return parseRouteMap(await fs.readFile(ROUTE_MAP_PATH))
	} catch {
		return null
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTrailingSlash(value: unknown): value is TrailingSlash {
	return value === 'always' || value === 'never' || value === 'ignore'
}
