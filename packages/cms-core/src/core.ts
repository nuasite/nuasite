import type { CollectionDefinition } from '@nuasite/cms-types'
import { scanCollections } from './collection-scanner'
import { type ParseCache } from './content-config-ast'
import type { CmsFileSystem } from './fs/types'

export interface CmsCoreOptions {
	/** Content collections directory, relative to the filesystem root. Defaults to `src/content`. */
	contentDir?: string
}

/**
 * The framework-agnostic CMS brain over a `CmsFileSystem` port.
 *
 * F0.1 exposes the read/scan surface only. Mutations (entry/array/page/redirect
 * CRUD) and the media adapter land in a later chunk; the factory is shaped to
 * grow without changing this surface.
 */
export interface CmsCore {
	/** Scan all content collections, returning their inferred definitions keyed by name. */
	scanCollections(): Promise<Record<string, CollectionDefinition>>
}

export function createCmsCore(fs: CmsFileSystem, opts: CmsCoreOptions = {}): CmsCore {
	const contentDir = opts.contentDir ?? 'src/content'
	// One mtime-keyed content-config parse cache per core instance (per project root).
	const parseCache: ParseCache = new Map()

	return {
		scanCollections() {
			return scanCollections(fs, contentDir, parseCache)
		},
	}
}
