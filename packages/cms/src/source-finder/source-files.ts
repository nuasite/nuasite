import path from 'node:path'
import { getProjectRoot } from '../config.ts'
import { projectFiles } from '../project/context.ts'

/** The directories whose components can pass a prop on: pages, components and layouts. */
export function templateSearchDirs(): string[] {
	const srcDir = path.join(getProjectRoot(), 'src')
	return [path.join(srcDir, 'pages'), path.join(srcDir, 'components'), path.join(srcDir, 'layouts')]
}

/** Absolute paths of the project's own `.astro` files among `files` (spelled as manifests spell them), in their order: none of a package. */
export function projectTemplatesAmong(files: readonly string[]): string[] {
	const root = getProjectRoot()
	const absolute = files.map(file => path.join(root, projectRelativeSource(file)))
	return [...new Set(absolute)].filter(file => file.endsWith('.astro') && file.startsWith(`${root}/`) && !file.includes('/node_modules/'))
}

/**
 * The files under `src/pages` that can render `pathname`, root-relative: the file named after it, and the dynamic
 * routes (`[param]`, `[...rest]`) whose segments match it. Found from directory listings, without reading a file.
 */
export async function pageRouteFiles(pathname: string): Promise<string[]> {
	const pagesDir = path.join(getProjectRoot(), 'src', 'pages')
	const segments = pathname.split(/[?#]/)[0]?.split('/').filter(segment => segment !== '') ?? []
	const found: string[] = []
	const match = async (dir: string, rest: readonly string[]): Promise<void> => {
		let entries
		try {
			entries = await projectFiles().readdir(dir)
		} catch {
			return
		}
		const [segment, ...after] = rest
		// Static names before parameters before rest parameters, as Astro ranks them.
		for (const rank of ['static', 'param', 'rest'] as const) {
			for (const entry of entries) {
				const extension = path.extname(entry.name)
				const isPage = entry.isFile() && PAGE_FILE_EXTENSIONS.has(extension)
				const name = isPage ? path.basename(entry.name, extension) : entry.name
				if (!isPage && !entry.isDirectory()) continue
				if (routeSegmentRank(name) !== rank) continue
				const fullPath = path.join(dir, entry.name)
				if (rank === 'rest') {
					if (isPage) found.push(fullPath)
					else await match(fullPath, [])
				} else if (segment === undefined) {
					if (isPage && name === 'index') found.push(fullPath)
				} else if (rank === 'param' || name === segment) {
					if (isPage && after.length === 0) found.push(fullPath)
					else if (!isPage) await match(fullPath, after)
				}
			}
		}
	}
	await match(pagesDir, segments)
	const root = getProjectRoot()
	return found.map(file => path.relative(root, file))
}

const PAGE_FILE_EXTENSIONS = new Set(['.astro', '.md', '.mdx'])

function routeSegmentRank(name: string): 'static' | 'param' | 'rest' {
	if (name.startsWith('[...')) return 'rest'
	return name.includes('[') ? 'param' : 'static'
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
