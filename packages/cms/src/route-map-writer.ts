import { type CollectionRoute, createNodeFs, ROUTE_MAP_PATH, scanRouteCollections, serializeRouteMap } from '@nuasite/cms-core'
import fs from 'node:fs/promises'
import path from 'node:path'

/** The subset of Astro's resolved route contract used by the CMS integration. */
export interface ResolvedRouteLike {
	type: string
	params: string[]
	pathname?: string
	segments: { content: string; dynamic: boolean; spread: boolean }[][]
	entrypoint: string
	/** Astro's URL generator preserves config base, i18n prefixes, and trailing slashes. */
	generate: (data?: Record<string, string>) => string
}

function baseFromSegments(route: ResolvedRouteLike): string {
	const parts: string[] = []
	for (const segment of route.segments) {
		if (segment.some(part => part.dynamic)) break
		parts.push(segment.map(part => part.content).join(''))
	}
	return `/${parts.join('/')}`.replace(/\/+$/, '') || '/'
}

function perItemBase(route: ResolvedRouteLike): string {
	try {
		const firstParam = route.params[0]
		if (!firstParam) return baseFromSegments(route)

		const sentinels: Record<string, string> = {}
		route.params.forEach((param, index) => {
			sentinels[param] = `__NUA_ROUTE_PARAM_${index}__`
		})
		const first = sentinels[firstParam]
		const generated = route.generate(sentinels)
		const cut = first ? generated.indexOf(first) : -1
		if (cut < 0) return baseFromSegments(route)
		return generated.slice(0, cut).replace(/\/+$/, '') || '/'
	} catch {
		return baseFromSegments(route)
	}
}

function staticBase(route: ResolvedRouteLike): string {
	const pathname = route.pathname ?? baseFromSegments(route)
	return pathname.replace(/\/+$/, '') || '/'
}

/** Build a collection route map from Astro's resolved routes and page sources. */
export async function buildRouteMap(
	routes: ResolvedRouteLike[],
	readSource: (entrypoint: string) => Promise<string | null>,
): Promise<Record<string, CollectionRoute>> {
	const map: Record<string, CollectionRoute> = {}
	const consider = (name: string, route: CollectionRoute): void => {
		const existing = map[name]
		// Per-item routes win; otherwise preserve Astro's route order.
		if (!existing || (route.perItem && !existing.perItem)) map[name] = route
	}

	for (const route of routes) {
		if (route.type !== 'page' || !route.entrypoint.endsWith('.astro')) continue
		const source = await readSource(route.entrypoint)
		if (source === null) continue
		const { staticPaths, all } = scanRouteCollections(source)
		if (all.length === 0) continue

		if (route.params.length > 0) {
			const base = perItemBase(route)
			const drivers = staticPaths.length > 0 ? staticPaths : all.slice(0, 1)
			for (const name of drivers) consider(name, { base, perItem: true })
		} else {
			const base = staticBase(route)
			for (const name of all) consider(name, { base, perItem: false })
		}
	}
	return map
}

/** Write the route map consumed by the CMS sidecar. */
export async function writeRouteMap(routes: ResolvedRouteLike[], root: string): Promise<number> {
	const readSource = async (entrypoint: string): Promise<string | null> => {
		try {
			return await fs.readFile(path.join(root, entrypoint), 'utf-8')
		} catch {
			return null
		}
	}
	const collections = await buildRouteMap(routes, readSource)
	await createNodeFs(root).writeFile(ROUTE_MAP_PATH, serializeRouteMap(collections))
	return Object.keys(collections).length
}
