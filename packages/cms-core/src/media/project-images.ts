import type { MediaItem } from '@nuasite/cms-types'
import type { CmsFileSystem } from '../fs/types'
import { MIME_BY_EXT, mimeFromExt } from './local'

const IMAGE_EXTENSIONS = new Set(Object.entries(MIME_BY_EXT).filter(([, mime]) => mime.startsWith('image/')).map(([ext]) => ext))

export interface ListProjectImagesOptions {
	/**
	 * The media uploads directory, which the scan must not list a second time.
	 *
	 * `dir` is taken in every spelling `MediaStorageAdapter.staticFiles.dir` documents
	 * and is normalised here (see {@link uploadsDirRelativeToRoot}); `undefined` means the
	 * adapter stores nothing locally, so nothing is excluded. `root` travels with it
	 * because an absolute `dir` cannot be interpreted without it — and a `dir` handed over
	 * without a `root` is exactly the shape that used to exclude nothing at all, silently.
	 */
	exclude?: { dir?: string; root: string }
	/**
	 * @deprecated Pass `exclude` instead — it carries the project root, so an absolute
	 * `staticFiles.dir` normalises too.
	 *
	 * Honoured with exactly its old semantics, so callers written against it are unaffected:
	 * root-relative, with an optional leading or trailing slash. An absolute filesystem path
	 * — what `createLocalStorageAdapter` reports — never excluded anything here and still
	 * does not; that is the bug `exclude` exists to make unreachable. Ignored when `exclude`
	 * is present.
	 */
	excludeDir?: string
}

/**
 * An uploads directory as a root-relative path, in the spelling the scan below walks.
 *
 * Accepts every spelling `MediaStorageAdapter.staticFiles.dir` documents: an absolute
 * path under the root, a root-relative path with or without a leading slash, an optional
 * `./` prefix and a trailing slash. A leading slash only means "absolute filesystem path"
 * when the path actually starts with the root — otherwise it is root-relative, exactly
 * the rule the {@link CmsFileSystem} port uses.
 *
 * `undefined` when there is no local directory at all (S3/Contember adapters); `''` (no
 * exclusion) when it claims the whole project root.
 */
export function uploadsDirRelativeToRoot(dir: string | undefined, root: string): string | undefined {
	if (dir === undefined) return undefined
	const base = root.replace(/\/+$/, '')
	const trimmed = dir.replace(/\/+$/, '')
	if (trimmed === base) return ''
	if (trimmed.startsWith(`${base}/`)) return trimmed.slice(base.length + 1)
	return trimmed.replace(/^\.\//, '').replace(/^\/+/, '')
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
	// Normalised here rather than by the caller: the scan walks root-relative paths, so only
	// this function knows what an exclusion has to look like to match one.
	// The deprecated `excludeDir` keeps its own, weaker normalisation — it has no root to
	// resolve against — so callers written against it behave exactly as before.
	const normalized = options?.exclude
		? uploadsDirRelativeToRoot(options.exclude.dir, options.exclude.root)
		: options?.excludeDir?.replace(/^\/+/, '').replace(/\/+$/, '')
	// `''` — the uploads dir *is* the project root — excludes nothing, like no exclusion at all.
	const excludeDir = normalized ? normalized : null

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

async function scanDirectory(
	fs: CmsFileSystem,
	currentDir: string,
	baseDir: string,
	relativeToRoot: boolean,
	excludeDir: string | null,
	items: MediaItem[],
): Promise<void> {
	// `currentDir` is built from `public`/`src` downwards, so it is already in the
	// normalised spelling `uploadsDirRelativeToRoot` produces.
	if (excludeDir !== null && currentDir === excludeDir) return

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
