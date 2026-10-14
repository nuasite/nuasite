import { parse } from '@astrojs/compiler'
import { type CmsFileSystem, createNodeFs } from '@nuasite/cms-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ProjectContext } from './context'
import type { ProjectFiles } from './files'
import { ProjectState } from './state'

// The context of the Astro integration and of code that runs outside any host context: the
// project at the working directory (or the root set with `setProjectRoot`), on `node:fs`.

let rootOverride: string | null = null

/** Listings in name order, whatever order the filesystem returns them in. */
function byName(a: { name: string }, b: { name: string }): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export function setDefaultProjectRoot(root: string | null): void {
	rootOverride = root
}

const nodeFiles: ProjectFiles = {
	readFile: filePath => fs.readFile(filePath, 'utf-8'),
	readBytes: filePath => fs.readFile(filePath),
	async writeFile(filePath, content) {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content)
	},
	readdir: async dirPath => (await fs.readdir(dirPath, { withFileTypes: true })).sort(byName),
	access: filePath => fs.access(filePath),
	stat: filePath => fs.stat(filePath),
}

let portFor: { root: string; fs: CmsFileSystem } | null = null

const context: ProjectContext = {
	get root() {
		return rootOverride ?? process.cwd()
	},
	get fs() {
		const root = this.root
		if (portFor?.root !== root) portFor = { root, fs: createNodeFs(root) }
		return portFor.fs
	},
	files: nodeFiles,
	state: new ProjectState(),
	parseAstro: parse,
	mutate: mutation => mutation(),
}

/**
 * The project at `root` on `node:fs`, as the default context sees it but at a fixed root. Its files
 * reach outside the root as the default's do (a `contentDir` of `../shared/content`), and it caches
 * nothing between contexts, so a fresh one never serves a stale read.
 */
export function createNodeProjectContext(root: string): ProjectContext {
	return { root, fs: createNodeFs(root), files: nodeFiles, state: new ProjectState(), parseAstro: parse, mutate: mutation => mutation() }
}

export function defaultProjectContext(): ProjectContext {
	return context
}
