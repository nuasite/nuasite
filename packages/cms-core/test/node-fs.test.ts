import { createNodeFs, globMayMatchUnder } from '@nuasite/cms-core'
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

	test('glob takes a directory that is not there for an empty one', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('src/data/file.md', '')
		expect(await cfs.glob('src/nope/**/*.md')).toEqual([])
		// A file where the pattern expects a directory.
		expect(await cfs.glob('src/data/file.md/*.md')).toEqual([])
	})

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('glob rejects for a directory it cannot read instead of passing it for empty', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('src/data/a.md', '')
		await cfs.writeFile('src/data/2024/b.md', '')
		const locked = path.join(root, 'src/data/2024')
		await fs.chmod(locked, 0o000)
		try {
			// The directory is named relative to the root; the absolute path stays out of the message.
			const failure = await cfs.glob('src/data/**/*.md').then(() => null, (error: Error) => error.message)
			expect(failure).toBe('Cannot read directory "src/data/2024" (EACCES)')
		} finally {
			await fs.chmod(locked, 0o755)
		}
	})

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('glob passes over an unreadable directory its pattern cannot reach into', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('site/blog/a.md', '')
		await cfs.writeFile('node_modules/.cache/x/y.md', '')
		const locked = path.join(root, 'node_modules/.cache')
		await fs.chmod(locked, 0o000)
		try {
			// Two levels deep is as far as this pattern goes, and `.cache` is not `blog`.
			expect(await cfs.glob('*/blog/*.md')).toEqual(['site/blog/a.md'])
			// This one could match anywhere below, so what it cannot read it cannot answer for.
			await expect(cfs.glob('**/blog/*.md')).rejects.toThrow('Cannot read directory "node_modules/.cache" (EACCES)')
		} finally {
			await fs.chmod(locked, 0o755)
		}
	})

	test('globMayMatchUnder rules a directory out only when no match can run through it', () => {
		const cases: Array<[glob: string, dir: string, expected: boolean]> = [
			['src/data/*.md', 'src/data', true],
			['src/data/*.md', 'src', true],
			['src/data/*.md', 'src/data/2024', false],
			['src/data/*.md', 'src/other', false],
			// The last segment names a file: a directory it happens to match has nothing below for it.
			['src/*', 'src/x', false],
			['*.md', 'notes.md', false],
			['./src/data/*.md', 'src/data', true],
			['*/blog/*.md', 'site', true],
			['*/blog/*.md', 'site/blog', true],
			['*/blog/*.md', 'site/news', false],
			['*/blog/*.md', 'site/blog/2024', false],
			['{en,cs}/*/index.md', 'cs/post', true],
			['{en,cs}/*/index.md', 'de/post', false],
			// `**` runs through anything, wherever it stands in its segment.
			['**/blog/*.md', 'node_modules/.cache', true],
			['src/**', 'src/a/b/c', true],
			['src/a**/x.md', 'src/b/c', true],
			// A brace across a slash is not split into segments, so nothing is ruled out.
			['{en/*,cs/**/*}.md', 'de/x', true],
			['*.md', '.', true],
		]
		for (const [glob, dir, expected] of cases) expect([glob, dir, globMayMatchUnder(glob, dir)]).toEqual([glob, dir, expected])
	})

	test('stat returns mtimeMs and size', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('f.txt', 'abcd')
		const s = await cfs.stat('f.txt')
		expect(s.size).toBe(4)
		expect(typeof s.mtimeMs).toBe('number')
	})
})
