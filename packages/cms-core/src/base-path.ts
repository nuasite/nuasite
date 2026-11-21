import path from 'node:path'

/**
 * Normalize a glob loader `base` (`./src/content/x`, `src/content/x/`) into a
 * root-relative path comparable with a collection definition's `path`. The project
 * root comes out as `.`. Entry reads and writes resolve their directory with this too,
 * so they land where the scan reports a collection.
 */
export function normalizeBasePath(basePath: string): string {
	return path.normalize(basePath.replace(/^\.[/\\]+/, '')).replace(/[/\\]+$/, '')
}
