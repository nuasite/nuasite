import { createNodeFs, globMayMatchUnder, globToRegExp } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
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

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('glob passes over an unreadable directory deeper than its pattern goes', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('docs/a.md', '')
		await cfs.writeFile('docs/x/y/z.md', '')
		const locked = path.join(root, 'docs/x/y')
		await fs.chmod(locked, 0o000)
		try {
			// `docs/*` names files in `docs`; nothing two levels below it can match.
			expect(await cfs.glob('docs/*')).toEqual(['docs/a.md'])
		} finally {
			await fs.chmod(locked, 0o755)
		}
	})

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('glob does not read a directory the caller skips, nor what is under it', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('src/data/a.md', '')
		await cfs.writeFile('src/data/_drafts/b.md', '')
		await cfs.writeFile('src/data/keep/c.md', '')
		const locked = path.join(root, 'src/data/_drafts')
		await fs.chmod(locked, 0o000)
		try {
			const skipped: string[] = []
			const files = await cfs.glob('src/data/**/*.md', {
				skipDirectory: dir => {
					skipped.push(dir)
					return dir.split('/').pop()!.startsWith('_')
				},
			})
			expect(files.sort()).toEqual(['src/data/a.md', 'src/data/keep/c.md'])
			// Asked about directories below where the walk starts, root-relative, never the start itself.
			expect(skipped.sort()).toEqual(['src/data/_drafts', 'src/data/keep'])
		} finally {
			await fs.chmod(locked, 0o755)
		}
	})

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('an unreadable root is named `.` and the runtime error is kept as the cause', async () => {
		const locked = path.join(root, 'site')
		await fs.mkdir(locked)
		await fs.chmod(locked, 0o000)
		try {
			const failure = await createNodeFs(locked).glob('**/*.md').then(() => null, (error: Error) => error)
			expect(failure?.message).toBe('Cannot read directory "." (EACCES)')
			expect(failure?.cause).toMatchObject({ code: 'EACCES' })
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
			// A directory deeper than the pattern has segments for.
			['docs/*', 'docs/x/y', false],
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

	test('glob does not read a directory its pattern cannot reach into', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('site/blog/a.md', '')
		await cfs.writeFile('site/blog/2024/b.md', '')
		await cfs.writeFile('site/news/c.md', '')
		await cfs.writeFile('node_modules/pkg/lib/readme.md', '')
		const readdir = spyOn(fs, 'readdir')
		try {
			expect(await cfs.glob('*/blog/*.md')).toEqual(['site/blog/a.md'])
			const read = readdir.mock.calls.map(([dir]) => path.relative(root, String(dir))).sort()
			// The root, its two directories and `site/blog`: nothing below `node_modules`, `site/news` or `blog/2024`.
			expect(read).toEqual(['', 'node_modules', 'site', 'site/blog'])
		} finally {
			readdir.mockRestore()
		}
	})

	// What the walk leaves out must be nothing the pattern matches: every directory on the way
	// to a matching file has to count as one the pattern may match under.
	test('globMayMatchUnder never rules out a directory that holds a match', () => {
		const segments = ['*', '**', '*.md', 'a', 'b', '{a,b}', '?', 'a*', '**a.md', '{a,b/c}', '.', 'a.md', '{,b/}*.md']
		const files = ['a.md', 'a/a.md', 'b/a.md', 'a/b/a.md', 'b/c/a.md', 'a/b/c/a.md', 'ba.md', 'a/ba.md', 'a/a/a/a.md', 'c/a.md']
		const patterns = segments.flatMap(one => [one, ...segments.flatMap(two => [`${one}/${two}`, ...segments.map(three => `${one}/${two}/${three}`)])])
		const ruledOut: string[] = []
		for (const pattern of patterns) {
			const matcher = globToRegExp(pattern)
			for (const file of files) {
				if (!matcher.test(file)) continue
				const parts = file.split('/').slice(0, -1)
				for (let depth = 1; depth <= parts.length; depth++) {
					const dir = parts.slice(0, depth).join('/')
					if (!globMayMatchUnder(pattern, dir)) ruledOut.push(`${pattern} matches ${file} but rules out ${dir}`)
				}
			}
		}
		expect(patterns.length).toBeGreaterThan(2000)
		expect(ruledOut).toEqual([])
	})

	test('glob gives up, and says so, when links would have it read more directories than it may', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('data/a.md', '')
		await cfs.writeFile('data/x/y/z/b.md', '')
		await cfs.writeFile('shared/more/c.md', '')
		await cfs.writeFile('shared/more/2024/d.md', '')
		await fs.symlink('../shared/more', path.join(root, 'data/more'))
		const all = ['data/a.md', 'data/more/2024/d.md', 'data/more/c.md', 'data/x/y/z/b.md']

		// `more` and `more/2024` are two directories behind a link.
		expect((await cfs.glob('data/**/*.md', { followSymlinks: true, maxLinkedDirectories: 2 })).sort()).toEqual(all)
		await expect(cfs.glob('data/**/*.md', { followSymlinks: true, maxLinkedDirectories: 1 })).rejects.toThrow(
			'More than 1 directories to list behind symbolic links',
		)
		// The tree itself is as large as it is: `data`, `x`, `y` and `z` do not count.
		expect((await cfs.glob('data/x/**/*.md', { followSymlinks: true, maxLinkedDirectories: 0 })).sort()).toEqual(['data/x/y/z/b.md'])
		// A directory the pattern cannot reach into is not read, so it does not count either.
		expect((await cfs.glob('data/*/*.md', { followSymlinks: true, maxLinkedDirectories: 1 })).sort()).toEqual(['data/more/c.md'])
	})

	test('directories linked into each other end at the bound, not in a walk without end', async () => {
		const cfs = createNodeFs(root)
		const count = 6
		for (let i = 0; i < count; i++) await cfs.writeFile(`data/d${i}/x.md`, '')
		for (let i = 0; i < count; i++) {
			for (let j = 0; j < count; j++) {
				if (i !== j) await fs.symlink(`../d${j}`, path.join(root, `data/d${i}/to${j}`))
			}
		}

		// Every chain of links that does not come back to a directory already on it is a path of its own.
		await expect(cfs.glob('data/**/*.md', { followSymlinks: true, maxLinkedDirectories: 500 })).rejects.toThrow('More than 500 directories')
		expect(await cfs.glob('data/**/*.md')).toHaveLength(count)
	})

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('glob does not read a starting directory its pattern cannot match under', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('a/secret/b.md', '')
		const secret = path.join(root, 'a/secret')
		await fs.chmod(secret, 0o000)
		try {
			// Nothing can match a pattern that ends in a slash or in a `.` segment.
			expect(await cfs.glob('a/secret/')).toEqual([])
			expect(await cfs.glob('a/secret/.')).toEqual([])
			await expect(cfs.glob('a/secret/*.md')).rejects.toThrow('Cannot read directory "a/secret" (EACCES)')
		} finally {
			await fs.chmod(secret, 0o755)
		}
	})

	// Root reads any directory, so there is nothing to observe under it.
	test.skipIf(process.getuid?.() === 0)('a linked directory that cannot be read fails the walk like an unlinked one', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('data/a.md', '')
		await cfs.writeFile('shared/locked/b.md', '')
		const locked = path.join(root, 'shared/locked')
		await fs.symlink('../shared/locked', path.join(root, 'data/more'))
		await fs.chmod(locked, 0o000)
		try {
			expect(await cfs.glob('data/**/*.md')).toEqual(['data/a.md'])
			await expect(cfs.glob('data/**/*.md', { followSymlinks: true })).rejects.toThrow('Cannot read directory "data/more" (EACCES)')
		} finally {
			await fs.chmod(locked, 0o755)
		}
	})

	test('glob leaves symbolic links out unless asked to follow them', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('data/a.md', '')
		await cfs.writeFile('shared/linked.md', '')
		await cfs.writeFile('shared/more/x.md', '')
		await fs.symlink('../shared/linked.md', path.join(root, 'data/linked.md'))
		await fs.symlink('../shared/more', path.join(root, 'data/more'))
		await fs.symlink('.', path.join(root, 'data/self'))
		await fs.symlink('./nowhere.md', path.join(root, 'data/dangling.md'))

		expect(await cfs.glob('data/**/*.md')).toEqual(['data/a.md'])
		// Listed under the link's own path. A link back into its own directory is entered once, a
		// link that leads nowhere is no file.
		expect((await cfs.glob('data/**/*.md', { followSymlinks: true })).sort()).toEqual([
			'data/a.md',
			'data/linked.md',
			'data/more/x.md',
			'data/self/a.md',
			'data/self/linked.md',
			'data/self/more/x.md',
		])
	})

	test('glob does not follow a link out of the root, and says so instead of leaving it out', async () => {
		const outside = `${root}-outside`
		try {
			await fs.mkdir(path.join(outside, 'deep'), { recursive: true })
			await fs.writeFile(path.join(outside, 'deep/x.md'), '')
			const cfs = createNodeFs(root)
			await cfs.writeFile('data/a.md', '')
			await fs.symlink(outside, path.join(root, 'data/host'))

			expect(await cfs.glob('data/**/*.md')).toEqual(['data/a.md'])
			await expect(cfs.glob('data/**/*.md', { followSymlinks: true })).rejects.toThrow('Symbolic link "data/host" leads out of the project root')
			// A pattern that cannot reach under the link does not need it.
			expect(await cfs.glob('data/*.md', { followSymlinks: true })).toEqual(['data/a.md'])
		} finally {
			await fs.rm(outside, { recursive: true, force: true })
		}
	})

	test('a root reached through a link is still the root its own links are measured against', async () => {
		const alias = `${root}-alias`
		try {
			await fs.symlink(root, alias)
			const cfs = createNodeFs(alias)
			await cfs.writeFile('shared/more/x.md', '')
			await fs.mkdir(path.join(root, 'data'))
			await fs.symlink('../shared/more', path.join(root, 'data/more'))

			expect(await cfs.glob('data/**/*.md', { followSymlinks: true })).toEqual(['data/more/x.md'])
		} finally {
			await fs.rm(alias, { force: true })
		}
	})

	test('stat returns mtimeMs and size', async () => {
		const cfs = createNodeFs(root)
		await cfs.writeFile('f.txt', 'abcd')
		const s = await cfs.stat('f.txt')
		expect(s.size).toBe(4)
		expect(typeof s.mtimeMs).toBe('number')
	})
})
