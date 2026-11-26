import { type CmsFileSystem, commitChangeset, createCmsCore, createNodeFs, digestBytes } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------------------
// The source hash is the entry's version for optimistic concurrency. A read reports the hash of
// the very bytes it parsed, and a mutation the hash of the very bytes it wrote: a hash taken by
// reading the file again could belong to a later write by someone else.
// ---------------------------------------------------------------------------

const ENTRY = 'src/content/blog/hello.md'
const SOURCE = '---\ntitle: Hello\n---\nBody\n'
const OUTSIDE = '---\ntitle: Written by someone else\n---\nOther body\n'

let root: string

beforeEach(async () => {
	root = path.join(import.meta.dir, `__source-hash-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
	await fs.mkdir(path.join(root, 'src/content/blog'), { recursive: true })
	await fs.writeFile(path.join(root, ENTRY), SOURCE)
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

const hashOf = (text: string) => digestBytes(new TextEncoder().encode(text))

/** A filesystem on which someone else writes the entry right after any write of the CMS lands. */
function overwrittenAfterEachWrite(base: CmsFileSystem): CmsFileSystem {
	const outside = () => fs.writeFile(path.join(root, ENTRY), OUTSIDE)
	return {
		...base,
		writeFile: async (file, content) => {
			await base.writeFile(file, content)
			await outside()
		},
		writeBytes: async (file, content) => {
			await base.writeBytes(file, content)
			await outside()
		},
	}
}

describe('the entry source hash', () => {
	test('a read reports the hash of the bytes it parsed', async () => {
		const core = createCmsCore(createNodeFs(root))

		const entry = await core.getEntry('blog', 'hello')

		expect(entry?.sourceHash).toBe(hashOf(SOURCE))
	})

	test('an update reports the hash of what it wrote, not of a write that landed after it', async () => {
		const core = createCmsCore(overwrittenAfterEachWrite(createNodeFs(root)))

		const result = await core.updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title: 'Edited' } })

		expect(result.success).toBe(true)
		expect(result.sourceHash).toBe(hashOf(await writtenByCms('Edited')))
		expect(result.sourceHash).not.toBe(hashOf(OUTSIDE))
	})

	test('an update through a host commit reports the hash of what it committed', async () => {
		const base = createNodeFs(root)
		const core = createCmsCore(base, {
			commit: async changeset => {
				await commitChangeset(base)(changeset)
				await fs.writeFile(path.join(root, ENTRY), OUTSIDE)
			},
		})

		const result = await core.updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title: 'Edited' } })

		expect(result.sourceHash).toBe(hashOf(await writtenByCms('Edited')))
	})

	test('a create and a rename report the hash of the file they wrote', async () => {
		const core = createCmsCore(createNodeFs(root))

		const created = await core.createEntry({ collection: 'blog', slug: 'fresh', frontmatter: { title: 'Fresh' }, body: 'Text\n' })
		expect(created.sourceHash).toBe(hashOf(await fs.readFile(path.join(root, 'src/content/blog/fresh.md'), 'utf-8')))

		const renamed = await core.renameEntry('blog', 'hello', 'renamed')
		expect(renamed.sourceHash).toBe(hashOf(SOURCE))
	})

	test('a rename reports the hash of the file it moved, read before the move, not of a write that landed after it', async () => {
		const base = createNodeFs(root)
		const core = createCmsCore({
			...base,
			rename: async (from, to) => {
				await base.rename(from, to)
				await fs.writeFile(path.join(root, to), OUTSIDE)
			},
		})

		const renamed = await core.renameEntry('blog', 'hello', 'renamed')

		expect(renamed.sourceHash).toBe(hashOf(SOURCE))
	})

	test('a folder-style entry reports the hash of its file after the folder moves', async () => {
		const folderEntry = 'src/content/blog/post/index.md'
		await fs.mkdir(path.join(root, 'src/content/blog/post'), { recursive: true })
		await fs.writeFile(path.join(root, folderEntry), SOURCE)
		const core = createCmsCore(createNodeFs(root))

		const renamed = await core.renameEntry('blog', 'post', 'moved')

		expect(renamed.sourcePath).toBe('src/content/blog/moved/index.md')
		expect(renamed.sourceHash).toBe(hashOf(SOURCE))
	})

	test('a rename to the slug the entry already has reports the hash of its file', async () => {
		const core = createCmsCore(createNodeFs(root))

		const renamed = await core.renameEntry('blog', 'hello', 'hello')

		expect(renamed.sourceHash).toBe(hashOf(SOURCE))
	})

	test('a filesystem written as a class keeps its methods under the CMS', async () => {
		const core = createCmsCore(new ClassFileSystem(createNodeFs(root)))

		const result = await core.updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title: 'Edited' } })

		expect(result.success).toBe(true)
		expect(result.sourceHash).toBe(hashOf(await writtenByCms('Edited')))
	})

	test('a mutation without a host commit still writes the file', async () => {
		const core = createCmsCore(createNodeFs(root))

		await core.updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title: 'Edited' } })

		expect(await fs.readFile(path.join(root, ENTRY), 'utf-8')).toContain('title: Edited')
	})
})

/** A filesystem whose methods live on its prototype, as the `CmsFileSystem` interface allows. */
class ClassFileSystem implements CmsFileSystem {
	constructor(private readonly base: CmsFileSystem) {}
	readFile(file: string) {
		return this.base.readFile(file)
	}
	readBytes(file: string) {
		return this.base.readBytes(file)
	}
	writeFile(file: string, content: string) {
		return this.base.writeFile(file, content)
	}
	writeBytes(file: string, content: Uint8Array) {
		return this.base.writeBytes(file, content)
	}
	rename(from: string, to: string) {
		return this.base.rename(from, to)
	}
	remove(file: string) {
		return this.base.remove(file)
	}
	exists(file: string) {
		return this.base.exists(file)
	}
	list(dir: string) {
		return this.base.list(dir)
	}
	glob(...args: Parameters<CmsFileSystem['glob']>) {
		return this.base.glob(...args)
	}
	stat(file: string) {
		return this.base.stat(file)
	}
}

/** What the CMS writes for the fixture entry with `title`, read from a separate copy that nobody else touches. */
async function writtenByCms(title: string): Promise<string> {
	const copy = `${root}-copy`
	await fs.mkdir(path.join(copy, 'src/content/blog'), { recursive: true })
	await fs.writeFile(path.join(copy, ENTRY), SOURCE)
	try {
		await createCmsCore(createNodeFs(copy)).updateEntry({ collection: 'blog', slug: 'hello', frontmatter: { title } })
		return await fs.readFile(path.join(copy, ENTRY), 'utf-8')
	} finally {
		await fs.rm(copy, { recursive: true, force: true })
	}
}
