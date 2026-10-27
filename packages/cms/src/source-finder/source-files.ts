import path from 'node:path'
import { getProjectRoot } from '../config.ts'
import { projectFiles } from '../project/context.ts'

/** The directories whose components can pass a prop on: pages, components and layouts. */
export function templateSearchDirs(): string[] {
	const srcDir = path.join(getProjectRoot(), 'src')
	return [path.join(srcDir, 'pages'), path.join(srcDir, 'components'), path.join(srcDir, 'layouts')]
}

/** Absolute paths of the `.astro` files under `dirs`, depth first in name order. A missing directory has none. */
export async function astroFilesUnder(dirs: readonly string[]): Promise<string[]> {
	const files: string[] = []
	const walk = async (dir: string): Promise<void> => {
		let entries
		try {
			entries = await projectFiles().readdir(dir)
		} catch {
			return
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) await walk(fullPath)
			else if (entry.isFile() && entry.name.endsWith('.astro')) files.push(fullPath)
		}
	}
	for (const dir of dirs) await walk(dir)
	return files
}

/**
 * `files` (absolute) reordered so the `preferred` ones (root-relative, in their order) come
 * first. A lookup that takes the first match then lands in a file rendered on the page before
 * one that merely contains the same text.
 */
export function preferringFiles(files: readonly string[], preferred: readonly string[] | undefined): string[] {
	if (!preferred?.length) return [...files]
	const root = getProjectRoot()
	const rank = new Map(preferred.map((file, index) => [file, index]))
	const rankOf = (file: string) => rank.get(path.relative(root, file)) ?? preferred.length
	return files.map((file, index) => ({ file, index, rank: rankOf(file) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(({ file }) => file)
}

/** A source path as manifests spell it (absolute under the root, `/src/…` or `src/…`), relative to the root. */
export function projectRelativeSource(file: string): string {
	const root = getProjectRoot()
	return file.startsWith(`${root}/`) ? path.relative(root, file) : file.replace(/^\/+/, '')
}
