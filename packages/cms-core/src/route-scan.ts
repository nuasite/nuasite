import { analyzeAstroSource } from './astro-source-analysis'

/** Content collections referenced by an Astro route, split by route role. */
export interface RouteCollectionScan {
	/** Collections read directly inside the exported `getStaticPaths` function. */
	staticPaths: string[]
	/** Every collection read through an `astro:content` import. */
	all: string[]
}

function appendUnique(collections: string[], seen: Set<string>, collectionName: string): void {
	if (seen.has(collectionName)) return
	seen.add(collectionName)
	collections.push(collectionName)
}

/** Find the content collections read by an Astro route's frontmatter. */
export function scanRouteCollections(source: string): RouteCollectionScan {
	const analysis = analyzeAstroSource(source)
	const all: string[] = []
	const allSeen = new Set<string>()
	const staticPaths: string[] = []
	const staticPathsSeen = new Set<string>()

	for (const call of analysis.collectionCalls) {
		if (call.accessor !== 'getCollection' || call.collectionName === null) continue
		appendUnique(all, allSeen, call.collectionName)
		if (call.inExportedGetStaticPaths) appendUnique(staticPaths, staticPathsSeen, call.collectionName)
	}

	return { staticPaths, all }
}
