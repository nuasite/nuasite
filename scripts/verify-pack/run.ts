// Packs every publishable package the way the publish workflow does, installs the
// tarballs into a throwaway project, and imports every entry point of the
// compiled packages with plain Node. Node is what an installed site's Astro runs
// on, and it cannot load TypeScript from node_modules, so a package whose
// published entry points still name src/ fails here instead of on a site.
//
// Run after `bun run build`: `bun scripts/verify-pack/run.ts`.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nuasite-verify-pack-'))
const tarballs = path.join(work, 'tarballs')
const site = path.join(work, 'site')
fs.mkdirSync(tarballs)
fs.mkdirSync(site)

const run = (command: string, args: string[], cwd: string) => {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`)
	}
	return result.stdout
}

type Manifest = { name: string; private?: boolean; scripts?: Record<string, string>; exports?: unknown }

function verify(): number {
	const packed: Array<{ name: string; tarball: string; compiled: boolean }> = []
	for (const entry of fs.readdirSync(path.join(root, 'packages'))) {
		const dir = path.join(root, 'packages', entry)
		const manifestPath = path.join(dir, 'package.json')
		if (!fs.existsSync(manifestPath)) continue
		const original = fs.readFileSync(manifestPath, 'utf8')
		const manifest = JSON.parse(original) as Manifest
		if (manifest.private) continue
		try {
			// npm, not bun: publishing runs `npm publish`, so this packs the same way.
			// prepack rewrites package.json in place; the original is put back afterwards.
			// The tarball is found by what appeared: a prepack build prints to stdout too.
			const before = new Set(fs.readdirSync(tarballs))
			run('npm', ['pack', '--pack-destination', tarballs], dir)
			const filename = fs.readdirSync(tarballs).find(f => !before.has(f))
			if (!filename) throw new Error(`npm pack produced no tarball for ${manifest.name}`)
			packed.push({
				name: manifest.name,
				tarball: path.join(tarballs, filename),
				compiled: manifest.scripts?.prepack?.includes('--compiled-exports') ?? false,
			})
		} finally {
			fs.writeFileSync(manifestPath, original)
			// resolve-deps.ts backs the manifest up here; the original is already back.
			fs.rmSync(path.join(os.tmpdir(), 'ws-ledgers', `${Buffer.from(dir).toString('base64url')}.json`), { force: true })
		}
	}

	const tarballOf = Object.fromEntries(packed.map(p => [p.name, `file:${p.tarball}`]))
	const compiled = packed.filter(p => p.compiled)
	fs.writeFileSync(
		path.join(site, 'package.json'),
		JSON.stringify(
			{
				name: 'verify-pack',
				private: true,
				type: 'module',
				dependencies: Object.fromEntries(compiled.map(p => [p.name, tarballOf[p.name]])),
				overrides: tarballOf,
			},
			null,
			2,
		),
	)
	run('bun', ['install'], site)

	// Every subpath of a compiled package that Node would load as code: anything but
	// package.json, stylesheets and .astro components.
	const specifiers: string[] = []
	for (const { name } of compiled) {
		const manifest = JSON.parse(fs.readFileSync(path.join(site, 'node_modules', name, 'package.json'), 'utf8')) as Manifest
		const exports = manifest.exports as Record<string, unknown> | undefined
		for (const [subpath, target] of Object.entries(exports ?? {})) {
			const conditions = target && typeof target === 'object' ? target as Record<string, unknown> : undefined
			const nodeTarget = typeof target === 'string' ? target : conditions?.import ?? conditions?.default
			if (typeof nodeTarget !== 'string') continue
			if (/\.(json|css|astro)$/.test(nodeTarget)) continue
			specifiers.push(subpath === '.' ? name : `${name}/${subpath.slice(2)}`)
		}
	}

	const failures: string[] = []
	for (const specifier of specifiers) {
		const result = spawnSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], { cwd: site, encoding: 'utf8' })
		if (result.status === 0) {
			console.log(`ok    ${specifier}`)
		} else {
			failures.push(specifier)
			console.log(`FAIL  ${specifier}\n${result.stderr.split('\n').slice(0, 6).join('\n')}`)
		}
	}

	if (specifiers.length === 0) {
		console.error('No entry points to check: no package was packed with --compiled-exports')
		return 1
	}
	if (failures.length) {
		console.error(`\n${failures.length} of ${specifiers.length} entry points failed to load under Node`)
		return 1
	}
	console.log(`\nAll ${specifiers.length} entry points of ${compiled.length} compiled packages load under Node`)
	return 0
}

let code = 1
try {
	code = verify()
} finally {
	// The throwaway project holds a full node_modules; it goes whether the run passed or not.
	fs.rmSync(work, { recursive: true, force: true })
}
process.exit(code)
