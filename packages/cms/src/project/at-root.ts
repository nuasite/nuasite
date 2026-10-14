import { parse } from '@astrojs/compiler'
import { createNodeFs } from '@nuasite/cms-core'
import { createProjectContext, runInProjectContext } from './context'

/**
 * Run `run` against the project at `root` on `node:fs`, whatever the working directory is. For an
 * integration that reads sources after the build: Astro's `config.root` need not be the working
 * directory (`astro build --root site`), and the process default would look in the wrong place.
 */
export function runAtProjectRoot<T>(root: string, run: () => T): T {
	return runInProjectContext(createProjectContext({ root, fs: createNodeFs(root), parseAstro: parse }), run)
}
