import { type CmsFileSystem, createNodeFs, scanCollections as coreScanCollections } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'sample-project')

/** Wrap a filesystem, making `readFile`/`list` reject for paths matching a predicate. */
function withFailures(fs: CmsFileSystem, opts: { failRead?: (p: string) => boolean; failList?: (p: string) => boolean }): CmsFileSystem {
	return {
		...fs,
		readFile: (p) => (opts.failRead?.(p) ? Promise.reject(new Error(`simulated read failure: ${p}`)) : fs.readFile(p)),
		list: (p) => (opts.failList?.(p) ? Promise.reject(new Error(`simulated list failure: ${p}`)) : fs.list(p)),
	}
}

// cms-core is now the single scanner (@nuasite/cms re-exports it). This golden
// test locks its output over the sample fixture; it previously double-checked
// parity against @nuasite/cms's own scanner, which no longer exists after the
// consolidation onto cms-core.
describe('cms-core scanCollections — golden over sample fixture', () => {
	test('produces the expected CollectionDefinition map (golden)', async () => {
		// cms-core over the fixture, via the node:fs adapter.
		const fs = createNodeFs(FIXTURE_ROOT)
		const legacy = await coreScanCollections(fs)

		// Sanity: the fixture actually exercised the surface we care about.
		expect(Object.keys(legacy).sort()).toEqual(['authors', 'blog', 'settings', 'team'])

		const blog = legacy.blog!
		expect(blog.type).toBeUndefined() // content collection
		expect(blog.fileExtension).toBe('md')
		expect(blog.supportsDraft).toBe(true)
		expect(blog.orderBy).toBe('date')
		expect(blog.orderDirection).toBe('desc')
		const tags = blog.fields.find(f => f.name === 'tags')
		expect(tags?.type).toBe('array')
		const cover = blog.fields.find(f => f.name === 'cover')
		expect(cover?.type).toBe('image')
		expect(cover?.astroImage).toBe(true)
		const author = blog.fields.find(f => f.name === 'author')
		expect(author?.type).toBe('reference')
		expect(author?.collection).toBe('authors')

		expect(legacy.team!.type).toBe('data')
		expect(legacy.team!.fileExtension).toBe('json')
		expect(legacy.settings!.type).toBe('data')
		expect(legacy.settings!.fileExtension).toBe('yaml')
	})
})

describe('cms-core scanCollections — resilience (stays total on I/O failures)', () => {
	test('a single unreadable entry file is skipped, not fatal — the collection and its siblings survive', async () => {
		const baseline = await coreScanCollections(createNodeFs(FIXTURE_ROOT))
		const blogEntryCount = baseline.blog!.entries!.length
		expect(blogEntryCount).toBeGreaterThan(1)

		// Simulate a markdown file removed/renamed between the directory listing and
		// the read (routine during dev). Before the fix, the rejected Promise.all
		// aborted the entire scan; now the one entry is dropped and the rest remain.
		const fs = withFailures(createNodeFs(FIXTURE_ROOT), {
			failRead: (p) => p.endsWith('hello-world.md'),
		})
		const collections = await coreScanCollections(fs)

		expect(Object.keys(collections).sort()).toEqual(['authors', 'blog', 'settings', 'team'])
		expect(collections.blog!.entries!.length).toBe(blogEntryCount - 1)
	})

	test('a collection whose directory listing throws is skipped, not fatal — siblings survive', async () => {
		const fs = withFailures(createNodeFs(FIXTURE_ROOT), {
			failList: (p) => p.endsWith(`${path.sep}blog`),
		})
		const collections = await coreScanCollections(fs)

		// blog is dropped, but every other collection still scans.
		expect(Object.keys(collections).sort()).toEqual(['authors', 'settings', 'team'])
	})
})
