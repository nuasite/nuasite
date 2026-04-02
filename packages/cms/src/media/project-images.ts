import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from '../config'
import { MIME_BY_EXT, mimeFromExt } from './local'
import type { MediaItem } from './types'

const IMAGE_EXTENSIONS = new Set(Object.entries(MIME_BY_EXT).filter(([, mime]) => mime.startsWith('image/')).map(([ext]) => ext))

/**
 * Scan the project for image files in `public/` and `src/` directories,
 * excluding the media uploads directory to avoid duplicates.
 */
export async function listProjectImages(options?: {
	excludeDir?: string
}): Promise<MediaItem[]> {
	const root = getProjectRoot()
	const excludeDir = options?.excludeDir ? path.resolve(options.excludeDir) : null

	const scanDirs = [
		{ dir: path.join(root, 'public'), urlPrefix: '' },
		{ dir: path.join(root, 'src'), urlPrefix: null },
	]

	const results = await Promise.all(
		scanDirs.map(({ dir, urlPrefix }) => {
			const items: MediaItem[] = []
			return scanDirectory(dir, dir, urlPrefix, excludeDir, items).then(() => items)
		}),
	)

	const items = results.flat()
	items.sort((a, b) => a.filename.localeCompare(b.filename))
	return items
}

async function scanDirectory(
	currentDir: string,
	baseDir: string,
	urlPrefix: string | null,
	excludeDir: string | null,
	items: MediaItem[],
): Promise<void> {
	if (excludeDir && path.resolve(currentDir) === excludeDir) return

	let entries: Dirent[]
	try {
		entries = await fs.readdir(currentDir, { withFileTypes: true }) as Dirent[]
	} catch {
		return
	}

	const subdirs: Promise<void>[] = []

	for (const entry of entries) {
		const name = String(entry.name)
		if (name.startsWith('.') || name === 'node_modules') continue
		const fullPath = path.join(currentDir, name)

		if (entry.isDirectory()) {
			subdirs.push(scanDirectory(fullPath, baseDir, urlPrefix, excludeDir, items))
		} else if (entry.isFile()) {
			const ext = path.extname(name).toLowerCase()
			if (!IMAGE_EXTENSIONS.has(ext)) continue

			const relativePath = path.relative(baseDir, fullPath)
			const url = urlPrefix !== null
				? `/${relativePath}`
				: `/${path.relative(getProjectRoot(), fullPath)}`

			items.push({
				id: `project:${url}`,
				url,
				filename: name,
				contentType: mimeFromExt(ext),
			})
		}
	}

	await Promise.all(subdirs)
}
