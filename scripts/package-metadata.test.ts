import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

// npm links a package's Homepage and Repository to these fields, so a path that is not the
// package's own directory (left over from a rename) is a dead link on npmjs.com.

const packagesDir = path.join(import.meta.dir, '..', 'packages')
const REPO_BLOB = 'https://github.com/nuasite/nuasite/blob/main'

interface PublishedMetadata {
	name: string
	homepage: string | undefined
	directory: string | undefined
}

function readMetadata(dir: string): PublishedMetadata | null {
	const parsed: unknown = JSON.parse(fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf-8'))
	if (typeof parsed !== 'object' || parsed === null) throw new Error(`packages/${dir}/package.json is not an object`)
	if ('private' in parsed && parsed.private === true) return null
	const name = 'name' in parsed && typeof parsed.name === 'string' ? parsed.name : dir
	const homepage = 'homepage' in parsed && typeof parsed.homepage === 'string' ? parsed.homepage : undefined
	const repository = 'repository' in parsed ? parsed.repository : undefined
	const directory = typeof repository === 'object' && repository !== null && 'directory' in repository && typeof repository.directory === 'string'
		? repository.directory
		: undefined
	return { name, homepage, directory }
}

const published = fs.readdirSync(packagesDir, { withFileTypes: true })
	.filter(entry => entry.isDirectory() && fs.existsSync(path.join(packagesDir, entry.name, 'package.json')))
	.flatMap(entry => {
		const metadata = readMetadata(entry.name)
		return metadata ? [{ dir: entry.name, ...metadata }] : []
	})

describe('package metadata', () => {
	test.each(published)('$name points at its own directory', ({ dir, homepage, directory }) => {
		expect(directory).toBe(`packages/${dir}`)
		if (homepage !== undefined) expect(homepage).toBe(`${REPO_BLOB}/packages/${dir}/README.md`)
	})
})
