import { CmsCommitConflictError, commitChangeset, createCmsCore, createNodeFs, createStagedFileSystem, digestBytes } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

let root: string

beforeEach(async () => {
	root = path.join(import.meta.dir, `__staged-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
	await fs.mkdir(path.join(root, 'src/content/blog'), { recursive: true })
	await fs.writeFile(path.join(root, 'src/content/blog/hello.md'), '---\ntitle: Hello\n---\nBody\n')
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

describe('createStagedFileSystem', () => {
	test('keeps writes in memory and shows them to its own reads, listings and globs', async () => {
		const base = createNodeFs(root)
		const staged = createStagedFileSystem(base)
		await staged.writeFile('/src/content/blog/new.md', 'new')
		await staged.writeBytes('public/uploads/a.png', new Uint8Array([1, 2, 3]))
		await staged.remove('src/content/blog/hello.md')

		expect(await staged.readFile('src/content/blog/new.md')).toBe('new')
		expect(await staged.readBytes('./public/uploads/a.png')).toEqual(new Uint8Array([1, 2, 3]))
		expect(await staged.exists('src/content/blog/hello.md')).toBe(false)
		expect(await staged.exists('public/uploads')).toBe(true)
		expect(await staged.list('src/content/blog')).toEqual([{ name: 'new.md', isDirectory: false }])
		expect(await staged.list('')).toContainEqual({ name: 'public', isDirectory: true })
		expect(await staged.glob('src/content/**/*.md')).toEqual(['src/content/blog/new.md'])
		await expect(staged.readFile('src/content/blog/hello.md')).rejects.toThrow('ENOENT')

		expect(await base.exists('src/content/blog/new.md')).toBe(false)
		expect(await base.exists('src/content/blog/hello.md')).toBe(true)
	})

	test('records the first version it saw of every path, including changed ones it never read', async () => {
		const staged = createStagedFileSystem(createNodeFs(root))
		const original = await staged.readFile('src/content/blog/hello.md')
		await staged.writeFile('src/content/blog/hello.md', 'changed')
		await staged.readFile('src/content/blog/hello.md')
		await staged.exists('src/content/blog/missing.md')
		await staged.writeFile('src/content/blog/blind.md', 'blind')
		await staged.rename('src/content/blog/blind.md', 'src/content/blog/moved.md')

		const { reads, changes } = staged.changeset()
		expect(Object.fromEntries(reads)).toEqual({
			'src/content/blog/hello.md': { kind: 'content', digest: digestBytes(new TextEncoder().encode(original)) },
			'src/content/blog/missing.md': { kind: 'absent' },
			'src/content/blog/blind.md': { kind: 'absent' },
			'src/content/blog/moved.md': { kind: 'absent' },
		})
		expect(changes.map(change => [change.kind, change.path])).toEqual([
			['write', 'src/content/blog/hello.md'],
			['remove', 'src/content/blog/blind.md'],
			['write', 'src/content/blog/moved.md'],
		])
	})
})

describe('commitChangeset', () => {
	test('applies the changes when nothing changed meanwhile', async () => {
		const base = createNodeFs(root)
		const staged = createStagedFileSystem(base)
		await staged.readFile('src/content/blog/hello.md')
		await staged.writeFile('src/content/blog/hello.md', 'edited')
		await staged.writeBytes('public/a.bin', new Uint8Array([0, 255]))

		await commitChangeset(base)(staged.changeset())

		expect(await base.readFile('src/content/blog/hello.md')).toBe('edited')
		expect(await base.readBytes('public/a.bin')).toEqual(new Uint8Array([0, 255]))
	})

	test('applies nothing when a file it read changed meanwhile', async () => {
		const base = createNodeFs(root)
		const staged = createStagedFileSystem(base)
		await staged.readFile('src/content/blog/hello.md')
		await staged.writeFile('src/content/blog/other.md', 'other')
		await staged.writeFile('src/content/blog/hello.md', 'edited')
		await base.writeFile('src/content/blog/hello.md', 'agent')

		const commit = commitChangeset(base)(staged.changeset())
		await expect(commit).rejects.toBeInstanceOf(CmsCommitConflictError)
		await expect(commit).rejects.toMatchObject({ paths: ['src/content/blog/hello.md'] })
		expect(await base.readFile('src/content/blog/hello.md')).toBe('agent')
		expect(await base.exists('src/content/blog/other.md')).toBe(false)
	})

	test('refuses to create a file that appeared meanwhile', async () => {
		const base = createNodeFs(root)
		const staged = createStagedFileSystem(base)
		expect(await staged.exists('src/content/blog/new.md')).toBe(false)
		await staged.writeFile('src/content/blog/new.md', 'mine')
		await base.writeFile('src/content/blog/new.md', 'agent')

		await expect(commitChangeset(base)(staged.changeset())).rejects.toBeInstanceOf(CmsCommitConflictError)
		expect(await base.readFile('src/content/blog/new.md')).toBe('agent')
	})
})

describe('createCmsCore with a commit', () => {
	test('a mutation goes through the commit and lands when the files are unchanged', async () => {
		const base = createNodeFs(root)
		const commits: string[][] = []
		const core = createCmsCore(base, {
			commit: async changeset => {
				commits.push(changeset.changes.map(change => change.path))
				await commitChangeset(base)(changeset)
			},
		})

		const result = await core.updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title: 'Edited' } })

		expect(result.success).toBe(true)
		expect(commits).toEqual([['src/content/blog/hello.md']])
		expect(await base.readFile('src/content/blog/hello.md')).toContain('title: Edited')
	})

	test('a write by someone else between the read and the commit rejects the mutation and keeps their write', async () => {
		const base = createNodeFs(root)
		const core = createCmsCore(base, {
			commit: async changeset => {
				await base.writeFile('src/content/blog/hello.md', '---\ntitle: Agent\n---\nBody\n')
				await commitChangeset(base)(changeset)
			},
		})

		await expect(core.updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title: 'Edited' } })).rejects.toBeInstanceOf(
			CmsCommitConflictError,
		)
		expect(await base.readFile('src/content/blog/hello.md')).toContain('title: Agent')
	})
})
