// Prints, as JSON, the Node built-ins the module graph of `argv[2]` imports under the conditions
// in `argv[3..]`. Run as its own process by `builtinImportsOf`.
import { builtinModules } from 'node:module'

const [entry, ...conditions] = process.argv.slice(2)
if (entry === undefined) throw new Error('usage: builtin-imports-probe.ts <entry> [condition...]')

const builtins = new Set(builtinModules)
const found = new Set<string>()
const result = await Bun.build({
	entrypoints: [entry],
	target: 'browser',
	conditions,
	throw: false,
	plugins: [{
		name: 'record-builtins',
		setup(build) {
			build.onResolve({ filter: /.*/ }, args => {
				const bare = args.path.replace(/^node:/, '')
				if (!args.path.startsWith('node:') && !builtins.has(bare)) return undefined
				found.add(`node:${bare.split('/')[0]}`)
				return { path: args.path, external: true }
			})
		},
	}],
})
if (!result.success) throw new AggregateError(result.logs, `Bundling ${entry} failed`)
console.log(JSON.stringify([...found].sort()))
