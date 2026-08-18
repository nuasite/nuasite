import { parseConfigSource } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

describe('parseConfigSource — supported forms', () => {
	test('detects fields in `n.object({...})` schema', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const blog = defineCollection({
				schema: n.object({
					title: n.text(),
					cover: n.image(),
				}),
			})
			export const collections = { blog }
		`)
		const blog = result.get('blog')
		expect(blog?.fields.map(f => f.name)).toEqual(['title', 'cover'])
		expect(blog?.fields.find(f => f.name === 'cover')?.type).toBe('image')
	})

	test('detects fields in callback-form `({ image }) => z.object({...})`', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { z } from 'astro/zod'
			const blog = defineCollection({
				schema: ({ image }) => z.object({
					title: z.string(),
					cover: image(),
				}),
			})
			export const collections = { blog }
		`)
		const blog = result.get('blog')
		expect(blog?.fields.find(f => f.name === 'cover')?.type).toBe('image')
	})

	test('walks into `n.array(n.object({...}))` and surfaces nested field types', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const newsletters = defineCollection({
				schema: n.object({
					year: n.datetime(),
					issues: n.array(
						n.object({
							label: n.text(),
							url: n.file(),
						}),
					),
				}),
			})
			export const collections = { newsletters }
		`)
		const issues = result.get('newsletters')?.fields.find(f => f.name === 'issues')
		expect(issues?.type).toBe('array')
		expect(issues?.itemType).toBe('object')
		expect(issues?.fields?.map(f => ({ name: f.name, type: f.type }))).toEqual([
			{ name: 'label', type: 'text' },
			{ name: 'url', type: 'file' },
		])
	})

	test('detects `n.year()` and `n.month()` as their own types', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const c = defineCollection({
				schema: n.object({
					y: n.year(),
					yBounded: n.year({ min: 2000, max: 2030 }),
					m: n.month(),
				}),
			})
			export const collections = { c }
		`)
		const fields = result.get('c')?.fields ?? []
		expect(fields.find(f => f.name === 'y')?.type).toBe('year')
		expect(fields.find(f => f.name === 'yBounded')).toMatchObject({ type: 'year', hints: { min: 2000, max: 2030 } })
		expect(fields.find(f => f.name === 'm')?.type).toBe('month')
	})

	test('walks into top-level `n.object({...})` and surfaces nested field types', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const blog = defineCollection({
				schema: n.object({
					meta: n.object({
						handle: n.text(),
						pic: n.image(),
					}),
				}),
			})
			export const collections = { blog }
		`)
		const meta = result.get('blog')?.fields.find(f => f.name === 'meta')
		expect(meta?.type).toBe('object')
		expect(meta?.fields?.map(f => ({ name: f.name, type: f.type }))).toEqual([
			{ name: 'handle', type: 'text' },
			{ name: 'pic', type: 'image' },
		])
	})

	test('resolves same-file `const` variable references for nested objects', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const TestimonialTranslation = n.object({
				quote: n.textarea(),
				parentName: n.text(),
			})
			const testimonials = defineCollection({
				schema: n.object({
					translations: n.object({
						cs: TestimonialTranslation,
						en: TestimonialTranslation.optional(),
					}),
				}),
			})
			export const collections = { testimonials }
		`)
		const translations = result.get('testimonials')?.fields.find(f => f.name === 'translations')
		expect(translations?.type).toBe('object')

		const cs = translations?.fields?.find(f => f.name === 'cs')
		expect(cs).toMatchObject({ type: 'object', required: true })
		expect(cs?.fields?.map(f => ({ name: f.name, type: f.type })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
			{ name: 'parentName', type: 'text' },
			{ name: 'quote', type: 'textarea' },
		])

		const en = translations?.fields?.find(f => f.name === 'en')
		expect(en).toMatchObject({ type: 'object', required: false })
		expect(en?.fields?.map(f => f.name).sort()).toEqual(['parentName', 'quote'])
	})

	test('resolves variable references inside `n.array(<var>)`', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const Issue = n.object({ label: n.text(), url: n.file() })
			const newsletters = defineCollection({
				schema: n.object({
					issues: n.array(Issue),
				}),
			})
			export const collections = { newsletters }
		`)
		const issues = result.get('newsletters')?.fields.find(f => f.name === 'issues')
		expect(issues?.type).toBe('array')
		expect(issues?.itemType).toBe('object')
		expect(issues?.fields?.map(f => ({ name: f.name, type: f.type })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
			{ name: 'label', type: 'text' },
			{ name: 'url', type: 'file' },
		])
	})

	test('resolves variable references for top-level schema (shorthand and named)', () => {
		// Shorthand: `defineCollection({ schema })`
		const shorthand = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const schema = n.object({ title: n.text() })
			const blog = defineCollection({ schema })
			export const collections = { blog }
		`)
		expect(shorthand.get('blog')?.fields.map(f => f.name)).toEqual(['title'])

		// Named: `defineCollection({ schema: BlogSchema })`
		const named = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const BlogSchema = n.object({ title: n.text(), tags: n.array(n.text()) })
			const blog = defineCollection({ schema: BlogSchema })
			export const collections = { blog }
		`)
		expect(named.get('blog')?.fields.map(f => ({ name: f.name, type: f.type }))).toEqual([
			{ name: 'title', type: 'text' },
			{ name: 'tags', type: 'array' },
		])
	})

	test('Identifier cycles do not loop and unbound identifiers leave field untyped', () => {
		// Cycle: const a = b; const b = a — must terminate.
		const cycle = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const a = b
			const b = a
			const c = defineCollection({
				schema: n.object({ x: a }),
			})
			export const collections = { c }
		`)
		const x = cycle.get('c')?.fields.find(f => f.name === 'x')
		expect(x?.name).toBe('x')
		expect(x?.type).toBeUndefined()

		// Unbound: imported (not const-declared) identifier — also leaves type undefined.
		const unbound = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			import { Something } from './elsewhere'
			const c = defineCollection({
				schema: n.object({ x: Something }),
			})
			export const collections = { c }
		`)
		const xu = unbound.get('c')?.fields.find(f => f.name === 'x')
		expect(xu?.name).toBe('x')
		expect(xu?.type).toBeUndefined()
	})

	test('tags `image()` callback-form fields with astroImage=true', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { z } from 'astro/zod'
			import { n } from '@nuasite/cms'
			const blog = defineCollection({
				schema: ({ image }) => z.object({
					cover: image(),
					thumbnail: n.image(),
				}),
			})
			export const collections = { blog }
		`)
		const fields = result.get('blog')?.fields ?? []
		expect(fields.find(f => f.name === 'cover')?.astroImage).toBe(true)
		expect(fields.find(f => f.name === 'thumbnail')?.astroImage).toBeUndefined()
	})

	// An enum spelled as a shared `const` is the same closed list as an inline array — the
	// editor has to render a select either way, and the check has to know the allowed values.
	test('resolves a same-file `const` enum list, with and without `as const`', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			import { z } from 'astro/zod'
			const ROLES = ['expert', 'author']
			const KINDS = ['tip', 'news'] as const
			const c = defineCollection({
				schema: n.object({
					role: n.enum(ROLES),
					kind: z.enum(KINDS),
					inline: n.enum(['a', 'b']),
				}),
			})
			export const collections = { c }
		`)
		const fields = result.get('c')?.fields ?? []
		expect(fields.find(f => f.name === 'role')).toMatchObject({ type: 'select', options: ['expert', 'author'], required: true })
		expect(fields.find(f => f.name === 'kind')).toMatchObject({ type: 'select', options: ['tip', 'news'] })
		// Same shape as the inline form it is equivalent to.
		expect(fields.find(f => f.name === 'inline')).toMatchObject({ type: 'select', options: ['a', 'b'] })
	})

	test('a `const` enum list still carries the layout hints of its second argument', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const ROLES = ['expert', 'author']
			const c = defineCollection({
				schema: n.object({ role: n.enum(ROLES, { label: 'Role' }) }),
			})
			export const collections = { c }
		`)
		expect(result.get('c')?.fields.find(f => f.name === 'role')).toMatchObject({
			type: 'select',
			options: ['expert', 'author'],
			layout: { label: 'Role' },
		})
	})

	test('detects `n.boolean()` and `z.boolean()` as boolean fields', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			import { z } from 'astro/zod'
			const c = defineCollection({
				schema: n.object({
					draft: n.boolean(),
					featured: z.boolean(),
					archived: n.boolean().optional(),
					published: n.boolean().default(true),
				}),
			})
			export const collections = { c }
		`)
		const fields = result.get('c')?.fields ?? []
		expect(fields.find(f => f.name === 'draft')).toMatchObject({ type: 'boolean', required: true })
		expect(fields.find(f => f.name === 'featured')).toMatchObject({ type: 'boolean', required: true })
		expect(fields.find(f => f.name === 'archived')).toMatchObject({ type: 'boolean', required: false })
		expect(fields.find(f => f.name === 'published')).toMatchObject({ type: 'boolean', required: false })
	})

	// A field factory keeps a repeated declaration in one place. The wrappers it applies are
	// part of the declaration, so `.optional()` inside the helper has to reach the field —
	// otherwise the write guard enforces a field the schema does not require.
	test('resolves a same-file zero-argument helper, including the wrappers it hides', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const optionalTag = () => n.enum(['news', 'tips']).optional()
			const requiredHeading = () => n.text({ maxLength: 80 })
			const viaBlock = () => {
				return n.number().optional()
			}
			const c = defineCollection({
				schema: n.object({
					tag: optionalTag(),
					heading: requiredHeading(),
					weight: viaBlock(),
					taggedAgain: optionalTag().optional(),
				}),
			})
			export const collections = { c }
		`)
		const fields = result.get('c')?.fields ?? []
		expect(fields.find(f => f.name === 'tag')).toMatchObject({ type: 'select', options: ['news', 'tips'], required: false })
		expect(fields.find(f => f.name === 'heading')).toMatchObject({ type: 'text', required: true, hints: { maxLength: 80 } })
		expect(fields.find(f => f.name === 'weight')).toMatchObject({ type: 'number', required: false })
		expect(fields.find(f => f.name === 'taggedAgain')).toMatchObject({ type: 'select', required: false })
	})

	// Parsed options become a *closed* list downstream, so half of one is worse than none:
	// the field would reject every value we failed to read, and the entries already holding
	// those values would be uneditable. Reading the list is all-or-nothing.
	test('an enum list we cannot read whole leaves the field open, not half-closed', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			import { z } from 'astro/zod'
			import { EXTRA } from './elsewhere'
			const BASE = ['zpravy', 'tipy']
			const ALL = [...BASE, 'blog'] as const
			const c = defineCollection({
				schema: n.object({
					viaConst: n.enum(ALL),
					inlineSpread: z.enum([...BASE, 'blog'] as const),
					mixedMembers: n.enum(['blog', EXTRA]),
					templated: n.enum([\`blog\`, 'zpravy']),
				}),
			})
			export const collections = { c }
		`)
		for (const name of ['viaConst', 'inlineSpread', 'mixedMembers', 'templated']) {
			const field = result.get('c')?.fields.find(f => f.name === name)
			expect(field).toMatchObject({ name, required: true })
			expect(field?.type).toBeUndefined()
			expect(field?.options).toBeUndefined()
		}
	})

	// `.array()` is the postfix spelling of `n.array(inner)` and has to produce the same field.
	// Left unhandled the walk stepped into the receiver and stamped the *element* type on the
	// list, so the editor rendered one toggle for a list of booleans.
	test('`.array()` lifts the receiver into itemType, like `n.array(inner)`', () => {
		const result = parseConfigSource(`
			import { defineCollection, reference } from 'astro:content'
			import { n } from '@nuasite/cms'
			import { z } from 'astro/zod'
			const c = defineCollection({
				schema: n.object({
					flags: z.boolean().array(),
					flagsN: n.boolean().array(),
					tags: n.text().array(),
					rows: n.object({ label: n.text() }).array(),
					authors: reference('authors').array(),
					maybe: n.text().array().optional(),
				}),
			})
			export const collections = { c }
		`)
		const fields = result.get('c')?.fields ?? []
		expect(fields.find(f => f.name === 'flags')).toMatchObject({ type: 'array', itemType: 'boolean' })
		expect(fields.find(f => f.name === 'flagsN')).toMatchObject({ type: 'array', itemType: 'boolean' })
		expect(fields.find(f => f.name === 'tags')).toMatchObject({ type: 'array', itemType: 'text' })
		expect(fields.find(f => f.name === 'rows')).toMatchObject({
			type: 'array',
			itemType: 'object',
			fields: [{ name: 'label', type: 'text' }],
		})
		// An array of references keeps the flat shape `n.array(reference())` produces.
		expect(fields.find(f => f.name === 'authors')).toMatchObject({ reference: { target: 'authors', isArray: true } })
		expect(fields.find(f => f.name === 'maybe')).toMatchObject({ type: 'array', itemType: 'text', required: false })
	})

	// There is no scope model here: `bindings` is module-level only, so a local of the same
	// name would resolve to the module-level declaration — a wrong option list, or a wrong
	// `required` flag, which is the direction the write guard trusts. A name the file declares
	// twice is therefore not resolved at all.
	test('a name declared twice in the file is not resolved — the field degrades instead', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const ROLES = ['expert', 'author']
			const tagField = () => n.enum(['news', 'tips']).optional()
			const c = defineCollection({
				schema: ({ image }) => {
					const ROLES = ['nope']
					const tagField = () => n.text()
					return n.object({
						role: n.enum(ROLES),
						tag: tagField(),
						cover: image(),
					})
				},
			})
			export const collections = { c }
		`)
		const fields = result.get('c')?.fields ?? []

		const role = fields.find(f => f.name === 'role')
		expect(role?.type).toBeUndefined()
		expect(role?.options).toBeUndefined()

		// Not resolved either way round: neither the module-level `.optional()` nor the local `n.text()`.
		const tag = fields.find(f => f.name === 'tag')
		expect(tag).toMatchObject({ name: 'tag', required: true })
		expect(tag?.type).toBeUndefined()

		// The callback's own `image` param is matched by name, so it is unaffected.
		expect(fields.find(f => f.name === 'cover')).toMatchObject({ type: 'image', astroImage: true })
	})

	test('a self-referential helper terminates and leaves the field untyped', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const loop = () => loop()
			const c = defineCollection({ schema: n.object({ x: loop() }) })
			export const collections = { c }
		`)
		const x = result.get('c')?.fields.find(f => f.name === 'x')
		expect(x).toMatchObject({ name: 'x', required: true })
		expect(x?.type).toBeUndefined()
	})

	test('captures glob loader pattern and base', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { glob } from 'astro/loaders'
			const c = defineCollection({
				loader: glob({ pattern: \`*/items/*.{md,mdx}\`, base: './src/content/foo' }),
			})
			export const collections = { c }
		`)
		expect(result.get('c')).toMatchObject({
			loaderPattern: '*/items/*.{md,mdx}',
			loaderBase: './src/content/foo',
		})
	})
})

// These tests pin down patterns the parser intentionally doesn't handle.
// Flip the assertion if we add support.
describe('parseConfigSource — unsupported patterns', () => {
	test('spread operators inside the schema object: silently skipped', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const base = { title: n.text() }
			const blog = defineCollection({
				schema: n.object({
					...base,
					cover: n.image(),
				}),
			})
			export const collections = { blog }
		`)
		const names = result.get('blog')?.fields.map(f => f.name) ?? []
		expect(names).toEqual(['cover'])
	})

	test('renamed `defineCollection` import: not detected', () => {
		const result = parseConfigSource(`
			import { defineCollection as dc } from 'astro:content'
			import { n } from '@nuasite/cms'
			const blog = dc({
				schema: n.object({ title: n.text() }),
			})
			export const collections = { blog }
		`)
		expect(result.size).toBe(0)
	})

	// Only the config file is parsed, so a helper defined elsewhere has no body to read.
	// Guessing a type from the call alone would invent a schema the project never declared.
	test('a helper imported from another module: field stays untyped and required', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			import { optionalTag } from './fields'
			const c = defineCollection({ schema: n.object({ tag: optionalTag() }) })
			export const collections = { c }
		`)
		const tag = result.get('c')?.fields.find(f => f.name === 'tag')
		expect(tag).toMatchObject({ name: 'tag', required: true })
		expect(tag?.type).toBeUndefined()
	})

	test('a helper taking arguments: not resolved', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const tagField = (label: string) => n.enum(['news', 'tips'], { label }).optional()
			const c = defineCollection({ schema: n.object({ tag: tagField('Rubrika') }) })
			export const collections = { c }
		`)
		const tag = result.get('c')?.fields.find(f => f.name === 'tag')
		expect(tag).toMatchObject({ name: 'tag', required: true })
		expect(tag?.type).toBeUndefined()
	})

	test('an enum list built at runtime: not resolved', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const ROLES = ['expert', 'author'].map(r => r.toUpperCase())
			const c = defineCollection({ schema: n.object({ role: n.enum(ROLES) }) })
			export const collections = { c }
		`)
		const role = result.get('c')?.fields.find(f => f.name === 'role')
		expect(role?.type).toBeUndefined()
		expect(role?.options).toBeUndefined()
	})

	test('renamed `z` / `n` import: not detected', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { z as zod } from 'astro/zod'
			const blog = defineCollection({
				schema: zod.object({ title: zod.string() }),
			})
			export const collections = { blog }
		`)
		expect(result.get('blog')?.fields.length ?? 0).toBe(0)
	})
})

describe('parseConfigSource — failure modes', () => {
	test('completely unparseable source returns an empty map', () => {
		const result = parseConfigSource('this is not @ valid !#% TypeScript at all }')
		expect(result.size).toBe(0)
	})

	test('source with no defineCollection calls returns an empty map', () => {
		const result = parseConfigSource(`
			import { z } from 'astro/zod'
			export const schema = z.object({ title: z.string() })
		`)
		expect(result.size).toBe(0)
	})
})
