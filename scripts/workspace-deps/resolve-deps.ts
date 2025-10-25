import fs from 'node:fs'
import path from 'node:path'
import { ledgerPath, packageDir } from './paths'

const ROOT = process.cwd()
const PKGS_DIRS = ['packages'] // add more if needed
const LEDGER = ledgerPath()

function readJSON(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeJSON(p, o) {
	fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n')
}

function collectVersions() {
	const map = new Map()
	for (const dir of PKGS_DIRS) {
		const abs = path.join(ROOT, dir)
		if (!fs.existsSync(abs)) continue
		for (const entry of fs.readdirSync(abs)) {
			const pkgPath = path.join(abs, entry, 'package.json')
			if (!fs.existsSync(pkgPath)) continue
			const json = readJSON(pkgPath)
			if (json.name && json.version) map.set(json.name, json.version)
		}
	}
	return map
}

function rewriteFields(json, versions) {
	for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		const deps = json[field]
		if (!deps) continue
		for (const [name, range] of Object.entries(deps)) {
			if (!String(range).startsWith('workspace:')) continue
			const v = versions.get(name)
			if (!v) continue // external dep
			const tag = String(range).slice('workspace:'.length) // "*", "^", "~", or exact
			let newRange = v
			if (tag === '^') newRange = `^${v}`
			else if (tag === '~') newRange = `~${v}`
			// "workspace:*" or "workspace:" -> exact
			deps[name] = newRange
		}
	}
}

const versions = collectVersions()

// Determine which package is being packed:
// npm sets INIT_CWD to the original cwd; during (pre)pack it equals the package dir.
const pkgFile = path.join(packageDir, 'package.json')
const pkgJson = readJSON(pkgFile)

// Save original for restore
const entry = { p: pkgFile, content: fs.readFileSync(pkgFile, 'utf8') }
let ledger = []
if (fs.existsSync(LEDGER)) ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
ledger.push(entry)
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))

// Rewrite this manifest
rewriteFields(pkgJson, versions)
writeJSON(pkgFile, pkgJson)
