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
	// An absolute path outside the root is another package's, not one spelled from the root (`/src/…`).
	const own = files.filter(file => !file.startsWith('/') || file.startsWith(`${root}/`) || file.startsWith('/src/'))
	const absolute = own.map(file => path.join(root, projectRelativeSource(file)))
	return [...new Set(absolute)].filter(file => file.endsWith('.astro') && file.startsWith(`${root}/`) && !file.includes('/node_modules/'))
}

/**
 * The file under `src/pages` that renders `pathname`, root-relative, ranked as Astro ranks routes: at
 * each level a static name before a parameter (`[slug]`, `[lang]-[slug]`) before a rest parameter
 * (`[...rest]`), depth first. Found from directory listings, without reading a file.
 */
export async function pageRouteFile(pageUrl: string): Promise<string | undefined> {
	const pagesDir = path.join(getProjectRoot(), 'src', 'pages')
	const match = async (dir: string, segments: readonly string[]): Promise<string | undefined> => {
		let entries
		try {
			entries = await projectFiles().readdir(dir)
		} catch {
			return undefined
		}
		const routes = entries
			.filter(entry => !entry.name.startsWith('_') && !entry.name.startsWith('.'))
			.map(entry => {
				const extension = path.extname(entry.name)
				const isPage = entry.isFile() && PAGE_FILE_EXTENSIONS.has(extension)
				return {
					fullPath: path.join(dir, entry.name),
					isPage,
					isDirectory: entry.isDirectory(),
					name: isPage ? path.basename(entry.name, extension) : entry.name,
				}
			})
			.filter(route => route.isPage || route.isDirectory)
		const [segment, ...after] = segments
		for (const rank of ROUTE_RANKS) {
			for (const route of routes.filter(candidate => routeSegmentRank(candidate.name) === rank)) {
				if (rank === 'rest') {
					if (route.isPage) return route.fullPath
					// A rest directory takes as many segments as its own routes leave over, the most first.
					for (let taken = segments.length; taken >= 0; taken--) {
						const found = await match(route.fullPath, segments.slice(taken))
						if (found) return found
					}
				} else if (segment === undefined) {
					if (route.isPage && route.name === 'index') return route.fullPath
				} else if (routeSegmentPattern(route.name).test(segment)) {
					const found = route.isPage ? (after.length === 0 ? route.fullPath : undefined) : await match(route.fullPath, after)
					if (found) return found
				}
			}
		}
		return undefined
	}
	const found = await match(pagesDir, urlSegments(pageUrl))
	return found === undefined ? undefined : path.relative(getProjectRoot(), found)
}

const PAGE_FILE_EXTENSIONS = new Set(['.astro', '.md', '.mdx'])

/** The decoded segments of a page URL's path, from a path or a full URL. */
function urlSegments(pageUrl: string): string[] {
	let pathname: string
	try {
		pathname = new URL(pageUrl).pathname
	} catch {
		pathname = pageUrl.split(/[?#]/)[0] ?? ''
	}
	return pathname.split('/').filter(segment => segment !== '').map(segment => {
		try {
			return decodeURIComponent(segment)
		} catch {
			return segment
		}
	})
}

type RouteRank = 'static' | 'param' | 'rest'

/** Astro's order of routes at one level of the path. */
const ROUTE_RANKS: readonly RouteRank[] = ['static', 'param', 'rest']

function routeSegmentRank(name: string): RouteRank {
	if (name.startsWith('[...')) return 'rest'
	return name.includes('[') ? 'param' : 'static'
}

/** A route segment's name as a pattern: its static text as is, each `[param]` one or more characters. */
function routeSegmentPattern(name: string): RegExp {
	const parts = name.split(/\[[^\]]+\]/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	return new RegExp(`^${parts.join('.+?')}$`)
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
