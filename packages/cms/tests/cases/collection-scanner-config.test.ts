import { expect, test } from 'bun:test'
import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import type { FieldDefinition } from '../../src/types'
import { setupContentCollections, type TempDirContext, withTempDir } from '../utils'

// Helper to write a content config with n-style schema
async function writeNuaConfig(ctx: TempDirContext, collectionName: string, schemaBody: string) {
	await ctx.writeFile(
		'src/content.config.ts',
		`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { n } from '@nuasite/cms'
const ${collectionName}Collection = defineCollection({
  schema: n.object({
${schemaBody}
  }),
})
export const collections = { ${collectionName}: ${collectionName}Collection }
`,
	)
}

// Helper to write multiple collections in one config
async function writeMultiConfig(ctx: TempDirContext, collections: Array<{ name: string; schemaBody: string }>) {
	const defs = collections
		.map(c =>
			`const ${c.name}Collection = defineCollection({
  schema: n.object({
${c.schemaBody}
  }),
})`
		)
		.join('\n')
	const exports = collections.map(c => `${c.name}: ${c.name}Collection`).join(', ')
	await ctx.writeFile(
		'src/content.config.ts',
		`import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { n } from '@nuasite/cms'
${defs}
export const collections = { ${exports} }
`,
	)
}

// ─── orderBy parsing ──────────────────────────────────────────────

withTempDir('collection-scanner: orderBy', (getCtx) => {
	test('discovers config-declared nested glob collections sharing a parent directory', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['foo'])
		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const foo = defineCollection({
  loader: glob({ pattern: '*/index.{md,mdx}', base: './src/content/foo' }),
})
const fooItems = defineCollection({
  loader: glob({ pattern: '*/items/*.{md,mdx}', base: './src/content/foo' }),
})
export const collections = { foo, 'foo-items': fooItems }
`,
		)

		await ctx.writeFile('src/content/foo/alpha/index.md', '---\ntitle: Alpha\n---\n')
		await ctx.writeFile('src/content/foo/beta/index.md', '---\ntitle: Beta\n---\n')
		await ctx.writeFile('src/content/foo/alpha/items/one.md', '---\ntitle: One\n---\n')
		await ctx.writeFile('src/content/foo/beta/items/two.mdx', '---\ntitle: Two\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		expect(Object.keys(result).sort()).toEqual(['foo', 'foo-items'])
		expect(result['foo']!.entries!.map(e => e.slug).sort()).toEqual(['alpha', 'beta'])
		expect(result['foo']!.entries!.map(e => e.sourcePath).sort()).toEqual([
			'src/content/foo/alpha/index.md',
			'src/content/foo/beta/index.md',
		])
		expect(result['foo-items']!.entries!.map(e => e.slug).sort()).toEqual(['alpha/items/one', 'beta/items/two'])
		expect(result['foo-items']!.entries!.map(e => e.sourcePath).sort()).toEqual([
			'src/content/foo/alpha/items/one.md',
			'src/content/foo/beta/items/two.mdx',
		])
	})

	test('detects .orderBy("asc") and sets direction', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])
		await writeNuaConfig(ctx, 'team', `    name: n.text(),\n    order: n.number().orderBy('asc'),`)

		await ctx.writeFile('src/content/team/b.md', '---\nname: Bob\norder: 2\n---\n')
		await ctx.writeFile('src/content/team/a.md', '---\nname: Alice\norder: 1\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const def = result['team']!
		expect(def.orderBy).toBe('order')
		expect(def.orderDirection).toBe('asc')
	})

	test('detects .orderBy("desc")', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['blog'])
		await writeNuaConfig(ctx, 'blog', `    title: n.text(),\n    date: n.date().orderBy('desc'),`)

		await ctx.writeFile('src/content/blog/old.md', '---\ntitle: Old\ndate: "2024-01-01"\n---\n')
		await ctx.writeFile('src/content/blog/new.md', '---\ntitle: New\ndate: "2025-06-15"\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const def = result['blog']!
		expect(def.orderBy).toBe('date')
		expect(def.orderDirection).toBe('desc')
	})

	test('defaults to asc when no direction argument', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['items'])
		await writeNuaConfig(ctx, 'items', `    name: n.text(),\n    order: n.number().orderBy(),`)

		await ctx.writeFile('src/content/items/a.md', '---\nname: A\norder: 1\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const def = result['items']!
		expect(def.orderBy).toBe('order')
		expect(def.orderDirection).toBe('asc')
	})

	test('no orderBy when not specified', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await writeNuaConfig(ctx, 'posts', `    title: n.text(),`)

		await ctx.writeFile('src/content/posts/a.md', '---\ntitle: A\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const def = result['posts']!
		expect(def.orderBy).toBeUndefined()
		expect(def.orderDirection).toBeUndefined()
	})

	test('sorts entries ascending by numeric field', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])
		await writeNuaConfig(ctx, 'team', `    name: n.text(),\n    order: n.number().orderBy('asc'),`)

		await ctx.writeFile('src/content/team/c.md', '---\nname: Charlie\norder: 3\n---\n')
		await ctx.writeFile('src/content/team/a.md', '---\nname: Alice\norder: 1\n---\n')
		await ctx.writeFile('src/content/team/b.md', '---\nname: Bob\norder: 2\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const slugs = result['team']!.entries!.map((e: { slug: string }) => e.slug)
		expect(slugs).toEqual(['a', 'b', 'c'])
	})

	test('sorts entries descending by date string', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['blog'])
		await writeNuaConfig(ctx, 'blog', `    title: n.text(),\n    date: n.text().orderBy('desc'),`)

		await ctx.writeFile('src/content/blog/old.md', '---\ntitle: Old\ndate: "2024-01-01"\n---\n')
		await ctx.writeFile('src/content/blog/mid.md', '---\ntitle: Mid\ndate: "2024-06-15"\n---\n')
		await ctx.writeFile('src/content/blog/new.md', '---\ntitle: New\ndate: "2025-01-01"\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const slugs = result['blog']!.entries!.map((e: { slug: string }) => e.slug)
		expect(slugs).toEqual(['new', 'mid', 'old'])
	})

	test('entries with null order field sort to end', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['items'])
		await writeNuaConfig(ctx, 'items', `    name: n.text(),\n    order: n.number().orderBy('asc'),`)

		await ctx.writeFile('src/content/items/no-order.md', '---\nname: No Order\n---\n')
		await ctx.writeFile('src/content/items/first.md', '---\nname: First\norder: 1\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const entries = result['items']!.entries!
		expect(entries[0]!.data?.name).toBe('First')
		// Entry without order field sorts to end
		expect(entries[entries.length - 1]!.data?.name).toBe('No Order')
	})
})

// ─── field hints parsing ──────────────────────────────────────────

withTempDir('collection-scanner: field hints', (getCtx) => {
	test('extracts number hints (min, max, step)', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])
		await writeNuaConfig(ctx, 'team', `    name: n.text(),\n    order: n.number({ min: 1, max: 100, step: 1 }),`)

		await ctx.writeFile('src/content/team/a.md', '---\nname: A\norder: 5\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['team']!.fields.find((f: FieldDefinition) => f.name === 'order')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.min).toBe(1)
		expect(field.hints!.max).toBe(100)
		expect(field.hints!.step).toBe(1)
	})

	test('extracts text hints (placeholder, maxLength)', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await writeNuaConfig(ctx, 'posts', `    title: n.text({ placeholder: "Enter title", maxLength: 120 }),`)

		await ctx.writeFile('src/content/posts/a.md', '---\ntitle: Hello\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'title')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.placeholder).toBe('Enter title')
		expect(field.hints!.maxLength).toBe(120)
	})

	test('extracts textarea hints (rows, maxLength)', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])
		await writeNuaConfig(ctx, 'team', `    name: n.text(),\n    bio: n.textarea({ rows: 4, maxLength: 500 }),`)

		await ctx.writeFile('src/content/team/a.md', '---\nname: A\nbio: Some bio\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['team']!.fields.find((f: FieldDefinition) => f.name === 'bio')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.rows).toBe(4)
		expect(field.hints!.maxLength).toBe(500)
	})

	test('extracts date hints (min, max as strings)', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['events'])
		await writeNuaConfig(ctx, 'events', `    title: n.text(),\n    date: n.date({ min: "2024-01-01", max: "2030-12-31" }),`)

		await ctx.writeFile('src/content/events/a.md', '---\ntitle: Event\ndate: "2025-06-01"\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['events']!.fields.find((f: FieldDefinition) => f.name === 'date')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.min).toBe('2024-01-01')
		expect(field.hints!.max).toBe('2030-12-31')
	})

	test('no hints when no options object', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await writeNuaConfig(ctx, 'posts', `    title: n.text(),\n    order: n.number(),`)

		await ctx.writeFile('src/content/posts/a.md', '---\ntitle: A\norder: 1\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'order')!
		expect(field.hints).toBeUndefined()
	})

	test('handles float step values', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['items'])
		await writeNuaConfig(ctx, 'items', `    name: n.text(),\n    price: n.number({ min: 0, step: 0.01 }),`)

		await ctx.writeFile('src/content/items/a.md', '---\nname: A\nprice: 9.99\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['items']!.fields.find((f: FieldDefinition) => f.name === 'price')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.step).toBe(0.01)
		expect(field.hints!.min).toBe(0)
	})

	test('handles single-quoted string values', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await writeNuaConfig(ctx, 'posts', `    title: n.text({ placeholder: 'Enter title' }),`)

		await ctx.writeFile('src/content/posts/a.md', '---\ntitle: Hello\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'title')!
		expect(field.hints!.placeholder).toBe('Enter title')
	})

	test('extracts hints from multiple fields', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])
		await writeNuaConfig(
			ctx,
			'team',
			`    name: n.text({ placeholder: "Full name", maxLength: 80 }),\n    order: n.number({ min: 1, max: 50 }),\n    bio: n.textarea({ rows: 6 }),`,
		)

		await ctx.writeFile('src/content/team/a.md', '---\nname: Alice\norder: 1\nbio: Bio text\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const fields = result['team']!.fields

		const name = fields.find((f: FieldDefinition) => f.name === 'name')!
		expect(name.hints!.placeholder).toBe('Full name')
		expect(name.hints!.maxLength).toBe(80)

		const order = fields.find((f: FieldDefinition) => f.name === 'order')!
		expect(order.hints!.min).toBe(1)
		expect(order.hints!.max).toBe(50)

		const bio = fields.find((f: FieldDefinition) => f.name === 'bio')!
		expect(bio.hints!.rows).toBe(6)
	})

	test('handles negative numbers in hints', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['data'])
		await writeNuaConfig(ctx, 'data', `    name: n.text(),\n    temp: n.number({ min: -40, max: 50 }),`)

		await ctx.writeFile('src/content/data/a.md', '---\nname: A\ntemp: 20\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['data']!.fields.find((f: FieldDefinition) => f.name === 'temp')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.min).toBe(-40)
		expect(field.hints!.max).toBe(50)
	})

	test('handles compact syntax without spaces', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['items'])
		await writeNuaConfig(ctx, 'items', `    name: n.text(),\n    qty: n.number({min:0,max:999}),`)

		await ctx.writeFile('src/content/items/a.md', '---\nname: A\nqty: 5\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['items']!.fields.find((f: FieldDefinition) => f.name === 'qty')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.min).toBe(0)
		expect(field.hints!.max).toBe(999)
	})

	test('handles multi-line options object', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])
		await writeNuaConfig(
			ctx,
			'team',
			`    name: n.text(),
    bio: n.textarea({
      rows: 5,
      maxLength: 1000,
    }),`,
		)

		await ctx.writeFile('src/content/team/a.md', '---\nname: A\nbio: Bio\n---\n')

		const result = await scanCollections(createNodeFs(process.cwd()))
		const field = result['team']!.fields.find((f: FieldDefinition) => f.name === 'bio')!
		expect(field.hints).toBeDefined()
		expect(field.hints!.rows).toBe(5)
		expect(field.hints!.maxLength).toBe(1000)
	})
})

// ─── n.array(reference()) and n.enum() ──────────────────────────

withTempDir('collection-scanner: n.array(reference()) and n.enum()', (getCtx) => {
	test('detects n.array(reference("tags")) as a reference array', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['tags', 'blog'])

		await ctx.writeFile(
			'src/content.config.ts',
			`import { defineCollection, reference } from 'astro:content'
import { z } from 'astro/zod'
import { n } from '@nuasite/cms'
const tagsCollection = defineCollection({
  schema: n.object({ name: n.text() }),
})
const blogCollection = defineCollection({
  schema: n.object({
    title: n.text(),
    tags: n.array(reference('tags')),
  }),
})
export const collections = { tags: tagsCollection, blog: blogCollection }
`,
		)

		await ctx.writeFile('src/content/tags/foo.json', JSON.stringify({ name: 'foo' }))
		await ctx.writeFile('src/content/blog/post-1.md', `---\ntitle: Post\ntags:\n  - foo\n---\nBody`)

		const result = await scanCollections(createNodeFs(process.cwd()))
		const tagsField = result['blog']!.fields.find((f: FieldDefinition) => f.name === 'tags')
		expect(tagsField).toBeDefined()
		expect(tagsField!.type).toBe('array')
		expect(tagsField!.itemType).toBe('reference')
		expect(tagsField!.collection).toBe('tags')
	})

	test('detects n.enum([...]) as a select field', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await writeNuaConfig(ctx, 'posts', `    title: n.text(),\n    status: n.enum(['draft', 'published', 'archived']),`)

		await ctx.writeFile('src/content/posts/post-1.md', `---\ntitle: Hello\nstatus: draft\n---\nBody`)

		const result = await scanCollections(createNodeFs(process.cwd()))
		const statusField = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'status')
		expect(statusField).toBeDefined()
		expect(statusField!.type).toBe('select')
		expect(statusField!.options).toEqual(['draft', 'published', 'archived'])
	})
})

// ─── n helper Zod validation ─────────────────────────────────────

withTempDir('n helpers: Zod validation with hints', (getCtx) => {
	// These tests import n directly — no file system needed, but withTempDir
	// groups them and resets caches between tests.

	test('n.number({ min, max }) rejects out-of-range values', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.number({ min: 1, max: 10 })
		expect(schema.safeParse(5).success).toBe(true)
		expect(schema.safeParse(0).success).toBe(false)
		expect(schema.safeParse(11).success).toBe(false)
	})

	test('n.text({ maxLength }) rejects long strings', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.text({ maxLength: 5 })
		expect(schema.safeParse('hi').success).toBe(true)
		expect(schema.safeParse('toolong').success).toBe(false)
	})

	test('n.text({ minLength }) rejects short strings', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.text({ minLength: 3 })
		expect(schema.safeParse('abc').success).toBe(true)
		expect(schema.safeParse('ab').success).toBe(false)
	})

	test('n.textarea({ maxLength }) rejects long strings', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.textarea({ maxLength: 10 })
		expect(schema.safeParse('short').success).toBe(true)
		expect(schema.safeParse('this is way too long').success).toBe(false)
	})

	test('n.number() without hints accepts any number', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.number()
		expect(schema.safeParse(0).success).toBe(true)
		expect(schema.safeParse(-999).success).toBe(true)
		expect(schema.safeParse(999999).success).toBe(true)
	})

	test('.orderBy() is chainable and returns valid schema', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.number({ min: 1 }).orderBy('asc')
		expect(schema.safeParse(5).success).toBe(true)
		expect(schema.safeParse(0).success).toBe(false)
	})

	test('.orderBy() survives .default() / .optional() / .nullable() / .nullish() wrappers at runtime', async () => {
		const { n } = await import('../../src/field-types')
		// Cast to any: the type signature still requires `.orderBy()` first (the canonical form),
		// but the runtime patch ensures the marker survives wrappers — so a wrong-order chain
		// won't crash, it just sorts identically.
		const hasOrderBy = (s: unknown) => typeof (s as { orderBy?: unknown }).orderBy === 'function'
		expect(hasOrderBy(n.number().default(0))).toBe(true)
		expect(hasOrderBy(n.number().optional())).toBe(true)
		expect(hasOrderBy(n.number().nullable())).toBe(true)
		expect(hasOrderBy(n.number().nullish())).toBe(true)
		expect(hasOrderBy(n.number().default(0).optional())).toBe(true)

		const schema = n.number({ min: 1 }).orderBy('asc').default(5)
		expect(schema.safeParse(undefined).success).toBe(true)
		expect(schema.parse(undefined)).toBe(5)
		expect(schema.safeParse(0).success).toBe(false)
	})

	test('n.date() coerces YAML Date objects to strings', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.date()
		// String date passes
		expect(schema.safeParse('2025-01-15').success).toBe(true)
		// Date object gets coerced to string
		expect(schema.safeParse(new Date('2025-01-15')).success).toBe(true)
	})

	test('n.boolean() validates booleans', async () => {
		const { n } = await import('../../src/field-types')
		const schema = n.boolean()
		expect(schema.safeParse(true).success).toBe(true)
		expect(schema.safeParse('yes').success).toBe(false)
	})
})
