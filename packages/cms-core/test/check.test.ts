import { checkContent, createNodeFs } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// `nua check` exists because `astro sync` is the only thing that validates collections today,
// and it costs a full content-layer parse and stops at the first bad entry. The bug that
// prompted it: a CMS-created person with `order: ''` took a 1.5k-entry production site's
// build down, and the build error named one field on one entry.
describe('checkContent', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__check-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	const config = (schema: string, extra = '') =>
		`import { defineCmsCollection, n } from '@nuasite/cms'
import { reference } from 'astro:content'
import { glob } from 'astro/loaders'
const people = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/people' }),
	schema: ${schema},
})
${extra}
export const collections = { people${extra ? ', articles' : ''} }
`

	const check = () => checkContent(createNodeFs(root))

	test('a clean project reports nothing', async () => {
		await write({
			'src/content/people/ada.md': '---\nname: Ada\norder: 1\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), order: n.number() })'),
		})

		const report = await check()
		expect(report.findings).toEqual([])
		expect(report.collections).toBe(1)
		expect(report.entries).toBe(1)
	})

	// The exact production failure: the CMS wrote '' into every untouched optional number.
	test('reports every empty-string number on the entry, not just the first', async () => {
		await write({
			'src/content/people/petra.md': '---\nname: Petra\norder: ""\norderTym: ""\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), order: n.number(), orderTym: n.number() })'),
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.field, f.file])).toEqual([
			['entry/field-type', 'order', 'src/content/people/petra.md'],
			['entry/field-type', 'orderTym', 'src/content/people/petra.md'],
		])
		expect(report.findings[0]!.severity).toBe('error')
		expect(report.findings[0]!.message).toContain('expected a number, found string')
	})

	test('flags a value outside a declared enum and a missing required field', async () => {
		await write({
			'src/content/people/ada.md': '---\nrole: ghost\n---\n',
			'src/content.config.ts': config("n.object({ name: n.text(), role: n.enum(['expert', 'author']) })"),
		})

		const report = await check()
		const codes = report.findings.map(f => f.code)
		expect(codes).toContain('entry/missing-required')
		expect(codes).toContain('entry/field-type')
		expect(report.findings.find(f => f.field === 'role')?.message).toContain('expert, author')
	})

	test('unparseable frontmatter is one error, and the entry is not field-checked', async () => {
		await write({
			'src/content/people/broken.md': '---\nname: [unclosed\norder: ""\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), order: n.number() })'),
		})

		const report = await check()
		expect(report.findings).toHaveLength(1)
		expect(report.findings[0]!.code).toBe('entry/syntax')
	})

	test('a declared collection whose directory is missing is an error', async () => {
		await write({ 'src/content.config.ts': config('n.object({ name: n.text() })') })

		const report = await check()
		expect(report.findings.map(f => f.code)).toEqual(['config/missing-dir'])
	})

	// `reference()` validates the shape, not the target — a wrong id builds green and renders
	// nothing, which is why this is a warning rather than an error.
	test('a reference pointing at no entry is a warning', async () => {
		await write({
			'src/content/people/ada.md': '---\nname: Ada\n---\n',
			'src/content/articles/one.md': '---\ntitle: One\nauthor: ada\n---\n',
			'src/content/articles/two.md': '---\ntitle: Two\nauthor: nobody\n---\n',
			'src/content.config.ts': config(
				'n.object({ name: n.text() })',
				`const articles = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/articles' }),
	schema: n.object({ title: n.text(), author: reference('people') }),
})`,
			),
		})

		const report = await check()
		expect(report.findings).toHaveLength(1)
		expect(report.findings[0]!.severity).toBe('warning')
		expect(report.findings[0]!.code).toBe('entry/dangling-reference')
		expect(report.findings[0]!.file).toBe('src/content/articles/two.md')
	})

	test('no content config at all is an error, not an empty pass', async () => {
		await write({ 'src/content/people/ada.md': '---\nname: Ada\n---\n' })

		const report = await check()
		expect(report.findings.map(f => f.code)).toEqual(['config/no-collections'])
	})
})
