import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The directory of the nearest `package.json` above a module: this package's root,
 * whether the module runs from `src/` (the monorepo) or from the published `dist/`.
 * Pass `import.meta.url`.
 */
export function packageRoot(moduleUrl: string): string {
	let dir = dirname(fileURLToPath(moduleUrl))
	while (!existsSync(join(dir, 'package.json'))) {
		const parent = dirname(dir)
		if (parent === dir) throw new Error(`No package.json above ${fileURLToPath(moduleUrl)}`)
		dir = parent
	}
	return dir
}
