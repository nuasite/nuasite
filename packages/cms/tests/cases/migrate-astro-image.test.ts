import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { migrateAstroImages } from '../../src/migrate-astro-image'
import { setupContentCollections, withTempDir } from '../utils'

withTempDir('migrate-astro-image', (getCtx) => {
	test('rewrites a flat-md entry: copies file to sibling, updates YAML', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['portfolio'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const portfolio = defineCollection({
  schema: ({ image }) => z.object({
    title: z.string(),
    image: image(),
  }),
})
export const collections = { portfolio }
`,
		)
		await ctx.writeFile('public/uploads/abc.jpeg', 'BINARY-A')
		await ctx.writeFile(
			'src/content/portfolio/akrylatove-02.md',
			'---\ntitle: Hello\nimage: /uploads/abc.jpeg\n---\nBody\n',
		)

		const result = await migrateAstroImages({ projectRoot: ctx.tempDir })

		expect(result.migrations).toHaveLength(1)
		expect(result.migrations[0]!.fieldName).toBe('image')
		expect(result.migrations[0]!.newValue).toBe('./akrylatove-02-abc.jpeg')

		// File copied next to the entry
		const copied = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/akrylatove-02-abc.jpeg'),
			'utf-8',
		)
		expect(copied).toBe('BINARY-A')

		// YAML rewritten
		const newRaw = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/akrylatove-02.md'),
			'utf-8',
		)
		expect(newRaw).toContain('image: ./akrylatove-02-abc.jpeg')
		expect(newRaw).not.toContain('/uploads/abc.jpeg')
		expect(newRaw).toContain('title: Hello')
		expect(newRaw).toContain('Body')
	})

	test('Hugo-style entry: copies file inside entry dir', async () => {
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
		await ctx.writeFile('public/uploads/cover.png', 'BINARY-B')
		await ctx.writeFile(
			'src/content/portfolio/my-piece/index.md',
			'---\nimage: /uploads/cover.png\n---\nBody\n',
		)

		const result = await migrateAstroImages({ projectRoot: ctx.tempDir })

		expect(result.migrations).toHaveLength(1)
		expect(result.migrations[0]!.newValue).toBe('./cover.png')

		const copied = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/my-piece/cover.png'),
			'utf-8',
		)
		expect(copied).toBe('BINARY-B')

		const newRaw = await fs.readFile(
			path.join(ctx.tempDir, 'src/content/portfolio/my-piece/index.md'),
			'utf-8',
		)
		expect(newRaw).toContain('image: ./cover.png')
	})

	test('idempotent: already-relative values are skipped', async () => {
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
		await ctx.writeFile('src/content/portfolio/already-good.md', '---\nimage: ./local.jpeg\n---\nBody\n')

		const result = await migrateAstroImages({ projectRoot: ctx.tempDir })
		expect(result.migrations).toHaveLength(0)
	})

	test('skips when source file is missing in public/', async () => {
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
		await ctx.writeFile('src/content/portfolio/orphan.md', '---\nimage: /uploads/missing.jpeg\n---\nBody\n')

		const result = await migrateAstroImages({ projectRoot: ctx.tempDir })
		expect(result.migrations).toHaveLength(0)
		expect(result.skipped.some(s => s.reason.startsWith('source missing'))).toBe(true)
	})

	test('does not touch n.image() fields (only image() callback form)', async () => {
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
		await ctx.writeFile('public/uploads/x.jpeg', 'BIN')
		await ctx.writeFile('src/content/blog/post.md', '---\ncover: /uploads/x.jpeg\n---\nBody\n')

		const result = await migrateAstroImages({ projectRoot: ctx.tempDir })
		expect(result.migrations).toHaveLength(0)
	})

	test('dry-run: reports migrations without writing files', async () => {
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
		await ctx.writeFile('public/uploads/abc.jpeg', 'BIN')
		await ctx.writeFile('src/content/portfolio/foo.md', '---\nimage: /uploads/abc.jpeg\n---\nBody\n')

		const result = await migrateAstroImages({ projectRoot: ctx.tempDir, dryRun: true })

		expect(result.migrations).toHaveLength(1)
		// Original YAML unchanged
		const raw = await fs.readFile(path.join(ctx.tempDir, 'src/content/portfolio/foo.md'), 'utf-8')
		expect(raw).toContain('image: /uploads/abc.jpeg')
		// File not copied
		const copyExists = await fs.access(path.join(ctx.tempDir, 'src/content/portfolio/foo-abc.jpeg'))
			.then(() => true).catch(() => false)
		expect(copyExists).toBe(false)
	})
})
