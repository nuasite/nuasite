import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type J = Record<string, any>
const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const pkgDir = process.cwd()
const pkgFile = path.join(pkgDir, 'package.json')

const readJSON = (p: string): J => {
	return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const hasWorkspaces = (dir: string) => {
	try {
		const j = readJSON(path.join(dir, 'package.json'))
		return !!j.workspaces
	} catch {
		return false
	}
}

const findRepoRoot = (start: string) => {
	let d = start
	for (;;) {
		if (fs.existsSync(path.join(d, 'pnpm-workspace.yaml')) || hasWorkspaces(d) || fs.existsSync(path.join(d, '.git'))) return d
		const p = path.dirname(d)
		if (p === d) return start
		d = p
	}
}

const listWorkspacePackageDirs = (root: string) => {
	const out = new Set<string>()
	try {
		const j = readJSON(path.join(root, 'package.json'))
		const ws = (j.workspaces?.packages ?? j.workspaces) as string[] | undefined
		if (Array.isArray(ws)) {
			for (const pat of ws) {
				if (!pat.endsWith('/*')) continue
				const base = path.join(root, pat.slice(0, -2))
				if (!fs.existsSync(base)) continue
				for (const e of fs.readdirSync(base)) {
					const d = path.join(base, e)
					if (fs.existsSync(path.join(d, 'package.json'))) out.add(d)
				}
			}
		}
	} catch {}
	// simple fallbacks
	for (const base of ['packages', 'apps']) {
		const b = path.join(root, base)
		if (!fs.existsSync(b)) continue
		for (const e of fs.readdirSync(b)) {
			const d = path.join(b, e)
			if (fs.existsSync(path.join(d, 'package.json'))) out.add(d)
		}
	}
	return [...out]
}

const collectVersions = (root: string) => {
	const map = new Map<string, string>()
	for (const d of listWorkspacePackageDirs(root)) {
		try {
			const j = readJSON(path.join(d, 'package.json'))
			if (j.name && j.version) map.set(j.name, String(j.version))
		} catch {}
	}
	return map
}

const collectCatalogs = (root: string) => {
	const catalogs = new Map<string, Map<string, string>>()
	try {
		const j = readJSON(path.join(root, 'package.json'))
		const ws = j.workspaces
		if (!ws) return catalogs

		// default catalog
		if (ws.catalog && typeof ws.catalog === 'object') {
			const defaultCatalog = new Map<string, string>()
			for (const [name, version] of Object.entries(ws.catalog)) {
				defaultCatalog.set(name, String(version))
			}
			catalogs.set('', defaultCatalog)
		}

		// named catalogs
		if (ws.catalogs && typeof ws.catalogs === 'object') {
			for (const [catalogName, catalogEntries] of Object.entries(ws.catalogs)) {
				if (typeof catalogEntries === 'object') {
					const catalog = new Map<string, string>()
					for (const [name, version] of Object.entries(catalogEntries as Record<string, any>)) {
						catalog.set(name, String(version))
					}
					catalogs.set(catalogName, catalog)
				}
			}
		}
	} catch {}
	return catalogs
}

const rewriteManifest = (pkgFile: string, versions: Map<string, string>, catalogs: Map<string, Map<string, string>>) => {
	const json = readJSON(pkgFile)
	const unresolved: string[] = []
	for (const f of FIELDS) {
		const deps = json[f]
		if (!deps) continue
		for (const [name, range] of Object.entries(deps)) {
			const r = String(range)

			// Handle workspace: dependencies
			if (r.startsWith('workspace:')) {
				const v = versions.get(name)
				if (!v) {
					unresolved.push(`${f}:${name}`)
					continue
				}
				const tag = r.slice('workspace:'.length) // "", "*", "^", "~"
				;(deps as any)[name] = tag === '^' ? `^${v}` : tag === '~' ? `~${v}` : v // exact for "" or "*"
				continue
			}

			// Handle catalog: dependencies
			if (r.startsWith('catalog:')) {
				const catalogName = r.slice('catalog:'.length) // "", "*", or catalog name like "build"
				const actualCatalogName = (catalogName === '' || catalogName === '*') ? '' : catalogName
				const catalog = catalogs.get(actualCatalogName)
				if (!catalog) {
					unresolved.push(`${f}:${name} (catalog '${actualCatalogName}' not found)`)
					continue
				}
				const v = catalog.get(name)
				if (!v) {
					unresolved.push(`${f}:${name} (not found in catalog '${actualCatalogName}')`)
					continue
				}
				;(deps as any)[name] = v
			}
		}
	}
	fs.writeFileSync(pkgFile, JSON.stringify(json, null, 2) + '\n')
	return unresolved
}

// main
const repoRoot = findRepoRoot(pkgDir)
const versions = collectVersions(repoRoot)
const catalogs = collectCatalogs(repoRoot)

// backup to OS temp so it never leaks into tarball
const ledgerDir = path.join(os.tmpdir(), 'ws-ledgers')
fs.mkdirSync(ledgerDir, { recursive: true })
const ledgerPath = path.join(ledgerDir, Buffer.from(pkgDir).toString('base64url') + '.json')
fs.writeFileSync(ledgerPath, fs.readFileSync(pkgFile, 'utf8'))

const unresolved = rewriteManifest(pkgFile, versions, catalogs)

// fail-fast if any workspace or catalog remains
const after = fs.readFileSync(pkgFile, 'utf8')
if (/\"workspace:/.test(after) || /"catalog:/.test(after) || unresolved.length) {
	console.error(`[workspace-deps] FAILED in ${path.basename(pkgDir)} | root=${repoRoot} | versions=${versions.size} | catalogs=${catalogs.size}`)
	if (unresolved.length) console.error(`unresolved: ${unresolved.join(', ')}`)
	process.exit(1)
} else {
	console.error(`[workspace-deps] OK in ${path.basename(pkgDir)}`)
}
