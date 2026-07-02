import { createNodeFs, type ParseCache, scanCollections as coreScanCollections } from '@nuasite/cms-core'
import type { CollectionDefinition } from '@nuasite/cms-types'
import { getProjectRoot } from './config'

/**
 * Process-persistent content-config parse cache shared across every standalone
 * collection scan (server setup + each entry create/delete). cms-core's
 * `parseContentConfig` is mtime-keyed, so threading one cache here lets repeated
 * scans skip re-reading and re-Babel-parsing `content.config.ts` when it hasn't
 * changed — the CmsCore instance keeps its own cache the same way, but these
 * top-level call sites bypass it.
 */
const parseCache: ParseCache = new Map()

/**
 * Scan all content collections against the current project root, reusing the
 * shared {@link parseCache}. Drop-in replacement for cms-core's `scanCollections`
 * for the dev-server call sites that would otherwise each allocate a fresh cache.
 */
export function scanCollections(contentDir?: string): Promise<Record<string, CollectionDefinition>> {
	return coreScanCollections(createNodeFs(getProjectRoot()), contentDir, parseCache)
}
