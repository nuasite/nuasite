import { runInProjectContext } from './context.ts'
import { createNodeProjectContext } from './default-node.ts'

/** The project at a fixed root on `node:fs`; see {@link projectAtRoot}. */
export interface ProjectAtRoot {
	readonly root: string
	/** Run `run` against this project. Calls share its caches. */
	run<T>(run: () => T): T
}

/**
 * The project at `root` on `node:fs`, whatever the working directory is. For an integration that reads
 * sources on its own: Astro's `config.root` need not be the working directory (`astro build --root site`),
 * and the process default would look in the wrong place. Its caches live as long as it does, so a caller
 * that watches files makes a new one after a change.
 */
export function projectAtRoot(root: string): ProjectAtRoot {
	const context = createNodeProjectContext(root)
	return { root, run: run => runInProjectContext(context, run) }
}

/** Run `run` once against the project at `root`, with empty caches. */
export function runAtProjectRoot<T>(root: string, run: () => T): T {
	return projectAtRoot(root).run(run)
}
