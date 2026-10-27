import fs from 'node:fs'
import path from 'node:path'

type J = Record<string, any>

/** Source extensions and the extension tsc gives the emitted JS. */
const EMITTED: Record<string, string> = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs' }
const DECLARATION: Record<string, string> = { '.ts': '.d.ts', '.tsx': '.d.ts', '.mts': '.d.mts', '.cts': '.d.cts' }

/**
 * Point a package's entry points (`exports`, `imports`, `module`, `main`,
 * `types`) at its compiled `dist/` instead of its `src/`.
 *
 * In the monorepo every package's `exports` name TypeScript source, which Bun and
 * Vite load directly, so tests, the playground and `tsc` work without a build.
 * Node cannot load that from `node_modules` (it refuses to strip types there), so
 * the published manifest of a compiled package names the JS that `tsc` emitted:
 * `./src/x.ts` becomes `./dist/x.js`, or `./dist/x.d.ts` under `types`. Every
 * condition is rewritten, `workerd` included, so a Worker host bundles one copy
 * of each module rather than a mix of source and JS.
 *
 * Targets that are not TypeScript under `./src/` (`.astro`, `.css`,
 * `package.json`, a declaration file) stay as they are. Every rewritten target
 * has to exist, so an unbuilt package cannot be published by mistake. Returns
 * the targets that are missing.
 */
export function compileExports(json: J, pkgDir: string): string[] {
	const missing: string[] = []
	const rewrite = (target: string, condition: string | undefined): string => {
		const match = /^(?:\.\/)?src\/(.+?)(\.d)?(\.[mc]?tsx?)$/.exec(target)
		if (!match || match[2]) return target
		const extension = match[3]!
		const next = `./dist/${match[1]}${(condition === 'types' ? DECLARATION : EMITTED)[extension]}`
		if (!fs.existsSync(path.join(pkgDir, next))) missing.push(next)
		return next
	}
	const walk = (value: unknown, condition: string | undefined): unknown => {
		if (typeof value === 'string') return rewrite(value, condition)
		if (Array.isArray(value)) return value.map(inner => walk(inner, condition))
		if (value && typeof value === 'object') {
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
