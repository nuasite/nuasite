import glob from 'fast-glob'
import * as fs from 'node:fs/promises'

const dependencySectionKeys = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
	'resolutions',
	'overrides',
] as const

type DependencySectionKey = typeof dependencySectionKeys[number]
type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const rewriteWorkspaceValue = (value: unknown, version: string): { changed: boolean; value: unknown } => {
	if (typeof value === 'string') {
		if (value.startsWith('workspace:')) {
			return { changed: true, value: version }
		}
		return { changed: false, value }
	}

	if (Array.isArray(value)) {
		let changed = false
		const next = value.map(item => {
			const rewritten = rewriteWorkspaceValue(item, version)
			if (rewritten.changed) {
				changed = true
			}
			return rewritten.value
		})
		return changed ? { changed: true, value: next } : { changed: false, value }
	}

	if (isRecord(value)) {
		const rewritten = rewriteWorkspaceRecord(value, version)
		return rewritten.changed ? { changed: true, value: rewritten.value } : { changed: false, value }
	}

	return { changed: false, value }
}

const rewriteWorkspaceRecord = (record: JsonRecord, version: string): { changed: boolean; value: JsonRecord } => {
	let changed = false
	const next: JsonRecord = {}

	for (const [key, originalValue] of Object.entries(record)) {
		const rewritten = rewriteWorkspaceValue(originalValue, version)
		if (rewritten.changed) {
			changed = true
		}
		next[key] = rewritten.value
	}

	return changed ? { changed: true, value: next } : { changed: false, value: record }
}

const rewriteDependencySections = (packageJson: JsonRecord, version: string): JsonRecord => {
	const nextPackageJson: JsonRecord = { ...packageJson, version }

	for (const section of dependencySectionKeys) {
		const sectionValue = packageJson[section as DependencySectionKey]
		if (!isRecord(sectionValue)) {
			continue
		}
		const rewritten = rewriteWorkspaceRecord(sectionValue, version)
		if (rewritten.changed) {
			nextPackageJson[section as DependencySectionKey] = rewritten.value
		}
	}

	return nextPackageJson
}

;(async () => {
	const cwd = process.cwd()
	const version = process.argv[2]
	const dirs = [cwd, ...await glob(process.cwd() + '/packages/*', { onlyDirectories: true })]

	await Promise.all(dirs.map(async (dir): Promise<void> => {
		const packageJsonPath = `${dir}/package.json`
		try {
			await fs.access(packageJsonPath)
		} catch {
			return
		}
		try {
			const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as JsonRecord
			const newPackageJson = rewriteDependencySections(packageJson, version)
			await fs.writeFile(packageJsonPath, JSON.stringify(newPackageJson, null, '	') + '\n', 'utf8')
		} catch (e) {
			console.log(dir)
			throw e
		}
	}))
})().catch(e => {
	console.error(e)
	process.exit(1)
})
