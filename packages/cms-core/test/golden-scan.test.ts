import { resetProjectRoot, scanCollections as legacyScanCollections, setProjectRoot } from '@nuasite/cms'
import { createNodeFs, scanCollections as coreScanCollections } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'sample-project')

describe('cms-core scanCollections — parity with @nuasite/cms', () => {
	test('produces an identical CollectionDefinition map (golden)', async () => {
		// Golden: today's scanner over the fixture, via the project-root override.
		setProjectRoot(FIXTURE_ROOT)
		let legacy: Awaited<ReturnType<typeof legacyScanCollections>>
		try {
			legacy = await legacyScanCollections('src/content')
		} finally {
			resetProjectRoot()
		}

		// Port: cms-core over the same fixture, via the node:fs adapter.
		const fs = createNodeFs(FIXTURE_ROOT)
		const core = await coreScanCollections(fs)

		// The whole structure must match byte-for-byte (deep equality).
		expect(core).toEqual(legacy)

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
