import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { checkCode } from '../src/check-code'

// The error this exists for: a build that dies in `Building static entrypoints` because an
// unescaped quote inside a Czech string ("Blog "aneb" novinky") makes the emitted TypeScript
// unparseable. Astro reports it as `BlogSection.astro:31:38` — after a full content sync.
describe('checkCode', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__code-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	const write = async (relative: string, content: string) => {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, content)
	}

	test('a syntax error in the frontmatter is reported at its line in the .astro source', async () => {
		await write('src/components/Blog.astro', '---\nconst heading = "Blog "aneb" novinky"\n---\n<h2>{heading}</h2>\n')

		const { findings } = await checkCode(root)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toMatchObject({
			severity: 'error',
			code: 'code/syntax',
			file: path.join('src', 'components', 'Blog.astro'),
			line: 2,
		})
		expect(findings[0]!.message).toContain('aneb')
	})

	// The compiler accepts this — it is the emitted TypeScript that does not parse — so a check
	// that stopped at `@astrojs/compiler.transform()` would pass it.
	test('a syntax error inside a template expression is caught too', async () => {
		await write('src/components/Blog.astro', '---\nconst x = 1\n---\n<h2>{"Blog "aneb" novinky"}</h2>\n')

		const { findings } = await checkCode(root)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toMatchObject({ code: 'code/syntax', line: 4 })
	})

	test('plain .ts is parsed as well', async () => {
		await write('src/lib/courses.ts', 'export const list = [1, 2\n')

		const { findings } = await checkCode(root)
		expect(findings.map(finding => finding.code)).toEqual(['code/syntax'])
	})

	test('a clean project reports nothing', async () => {
		await write('src/pages/index.astro', '---\nconst title = "Ahoj"\n---\n<h1>{title}</h1>\n')
		await write('src/lib/util.ts', 'export const two = 1 + 1\n')

		const report = await checkCode(root)
		expect(report.findings).toEqual([])
		expect(report.files).toBe(2)
	})

	// Astro frontmatter allows a top-level `return`, which is invalid in an ES module. Parsing the
	// fence on its own would flag 3 of svet-neziskovek's 73 components; going through the compiler
	// does not.
	test('top-level return in frontmatter is valid Astro, not a finding', async () => {
		await write('src/pages/redirect.astro', '---\nif (true) {\n  return Astro.redirect("/jinam")\n}\n---\n<p>x</p>\n')

		expect((await checkCode(root)).findings).toEqual([])
	})

	test('declaration files and build output are skipped', async () => {
		await write('src/generated/content-index.d.mts', 'declare const x: number\nexport { x }\n')
		await write('dist/server/chunk.ts', 'this is ) not ( code\n')
		await write('node_modules/pkg/index.ts', 'also ) not ( code\n')

		const report = await checkCode(root)
		expect(report.findings).toEqual([])
		expect(report.files).toBe(0)
	})
})
