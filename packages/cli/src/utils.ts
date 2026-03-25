import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_NAMES = [
	'astro.config.ts',
	'astro.config.mts',
	'astro.config.mjs',
	'astro.config.js',
]

export function findAstroConfig(cwd: string = process.cwd()): string | null {
	for (const name of CONFIG_NAMES) {
		const p = join(cwd, name)
		if (existsSync(p)) return p
	}
	return null
}
