import { runInProjectContext } from './context'
import { createNodeProjectContext } from './default-node'

/**
 * Run `run` against the project at `root` on `node:fs`, whatever the working directory is. For an
 * integration that reads sources on its own: Astro's `config.root` need not be the working directory
 * (`astro build --root site`), and the process default would look in the wrong place. Each call
 * starts with empty caches.
 */
export function runAtProjectRoot<T>(root: string, run: () => T): T {
	return runInProjectContext(createNodeProjectContext(root), run)
}
