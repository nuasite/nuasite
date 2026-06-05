import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { withTempDir } from '../utils'

// Entry creation (incl. flat-vs-index layout detection) lives in @nuasite/cms-core now.
// These cases exercise that layout detection through cms-core, which @nuasite/cms's
// dev API delegates to for the `markdown/create` route.
withTempDir('createEntry collection layout', (getCtx) => {
	test('creates markdown entries as <slug>/index.md for index-style glob collections', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/content/aktualne')
		await ctx.writeFile(
			'src/content.config.ts',
			`
				import { defineCollection } from 'astro:content'
				import { glob } from 'astro/loaders'

				const aktualne = defineCollection({
					loader: glob({ pattern: '*/index.{md,mdx}', base: './src/content/aktualne' }),
				})

				export const collections = { aktualne }
			`,
		)

		const core = createCmsCore(createNodeFs(ctx.tempDir))
		const result = await core.createEntry({
			collection: 'aktualne',
			slug: 'nova-aktualita',
			frontmatter: { title: 'Nová aktualita' },
			body: 'Body',
		})

		expect(result).toMatchObject({
			success: true,
			sourcePath: 'src/content/aktualne/nova-aktualita/index.md',
		})
		await expect(fs.stat(path.join(ctx.tempDir, 'src/content/aktualne/nova-aktualita/index.md'))).resolves.toBeDefined()
	})

	test('keeps flat markdown entries as <slug>.md for flat glob collections', async () => {
		const ctx = getCtx()
		await ctx.mkdir('src/content/blog')
		await ctx.writeFile(
			'src/content.config.ts',
			`
				import { defineCollection } from 'astro:content'
				import { glob } from 'astro/loaders'

				const blog = defineCollection({
					loader: glob({ pattern: '*.{md,mdx}', base: './src/content/blog' }),
				})

				export const collections = { blog }
			`,
		)

		const core = createCmsCore(createNodeFs(ctx.tempDir))
		const result = await core.createEntry({
			collection: 'blog',
			slug: 'flat-post',
			frontmatter: { title: 'Flat Post' },
			body: 'Body',
		})

		expect(result).toMatchObject({
			success: true,
			sourcePath: 'src/content/blog/flat-post.md',
		})
		await expect(fs.stat(path.join(ctx.tempDir, 'src/content/blog/flat-post.md'))).resolves.toBeDefined()
	})
})
