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
	test('schema as a separate variable: not detected', () => {
		const result = parseConfigSource(`
			import { defineCollection } from 'astro:content'
			import { n } from '@nuasite/cms'
			const schema = n.object({ title: n.text() })
			const blog = defineCollection({ schema })
			export const collections = { blog }
		`)
		expect(result.get('blog')?.fields.length ?? 0).toBe(0)
	})

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
