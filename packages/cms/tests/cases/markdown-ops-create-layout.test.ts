import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleCreateMarkdown } from '../../src/handlers/markdown-ops'
import { withTempDir } from '../utils'

withTempDir('handleCreateMarkdown collection layout', (getCtx) => {
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

		const result = await handleCreateMarkdown({
			collection: 'aktualne',
			title: 'Nová aktualita',
			slug: 'nova-aktualita',
			content: 'Body',
		})

		expect(result).toMatchObject({
			success: true,
			filePath: 'src/content/aktualne/nova-aktualita/index.md',
			slug: 'nova-aktualita',
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

		const result = await handleCreateMarkdown({
			collection: 'blog',
			title: 'Flat Post',
			slug: 'flat-post',
			content: 'Body',
		})

		expect(result).toMatchObject({
			success: true,
			filePath: 'src/content/blog/flat-post.md',
			slug: 'flat-post',
		})
		await expect(fs.stat(path.join(ctx.tempDir, 'src/content/blog/flat-post.md'))).resolves.toBeDefined()
	})
})
