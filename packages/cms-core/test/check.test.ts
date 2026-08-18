import { checkContent, createNodeFs, formatCheckReport } from '@nuasite/cms-core'
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

	const acceptEverything = { people: { safeParse: async () => ({ success: true as const }) } }

	// `required` is what the parser assumed, not what the schema said. Where the real schema is
	// available it answers properly, and this default must not keep failing content the build takes.
	test('a required field the parser assumed is not reported as missing once a live schema is in hand', async () => {
		await write({
			'src/content.config.ts': config('n.object({ title: n.text(), nickname: sharedField })'),
			'src/content/people/ada.md': '---\ntitle: Ada\n---\n',
		})

		const withoutSchema = await check()
		expect(withoutSchema.findings.map(finding => finding.code)).toContain('entry/missing-required')

		const withSchema = await checkContent(createNodeFs(root), { schemas: acceptEverything })
		expect(withSchema.findings.map(finding => finding.code)).not.toContain('entry/missing-required')
	})

	// A type name is not a type. `n.date()` is `z.preprocess(toISODate, z.string())` with no
	// validation, so `date: ''` builds — and this rule called it a broken date on a production site.
	test('a type the parser read is not enforced over the schema once a live schema is in hand', async () => {
		await write({
			'src/content.config.ts': config('n.object({ title: n.text(), date: n.date() })'),
			'src/content/people/ada.md': "---\ntitle: Ada\ndate: ''\n---\n",
		})

		const withoutSchema = await check()
		expect(withoutSchema.findings.map(finding => finding.code)).toContain('entry/field-type')

		const withSchema = await checkContent(createNodeFs(root), { schemas: acceptEverything })
		expect(withSchema.findings.map(finding => finding.code)).not.toContain('entry/field-type')
	})

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

	// An image field naming a file nobody ever uploaded builds green and renders a broken image.
	test('an image value with no file behind it is a warning', async () => {
		await write({
			'src/content/people/ada.md': '---\nname: Ada\nphoto: /uploads/ada.jpg\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), photo: n.image() })'),
		})

		const report = await check()
		expect(report.findings).toHaveLength(1)
		expect(report.findings[0]!.severity).toBe('warning')
		expect(report.findings[0]!.code).toBe('entry/missing-asset')
		expect(report.findings[0]!.field).toBe('photo')
		expect(report.findings[0]!.message).toContain('public/uploads/ada.jpg')
	})

	// The two shapes that must stay silent: served out of public/, and kept outside it.
	test('an image that resolves — under public/ or from the project root — reports nothing', async () => {
		await write({
			'public/uploads/ada.jpg': 'x',
			'assets/bob.jpg': 'x',
			'src/content/people/ada.md': '---\nname: Ada\nphoto: /uploads/ada.jpg\n---\n',
			'src/content/people/bob.md': '---\nname: Bob\nphoto: /assets/bob.jpg\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), photo: n.image() })'),
		})

		const report = await check()
		expect(report.findings).toEqual([])
	})

	// None of these name a file in this project: the s3/contember media adapters store absolute
	// URLs, and Astro hands a `~`/`@` value to Vite's resolver, which this cannot follow.
	test('remote, inline and vite-alias image values get no opinion', async () => {
		await write({
			'src/assets/ada.png': 'x',
			'src/content/people/ada.md': '---\nname: Ada\nphoto: ~/assets/ada.png\n---\n',
			'src/content/people/bob.md': '---\nname: Bob\nphoto: "@images/bob.png"\n---\n',
			'src/content/people/cyd.md': '---\nname: Cyd\nphoto: https://cdn.example.com/cyd.jpg\n---\n',
			'src/content/people/dee.md': '---\nname: Dee\nphoto: "data:image/gif;base64,R0lGOD"\n---\n',
			'src/content/people/eve.md': '---\nname: Eve\nphoto: "//cdn.example.com/eve.jpg"\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), photo: n.image() })'),
		})

		const report = await check()
		expect(report.findings).toEqual([])
	})

	// A cache buster is not part of the filename — trimming it keeps the file itself checked.
	test('a query string or fragment is trimmed off, not treated as unresolvable', async () => {
		await write({
			'public/uploads/logo.svg': 'x',
			'src/content/people/ada.md': '---\nname: Ada\nphoto: /uploads/logo.svg?v=2\n---\n',
			'src/content/people/bob.md': '---\nname: Bob\nphoto: /uploads/logo.svg#icon\n---\n',
			'src/content/people/cyd.md': '---\nname: Cyd\nphoto: /uploads/gone.svg?v=2\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), photo: n.image() })'),
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.file])).toEqual([['entry/missing-asset', 'src/content/people/cyd.md']])
		expect(report.findings[0]!.message).toContain('public/uploads/gone.svg')
	})

	// `getEntryAsset` serves any relative value out of the entry's directory, whatever the field
	// was declared as, so the check has to look in the same place.
	test("a relative value on a plain image field resolves against the entry's directory", async () => {
		await write({
			'src/content/people/ada.png': 'x',
			'src/content/people/ada.md': '---\nname: Ada\nphoto: ./ada.png\n---\n',
			'src/content/people/bob.md': '---\nname: Bob\nphoto: ./bob.png\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text(), photo: n.image() })'),
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.file])).toEqual([['entry/missing-asset', 'src/content/people/bob.md']])
		expect(report.findings[0]!.message).toContain('src/content/people/bob.png')
	})

	// `image()` stores a path relative to the entry, so it only resolves against the entry's own dir.
	test("an astro image() value resolves against the entry's directory", async () => {
		await write({
			'src/assets/ada.png': 'x',
			'src/content/people/ada.md': '---\nname: Ada\nphoto: ../../assets/ada.png\n---\n',
			'src/content/people/bob.md': '---\nname: Bob\nphoto: ../../assets/bob.png\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const people = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/people' }),
	schema: ({ image }) => n.object({ name: n.text(), photo: image() }),
})
export const collections = { people }
`,
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.file])).toEqual([['entry/missing-asset', 'src/content/people/bob.md']])
		expect(report.findings[0]!.message).toContain('src/assets/bob.png')
	})

	test('missing images inside nested objects and object arrays are found too', async () => {
		await write({
			'public/uploads/g1.jpg': 'x',
			'src/content/people/ada.md': `---
name: Ada
hero:
  picture: /uploads/hero.jpg
gallery:
  - src: /uploads/g1.jpg
  - src: /uploads/g2.jpg
---
`,
			'src/content.config.ts': config(
				'n.object({ name: n.text(), hero: n.object({ picture: n.image() }), gallery: n.array(n.object({ src: n.image() })) })',
			),
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.field])).toEqual([
			['entry/missing-asset', 'hero.picture'],
			['entry/missing-asset', 'gallery[1].src'],
		])
	})

	// Astro strips what the schema does not declare, so a typo'd key is written and never read.
	test('a frontmatter key the schema does not declare is a warning', async () => {
		await write({
			'src/content/people/ada.md': '---\nname: Ada\nnickname: Addy\n---\n',
			'src/content.config.ts': config('n.object({ name: n.text() })'),
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.field])).toEqual([['entry/unknown-key', 'nickname']])
		expect(report.findings[0]!.severity).toBe('warning')
	})

	// A schema the AST cannot unwrap parses to zero fields — warning on every key there would
	// flag a perfectly valid project, so the whole collection is skipped instead.
	test('a collection whose schema did not parse reports no unknown keys', async () => {
		await write({
			'src/content/people/ada.md': '---\nname: Ada\nnickname: Addy\n---\n',
			'src/content.config.ts': `import { defineCmsCollection } from '@nuasite/cms'
import { glob } from 'astro/loaders'
import { personSchema } from './schemas'
const people = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/people' }),
	schema: personSchema,
})
export const collections = { people }
`,
		})

		const report = await check()
		expect(report.findings).toEqual([])
	})

	// A spread contributes real fields the parser cannot see, so the list is short but not empty —
	// the dangerous middle case, because it looks complete.
	test('a schema composed with a spread reports no unknown keys', async () => {
		await write({
			'src/content/people/ada.md': '---\nname: Ada\norder: 1\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const base = { name: n.text() }
const people = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/people' }),
	schema: n.object({ ...base, order: n.number() }),
})
export const collections = { people }
`,
		})

		const report = await check()
		expect(report.findings).toEqual([])
	})

	const pathnameConfig = (spec: string, pattern = '*.md') =>
		`import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const events = defineCmsCollection({
	loader: glob({ pattern: '${pattern}', base: './src/content/events' }),
	schema: n.object({ title: n.text(), city: n.text() }),
	cms: { pathname: ${spec} },
})
export const collections = { events }
`

	// Two entries on one URL means one of them is unreachable. A warning, not an error: the build
	// is green, the second entry just never renders.
	test('two entries whose pathname rule resolves to the same URL is a warning', async () => {
		await write({
			'src/content/events/one.md': '---\ntitle: One\ncity: praha\n---\n',
			'src/content/events/two.md': '---\ntitle: Two\ncity: praha\n---\n',
			'src/content.config.ts': pathnameConfig("[{ literal: 'akce' }, { field: 'city' }]"),
		})

		const report = await check()
		expect(report.findings).toHaveLength(1)
		expect(report.findings[0]!.severity).toBe('warning')
		expect(report.findings[0]!.code).toBe('entry/pathname-collision')
		expect(report.findings[0]!.file).toBe('src/content/events/two.md')
		expect(report.findings[0]!.message).toContain('src/content/events/one.md')
		expect(report.findings[0]!.message).toContain('/akce/praha')
	})

	// Every bundle entry is named `index`, so only the path tells the two apart.
	test('the collision names the other entry by path, not by file stem', async () => {
		await write({
			'src/content/events/one/index.md': '---\ntitle: One\ncity: praha\n---\n',
			'src/content/events/two/index.md': '---\ntitle: Two\ncity: praha\n---\n',
			'src/content.config.ts': pathnameConfig("[{ literal: 'akce' }, { field: 'city' }]", '**/*.md'),
		})

		const report = await check()
		expect(report.findings.map(f => [f.code, f.file])).toEqual([['entry/pathname-collision', 'src/content/events/two/index.md']])
		expect(report.findings[0]!.message).toContain('src/content/events/one/index.md')
	})

	test('entries the pathname rule sends to distinct URLs report nothing', async () => {
		await write({
			'src/content/events/one.md': '---\ntitle: One\ncity: praha\n---\n',
			'src/content/events/two.md': '---\ntitle: Two\ncity: brno\n---\n',
			'src/content.config.ts': pathnameConfig("[{ literal: 'akce' }, { field: 'city' }]"),
		})

		const report = await check()
		expect(report.findings).toEqual([])
	})
})

// A hint is a proposal, not an observation. It has to be told apart from the finding above it
// at a glance, or a reader takes "mark the field `hidden`" for something the checker saw.
describe('formatCheckReport', () => {
	test('renders a hint indented under its finding, and nothing extra without one', () => {
		const report = {
			collections: 1,
			entries: 0,
			findings: [
				{ severity: 'error' as const, code: 'cms/empty-write', file: 'src/content.config.ts', message: 'Broken.', hint: 'Try this.' },
				{ severity: 'warning' as const, code: 'entry/unknown-key', file: 'src/content.config.ts', message: 'Odd.' },
			],
		}

		expect(formatCheckReport(report)).toBe(
			[
				'src/content.config.ts',
				'          error  Broken.  [cms/empty-write]',
				'                → Try this.',
				'          warn   Odd.  [entry/unknown-key]',
			].join('\n'),
		)
	})
})

describe('formatCheckReport hint runs', () => {
	const finding = (message: string, hint?: string, file = 'a.ts') => ({
		severity: 'error' as const,
		code: 'cms/empty-write',
		file,
		message,
		...(hint === undefined ? {} : { hint }),
	})

	test('an unbroken run of one remedy prints it once, and a different one interrupts the run', () => {
		const report = {
			collections: 1,
			entries: 0,
			findings: [finding('One.', 'Same.'), finding('Two.', 'Same.'), finding('Three.', 'Other.'), finding('Four.', 'Same.')],
		}

		expect(formatCheckReport(report).split('\n').filter(line => line.includes('→'))).toEqual([
			'                → Same.',
			'                → Other.',
			'                → Same.',
		])
	})

	// Suppressing across the boundary would open a file's block with a bare finding whose
	// remedy is only printed under some earlier file the reader may not have read.
	test('a run does not carry across a file boundary', () => {
		const report = {
			collections: 1,
			entries: 0,
			findings: [finding('One.', 'Same.', 'a.ts'), finding('Two.', 'Same.', 'b.ts')],
		}

		expect(formatCheckReport(report).split('\n').filter(line => line.includes('→'))).toHaveLength(2)
	})

	test('a finding with no hint breaks the run, so the next repeat is printed again', () => {
		const report = {
			collections: 1,
			entries: 0,
			findings: [finding('One.', 'Same.'), finding('Two.'), finding('Three.', 'Same.')],
		}

		expect(formatCheckReport(report).split('\n').filter(line => line.includes('→'))).toHaveLength(2)
	})
})
