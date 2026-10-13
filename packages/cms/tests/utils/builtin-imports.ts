import path from 'node:path'

const PROBE = path.join(import.meta.dir, 'builtin-imports-probe.ts')

/**
 * The Node built-ins the module graph of `entry` imports, resolved under `conditions` the way a
 * Worker bundler would. Every import statement counts, used or not, since a host that vendors the
 * graph module by module loads them all. Each call bundles in a process of its own: a second
 * `Bun.build` in one process fails to read workspace sources the first one read.
 */
export async function builtinImportsOf(entry: string, conditions: string[]): Promise<string[]> {
	const probe = Bun.spawn([process.execPath, PROBE, entry, ...conditions], { stdout: 'pipe', stderr: 'pipe' })
	const [output, errors, exitCode] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited])
	if (exitCode !== 0) throw new Error(`Probing ${entry} failed: ${errors}`)
	const builtins: unknown = JSON.parse(output)
	if (!Array.isArray(builtins) || !builtins.every(item => typeof item === 'string')) throw new Error(`Unexpected probe output: ${output}`)
	return builtins
}
