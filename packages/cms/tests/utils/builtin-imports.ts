import { builtinModules } from 'node:module'

const BUILTINS = new Set(builtinModules)

/**
 * The Node built-ins the module graphs of `entries` import, resolved under `conditions` the way a
 * Worker bundler would. Every import statement counts, used or not, since a host that vendors the
 * graph module by module loads them all. One build for all entries: consecutive `Bun.build` calls
 * in one test process intermittently fail to read workspace sources.
 */
export async function builtinImportsOf(entries: string[], conditions: string[]): Promise<string[]> {
	const found = new Set<string>()
	const result = await Bun.build({
		entrypoints: entries,
		target: 'browser',
		conditions,
		throw: false,
		plugins: [{
			name: 'record-builtins',
			setup(build) {
				build.onResolve({ filter: /.*/ }, args => {
					const bare = args.path.replace(/^node:/, '')
					if (!args.path.startsWith('node:') && !BUILTINS.has(bare)) return undefined
					found.add(`node:${bare.split('/')[0]}`)
					return { path: args.path, external: true }
				})
			},
		}],
	})
	if (!result.success) throw new AggregateError(result.logs, `Bundling ${entries.join(', ')} failed`)
	return [...found].sort()
}
