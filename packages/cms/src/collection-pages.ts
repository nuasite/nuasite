import { buildCollectionManifestPages, discoverCollectionRoutes } from './editor-service'
import type { CollectionInfo } from './source-finder'
import type { CollectionDefinition } from './types'

/**
 * Every collection entry that has a page of its own, by that page's pathname: the URL the editor shows
 * for the entry. It comes from the collection's `cms.pathname` rule, else a URL the entry declares
 * (`urlPath`, `permalink`, …), else the static prefix of the route that renders the collection
 * (`src/pages/aktuality/[slug].astro` serves `news` entries at `/aktuality/<slug>`). A page missing here
 * renders no entry as its own, whatever its last segment is called.
 */
export async function collectionPagesByPathname(collections: Record<string, CollectionDefinition>): Promise<Map<string, CollectionInfo>> {
	const { collectionDefinitions } = buildCollectionManifestPages(collections, await discoverCollectionRoutes())
	const pages = new Map<string, CollectionInfo>()
	for (const def of Object.values(collectionDefinitions)) {
		for (const entry of def.entries ?? []) {
			if (entry.pathname && !pages.has(entry.pathname)) pages.set(entry.pathname, { name: def.name, slug: entry.slug, file: entry.sourcePath })
		}
	}
	return pages
}
