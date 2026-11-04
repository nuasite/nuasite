import { createNodeFs, type MappedRoute, normalizeSiteBase, ROUTE_MAP_PATH, serializeRouteMap, type TrailingSlash } from '@nuasite/cms-core'
import type { IntegrationResolvedRoute } from 'astro'
import path from 'node:path'

export interface RouteMapSite {
	/** Absolute project root. */
	root: string
	/** The config `base`, as Astro resolved it. */
	base: string
	trailingSlash: TrailingSlash
}

/** The page routes of Astro's resolved route table, with entrypoints made relative to `root`. */
export function mappedRoutes(routes: readonly Pick<IntegrationResolvedRoute, 'type' | 'entrypoint' | 'pattern'>[], root: string): MappedRoute[] {
	const mapped: MappedRoute[] = []
	for (const route of routes) {
		if (route.type !== 'page') continue
		const entrypoint = path.relative(root, path.resolve(root, route.entrypoint)).split(path.sep).join('/')
		// An entrypoint outside the project is nothing the sidecar can read.
		if (entrypoint.startsWith('../') || path.isAbsolute(entrypoint)) continue
		mapped.push({ entrypoint, pattern: route.pattern })
	}
	return mapped
}

/** Write Astro's routes and URL settings where the sidecar reads them (see `readRouteMap`). */
export async function writeRouteMap(routes: readonly IntegrationResolvedRoute[], site: RouteMapSite): Promise<void> {
	const map = { base: normalizeSiteBase(site.base), trailingSlash: site.trailingSlash, routes: mappedRoutes(routes, site.root) }
	await createNodeFs(site.root).writeFile(ROUTE_MAP_PATH, serializeRouteMap(map))
}
