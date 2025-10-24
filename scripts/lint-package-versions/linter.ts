import yaml from 'js-yaml'
import fs from 'node:fs'

const file = fs.readFileSync('yarn.lock', 'utf8')
const json = yaml.load(file) as any

const whitelist = ['lodash']
const versions = {}

for (const key in json) {
	if (key === '__metadata') {
		continue
	}

	const match = key.match(/((@[^/]+\/)?([^@]+))@/)
	if (!match) {
		throw key
	}
	const pkgName = match[1]
	const version = json[key].version

	if (!versions[pkgName]) {
		versions[pkgName] = new Set()
	}
	versions[pkgName].add(version)
}

let ok = true
for (const pkg in versions) {
	if (versions[pkg].size > 1 && !whitelist.includes(pkg)) {
		console.error(`Multiple versions found for ${pkg} which is not whitelisted: ${Array.from(versions[pkg]).join(', ')}`)
		ok = false
	}
}

if (!ok) {
	process.exit(1)
}
