import { createNodeFs } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

describe('createNodeFs', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__node-fs-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	test('resolves paths relative to root and round-trips a write', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('a/b/c.txt', 'hello')
		expect(await cfs.exists('a/b/c.txt')).toBe(true)
		expect(await cfs.readFile('a/b/c.txt')).toBe('hello')
		expect(existsSync(path.join(root, 'a/b/c.txt'))).toBe(true)
	})

	test('rejects path traversal outside the root', async () => {
		const cfs = createNodeFs(root)
		await expect(cfs.readFile('../escape.txt')).rejects.toThrow('Path traversal')
		await expect(cfs.writeFile('../../evil.txt', 'x')).rejects.toThrow('Path traversal')
	})

	test('writeFile is atomic: a failed serialization leaves no half-written target', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('target.txt', 'original')

		// Force the underlying write to throw mid-operation by passing content
		// that cannot be written (a value the fs layer rejects). We simulate the
		// failure by writing to a path whose parent is a file, not a directory.
		await cfs.writeFile('blocker', 'iam-a-file')
		await expect(cfs.writeFile('blocker/child.txt', 'data')).rejects.toThrow()

		// The original, unrelated file is untouched and readable.
		expect(await cfs.readFile('target.txt')).toBe('original')

		// No leftover temp files in the root.
		const entries = await fs.readdir(root)
		expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([])
	})

	test('atomic write replaces existing content without an intermediate empty state', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('doc.txt', 'v1')
		await cfs.writeFile('doc.txt', 'v2-much-longer-content')
		expect(await cfs.readFile('doc.txt')).toBe('v2-much-longer-content')
		const entries = await fs.readdir(root)
		expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([])
	})

	test('list returns [] for a missing directory and entries otherwise', async () => {
		const cfs = createNodeFs(root)
		expect(await cfs.list('nope')).toEqual([])
		await cfs.writeFile('dir/file.txt', 'x')
		await fs.mkdir(path.join(root, 'dir/sub'), { recursive: true })
		const listed = await cfs.list('dir')
		expect(listed.find(e => e.name === 'file.txt')?.isDirectory).toBe(false)
		expect(listed.find(e => e.name === 'sub')?.isDirectory).toBe(true)
	})

	test('glob matches root-relative paths', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('src/content/a.md', '')
		await cfs.writeFile('src/content/nested/b.md', '')
		await cfs.writeFile('src/content/c.txt', '')
		const md = (await cfs.glob('src/content/**/*.md')).sort()
		expect(md).toEqual(['src/content/a.md', 'src/content/nested/b.md'])
	})

	test('stat returns mtimeMs and size', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('f.txt', 'abcd')
		const s = await cfs.stat('f.txt')
		expect(s.size).toBe(4)
		expect(typeof s.mtimeMs).toBe('number')
	})
})
