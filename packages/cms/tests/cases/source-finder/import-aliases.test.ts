import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { clearSourceFinderCache } from '../../../src/source-finder'
import { parseJsonc } from '../../../src/source-finder/import-aliases'
import { resolveImportPath } from '../../../src/source-finder/variable-extraction'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../../utils/temp-directory'

describe('parseJsonc', () => {
	test('drops comments and trailing commas, and keeps comment markers inside strings', () => {
		const text = '{\n\t// a comment\n\t"url": "https://example.com/*x*/", /* block */\n\t"list": ["a", "b",],\n}\n'
		expect(parseJsonc(text)).toEqual({ url: 'https://example.com/*x*/', list: ['a', 'b'] })
	})
})

describe('resolveImportPath through tsconfig aliases', () => {
	let ctx: TempDirContext

	beforeEach(async () => {
		clearSourceFinderCache()
		ctx = await createTempDir('import-aliases-')
		await ctx.writeFile('src/components/Card.astro', '<div></div>\n')
		await ctx.writeFile('src/lib/data.ts', 'export const x = 1\n')
		await ctx.writeFile('src/lib/special/data.ts', 'export const y = 1\n')
		await ctx.writeFile('src/pages/index.astro', '---\n---\n')
	})

	afterEach(async () => {
		await cleanupTempDir(ctx)
	})

	const importer = () => path.join(ctx.tempDir, 'src/pages/index.astro')

	test('follows paths inherited through a relative extends, resolving targets against its baseUrl', async () => {
		await ctx.writeFile('tsconfig.base.json', '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["*"], "~lib/*": ["lib/*"] } } }')
		await ctx.writeFile('tsconfig.json', '{ "extends": ["astro/tsconfigs/strict", "./tsconfig.base"] }')

		expect(await resolveImportPath('@/components/Card.astro', importer())).toBe(path.join(ctx.tempDir, 'src/components/Card.astro'))
		expect(await resolveImportPath('~lib/data', importer())).toBe(path.join(ctx.tempDir, 'src/lib/data.ts'))
		// baseUrl alone maps a bare specifier too.
		expect(await resolveImportPath('lib/data', importer())).toBe(path.join(ctx.tempDir, 'src/lib/data.ts'))
		expect(await resolveImportPath('astro:content', importer())).toBeNull()
	})

	test('the longest matching pattern wins, and a pattern without * matches only itself', async () => {
		await ctx.writeFile(
			'tsconfig.json',
			'{ "compilerOptions": { "paths": { "@lib/*": ["./src/lib/*"], "@lib/special/*": ["./src/lib/special/*"], "@data": ["./src/lib/data.ts"] } } }',
		)

		expect(await resolveImportPath('@lib/special/data', importer())).toBe(path.join(ctx.tempDir, 'src/lib/special/data.ts'))
		expect(await resolveImportPath('@data', importer())).toBe(path.join(ctx.tempDir, 'src/lib/data.ts'))
		expect(await resolveImportPath('@data/more', importer())).toBeNull()
	})
})
