import fs from 'node:fs'
import path from 'node:path'

type J = Record<string, any>

/**
 * Point a package's entry points (`exports`, `imports`, `module`) at its compiled
 * `dist/` instead of its `src/`.
 *
 * In the monorepo every package's `exports` name TypeScript source, which Bun and
 * Vite load directly, so tests, the playground and `tsc` work without a build.
 * Node cannot load that from `node_modules` (it refuses to strip types there), so
 * the published manifest of a compiled package names the JS that `tsc` emitted:
 * `./src/x.ts` becomes `./dist/x.js`, or `./dist/x.d.ts` under `types`.
 *
 * The `workerd` condition keeps the source: a Worker host bundles it with its own
 * build. Targets that are not under `./src/` (`.astro`, `.css`, `package.json`)
 * stay as they are. Every rewritten target has to exist, so an unbuilt package
 * cannot be published by mistake. Returns the targets that are missing.
 */
export function compileExports(json: J, pkgDir: string): string[] {
	const missing: string[] = []
	const rewrite = (target: string, condition: string | undefined): string => {
		const match = /^(?:\.\/)?src\/(.+)\.tsx?$/.exec(target)
		if (!match || condition === 'workerd') return target
		const next = `./dist/${match[1]}${condition === 'types' ? '.d.ts' : '.js'}`
		if (!fs.existsSync(path.join(pkgDir, next))) missing.push(next)
		return next
	}
	const walk = (value: unknown, condition: string | undefined): unknown => {
		if (typeof value === 'string') return rewrite(value, condition)
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([key, inner]) => [key, walk(inner, key.startsWith('.') || key.startsWith('#') ? condition : key)]),
			)
		}
		return value
	}
	if (json.exports !== undefined) json.exports = walk(json.exports, undefined)
	if (json.imports !== undefined) json.imports = walk(json.imports, undefined)
	if (typeof json.module === 'string') json.module = rewrite(json.module, 'import')
	if (typeof json.main === 'string') json.main = rewrite(json.main, 'default')
	if (typeof json.types === 'string') json.types = rewrite(json.types, 'types')
	return missing
}
