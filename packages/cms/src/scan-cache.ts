import { scanCollections as coreScanCollections } from '@nuasite/cms-core'
import type { CollectionDefinition } from '@nuasite/cms-types'
import { applyCollectionOverrides, type CollectionOverrides } from './collection-overrides.ts'
import { currentProjectContext } from './project/context.ts'

/**
 * Scan all content collections of the current project context. The context keeps one
 * content-config parse cache for these standalone scans (server setup, each entry create or
 * delete): cms-core's `parseContentConfig` is mtime-keyed, so repeated scans skip re-reading and
 * re-parsing `content.config.ts` when it has not changed.
 *
 * `overrides` are the Astro-config `collections` overrides. A scan whose result is shown to
 * an editor passes them, so the labels it serves do not depend on which scan produced them.
 */
export async function scanCollections(contentDir?: string, overrides?: CollectionOverrides): Promise<Record<string, CollectionDefinition>> {
	const context = currentProjectContext()
	return applyCollectionOverrides(await coreScanCollections(context.fs, contentDir, context.state.contentConfigParses), overrides)
}
