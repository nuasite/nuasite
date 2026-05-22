import { describe, expect, test } from 'bun:test'
import { parseConfigSource } from '../../src/content-config-ast'

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
