import type { MediaItem } from '@nuasite/cms-types'
import type { CmsFileSystem } from '../fs/types'
import { MIME_BY_EXT, mimeFromExt } from './local'

const IMAGE_EXTENSIONS = new Set(Object.entries(MIME_BY_EXT).filter(([, mime]) => mime.startsWith('image/')).map(([ext]) => ext))

export interface ListProjectImagesOptions {
	/** Root-relative directory to exclude (e.g. the media uploads dir), to avoid duplicates. */
	excludeDir?: string
}

/**
 * Scan the project for image files in `public/` and `src/` directories,
 * excluding the media uploads directory, over the FileSystem port.
 *
 * - `public/` files are served from `/<path-relative-to-public>`.
 * - `src/` files are served from `/<path-relative-to-project-root>`.
 *
 * The result is ordered by filename, then by URL — a *total* order, so repeated
 * calls over an unchanged tree return the exact same sequence. Callers paginate
 * this list by offset (the sidecar's media cursor), which a partial order would
 * silently break: the walk pushes into one array from concurrent recursive
 * `Promise.all` branches, so the input order alone is not reproducible.
 */
export async function listProjectImages(fs: CmsFileSystem, options?: ListProjectImagesOptions): Promise<MediaItem[]> {
	const excludeDir = options?.excludeDir ? normalizeDir(options.excludeDir) : null

	const scanDirs: Array<{ dir: string; relativeToRoot: boolean }> = [
		{ dir: 'public', relativeToRoot: false },
		{ dir: 'src', relativeToRoot: true },
	]

	const results = await Promise.all(
		scanDirs.map(async ({ dir, relativeToRoot }) => {
			const items: MediaItem[] = []
			await scanDirectory(fs, dir, dir, relativeToRoot, excludeDir, items)
			return items
		}),
	)

	const items = results.flat()
	// Filename first (that is what the media grid shows), then the URL to break ties:
	// two `hero.png` in different directories compare equal on the filename alone.
	items.sort((a, b) => a.filename.localeCompare(b.filename) || compareCodeUnits(a.url, b.url))
	return items
}

/** Code-unit comparison: a total order on distinct strings, which `localeCompare` is not. */
function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

function normalizeDir(dir: string): string {
	return dir.replace(/^\/+/, '').replace(/\/+$/, '')
}

async function scanDirectory(
	fs: CmsFileSystem,
	currentDir: string,
	baseDir: string,
	relativeToRoot: boolean,
	excludeDir: string | null,
	items: MediaItem[],
): Promise<void> {
	if (excludeDir && normalizeDir(currentDir) === excludeDir) return

	const entries = await fs.list(currentDir)
	const subdirs: Promise<void>[] = []

	for (const entry of entries) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
		const fullPath = `${currentDir}/${entry.name}`

		if (entry.isDirectory) {
			subdirs.push(scanDirectory(fs, fullPath, baseDir, relativeToRoot, excludeDir, items))
		} else {
			const dotIdx = entry.name.lastIndexOf('.')
			const ext = dotIdx >= 0 ? entry.name.slice(dotIdx).toLowerCase() : ''
			if (!IMAGE_EXTENSIONS.has(ext)) continue

			const url = relativeToRoot
				? `/${fullPath}`
				: `/${fullPath.slice(baseDir.length + 1)}`

			items.push({
				id: `project:${url}`,
				url,
				filename: entry.name,
				contentType: mimeFromExt(ext),
			})
		}
	}

	await Promise.all(subdirs)
}
