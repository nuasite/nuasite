import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { tryAstroImageUpload } from '../../src/handlers/astro-image-upload'
import { ManifestWriter } from '../../src/manifest-writer'
import { setupContentCollections, withTempDir } from '../utils'

async function buildManifestWriter() {
	const collections = await scanCollections(createNodeFs(process.cwd()))
	const mw = new ManifestWriter('cms-manifest.json')
	mw.setCollectionDefinitions(collections)
	return mw
}

withTempDir('astro-image-upload', (getCtx) => {
	test('flat-md entry: writes upload as sibling and returns ./<slug>-<filename>', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({ image: image() }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('src/content/portfolio/foo.md', '---\nimage: ./placeholder.jpeg\n---\nBody\n')

		const mw = await buildManifestWriter()
		const result = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'foo', field: 'image' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('NEW-BYTES'),
			originalFilename: 'hero.jpg',
		})

		expect(result).toBeTruthy()
		expect(result!.success).toBe(true)
		if (!result || !result.success) throw new Error('expected success')

		expect(result.url).toBe('./foo-hero.jpg')
		const written = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/foo-hero.jpg'),
			'utf-8',
		)
		expect(written).toBe('NEW-BYTES')
	})

	test('Hugo-style entry: writes upload inside entry directory', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({ image: image() }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('src/content/portfolio/my-piece/index.md', '---\nimage: ./old.jpg\n---\nBody\n')

		const mw = await buildManifestWriter()
		const result = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'my-piece', field: 'image' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('NEW-BYTES'),
			originalFilename: 'cover.png',
		})

		expect(result?.success).toBe(true)
		if (!result || !result.success) throw new Error('expected success')
		expect(result.url).toBe('./cover.png')
		const written = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/my-piece/cover.png'),
			'utf-8',
		)
		expect(written).toBe('NEW-BYTES')
	})

	test('returns null when field is not astroImage (n.image() field)', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['blog'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { n } from '@nuasite/cms'
const blog = defineCollection({
  schema: n.object({ cover: n.image() }),
})
export const collections = { blog }
`,
		)
		await ctx.writeFile('src/content/blog/post.md', '---\ncover: /uploads/x.jpeg\n---\nBody\n')

		const mw = await buildManifestWriter()
		const result = await tryAstroImageUpload({
			context: { collection: 'blog', entry: 'post', field: 'cover' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('BYTES'),
			originalFilename: 'x.jpeg',
		})

		expect(result).toBeNull()
	})

	test('returns null when context is incomplete', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		const mw = await buildManifestWriter()

		const result = await tryAstroImageUpload({
			context: { collection: 'portfolio' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('BYTES'),
			originalFilename: 'x.jpeg',
		})

		expect(result).toBeNull()
	})

	test('returns error when entry slug doesn’t match', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({ image: image() }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('src/content/portfolio/foo.md', '---\nimage: ./x.jpg\n---\n')

		const mw = await buildManifestWriter()
		const result = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'does-not-exist', field: 'image' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('BYTES'),
			originalFilename: 'x.jpg',
		})

		expect(result?.success).toBe(false)
		if (!result || result.success) throw new Error('expected failure')
		expect(result.error).toContain('Entry not found')
	})

	test('collision: identical re-upload reuses the existing filename', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({ image: image() }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('src/content/portfolio/foo.md', '---\nimage: ./x.jpg\n---\n')

		const mw = await buildManifestWriter()
		const buf = Buffer.from('SAME-BYTES')

		const r1 = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'foo', field: 'image' },
			manifestWriter: mw,
			fileBuffer: buf,
			originalFilename: 'pic.png',
		})
		const r2 = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'foo', field: 'image' },
			manifestWriter: mw,
			fileBuffer: buf,
			originalFilename: 'pic.png',
		})

		if (!r1?.success || !r2?.success) throw new Error('expected both success')
		// Identical content → same filename, no collision suffix needed.
		expect(r1.url).toBe('./foo-pic.png')
		expect(r2.url).toBe('./foo-pic.png')
	})

	test('rejects path-traversal in originalFilename', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({ image: image() }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('src/content/portfolio/foo.md', '---\nimage: ./x.jpg\n---\n')

		const mw = await buildManifestWriter()
		const result = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'foo', field: 'image' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('EVIL'),
			originalFilename: '../../../etc/evil.jpg',
		})

		// Path traversal segments are stripped — file lands inside the entry dir.
		if (!result?.success) throw new Error('expected success')
		expect(result.url).toBe('./foo-evil.jpg')
		const written = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/foo-evil.jpg'),
			'utf-8',
		)
		expect(written).toBe('EVIL')
		// Nothing was written outside the entry dir
		const escaped = await fs.access(path.join(ctx.tempDir, '../etc/evil.jpg'))
			.then(() => true).catch(() => false)
		expect(escaped).toBe(false)
	})

	test('collision: different content under same name gets a hash suffix', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({ image: image() }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('src/content/portfolio/foo.md', '---\nimage: ./x.jpg\n---\n')
		// Pre-existing file with the candidate name but DIFFERENT content
		await ctx.writeFile('src/content/portfolio/foo-pic.png', 'OLD-BYTES')

		const mw = await buildManifestWriter()
		const result = await tryAstroImageUpload({
			context: { collection: 'portfolio', entry: 'foo', field: 'image' },
			manifestWriter: mw,
			fileBuffer: Buffer.from('NEW-BYTES'),
			originalFilename: 'pic.png',
		})

		if (!result?.success) throw new Error('expected success')
		expect(result.url).not.toBe('./foo-pic.png')
		expect(result.url).toMatch(/^\.\/foo-pic-[a-f0-9]{8}\.png$/)
		// Old file untouched
		const old = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/foo-pic.png'),
			'utf-8',
		)
		expect(old).toBe('OLD-BYTES')
	})
})
