import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { getCachedParsedFile } from '../../../src/source-finder/ast-parser'
import { getAstroContentAnalysis } from '../../../src/source-finder/astro-content-analysis'
import { clearSourceFinderCache, markFileDirty } from '../../../src/source-finder/cache'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../../utils/temp-directory'

describe('cached Astro content analysis', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('astro-content-analysis-')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	test('is invalidated with the parsed file cache entry', async () => {
		const relativePath = 'src/pages/index.astro'
		const absolutePath = path.join(ctx.tempDir, relativePath)
		await ctx.writeFile(
			relativePath,
			'---\nimport { getCollection } from "astro:content"\nawait getCollection("news")\n---\n',
		)

		const firstFile = await getCachedParsedFile(absolutePath)
		if (!firstFile) throw new Error('Expected the Astro file to parse')
		expect(getAstroContentAnalysis(firstFile, 'astro').collectionCalls[0]?.collectionName).toBe('news')

		await ctx.writeFile(
			relativePath,
			'---\nimport { getCollection } from "astro:content"\nawait getCollection("products")\n---\n',
		)
		markFileDirty(absolutePath)

		const secondFile = await getCachedParsedFile(absolutePath)
		if (!secondFile) throw new Error('Expected the updated Astro file to parse')
		expect(secondFile).not.toBe(firstFile)
		expect(getAstroContentAnalysis(secondFile, 'astro').collectionCalls[0]?.collectionName).toBe('products')
	})
})
