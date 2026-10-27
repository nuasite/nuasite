import { defaultProjectContext } from '#project-context-default'
import type { parse } from '@astrojs/compiler'
import { type CmsCommit, type CmsFileSystem, createStagedFileSystem } from '@nuasite/cms-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import { createProjectFiles, type ProjectFiles } from './files.ts'
import { ProjectState } from './state.ts'

export type AstroParse = typeof parse

/**
 * One project as the visual editor sees it: where its sources are, how to read and write them,
 * and what has been cached about them.
 */
export interface ProjectContext {
	/** Absolute path of the project root. Source paths in manifests are relative to it. */
	readonly root: string
	/** The project's files through the CMS filesystem port, rooted at `root`. */
	readonly fs: CmsFileSystem
	/** The same files for the editor's source lookup, which spells paths absolute or root-relative. */
	readonly files: ProjectFiles
	readonly state: ProjectState
	/** Parses `.astro` sources. A host where `@astrojs/compiler` cannot load its WASM passes its own. */
	readonly parseAstro: AstroParse
	/**
	 * Runs one source mutation. Inside it, `files` and `fs` of the current context are a staged
	 * view, and the changes reach the project only through the context's commit, which rejects
	 * with `CmsCommitConflictError` when a file it read changed meanwhile.
	 */
	mutate<T>(mutation: () => Promise<T>): Promise<T>
}

const current = new AsyncLocalStorage<ProjectContext>()

/** The context of the code running now: the one a host entered with {@link runInProjectContext}, else the process default. */
export function currentProjectContext(): ProjectContext {
	return current.getStore() ?? defaultProjectContext()
}

export function runInProjectContext<T>(context: ProjectContext, run: () => T): T {
	return current.run(context, run)
}

export interface ProjectContextOptions {
	root: string
	fs: CmsFileSystem
	parseAstro: AstroParse
	/** Applies a mutation's changes; see {@link CmsCommit}. Without it, mutations write directly. */
	commit?: CmsCommit
}

export function createProjectContext(options: ProjectContextOptions): ProjectContext {
	const { root, fs, parseAstro, commit } = options
	const state = new ProjectState()
	const context: ProjectContext = {
		root,
		fs,
		files: createProjectFiles(fs, root),
		state,
		parseAstro,
		async mutate(mutation) {
			if (commit === undefined) return mutation()
			const staged = createStagedFileSystem(fs)
			const stagedContext: ProjectContext = { ...context, fs: staged, files: createProjectFiles(staged, root), mutate: run => run() }
			const result = await runInProjectContext(stagedContext, mutation)
			const changeset = staged.changeset()
			await commit(changeset)
			for (const change of changeset.changes) state.markFileDirty(path.join(root, change.path))
			return result
		},
	}
	return context
}

/** The files of the current project context. */
export function projectFiles(): ProjectFiles {
	return currentProjectContext().files
}
