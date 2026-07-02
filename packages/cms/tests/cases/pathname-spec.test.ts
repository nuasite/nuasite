import { computePathnameFromSpec, parseConfigSource } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'
import type { PathnameSpec } from '../../src/types'

describe('computePathnameFromSpec', () => {
	test('field + map: remapped value is used', () => {
		const spec: PathnameSpec = [{ field: 'topic', map: { aktualne: 'aktualne-z-nezisku' } }, { field: 'slug' }]
		expect(computePathnameFromSpec(spec, { topic: 'aktualne', slug: 'hello' })).toBe('/aktualne-z-nezisku/hello')
	})

	test('field + map: value not in map passes through', () => {
		const spec: PathnameSpec = [{ field: 'topic', map: { aktualne: 'aktualne-z-nezisku' } }, { field: 'slug' }]
		expect(computePathnameFromSpec(spec, { topic: 'fundraising', slug: 'hello' })).toBe('/fundraising/hello')
	})

	test('literal segment', () => {
		const spec: PathnameSpec = [{ literal: 'podcast' }, { field: 'slug' }]
		expect(computePathnameFromSpec(spec, { slug: 'ep-1' })).toBe('/podcast/ep-1')
	})

	test('urlFamily-style: two plain fields', () => {
		const spec: PathnameSpec = [{ field: 'urlFamily' }, { field: 'slug' }]
		expect(computePathnameFromSpec(spec, { urlFamily: 'autori', slug: 'jane-doe' })).toBe('/autori/jane-doe')
	})

	test('missing field yields undefined', () => {
		const spec: PathnameSpec = [{ field: 'urlFamily' }, { field: 'slug' }]
		expect(computePathnameFromSpec(spec, { slug: 'jane-doe' })).toBeUndefined()
	})

	test('numeric field value is coerced (YAML auto-coerces e.g. year: 2024)', () => {
		const spec: PathnameSpec = [{ literal: 'events' }, { field: 'year' }]
		expect(computePathnameFromSpec(spec, { year: 2024 })).toBe('/events/2024')
	})

	test('boolean field value is coerced', () => {
		const spec: PathnameSpec = [{ field: 'slug' }]
		expect(computePathnameFromSpec(spec, { slug: true })).toBe('/true')
	})

	test('date field value uses its ISO calendar day', () => {
		const spec: PathnameSpec = [{ literal: 'archive' }, { field: 'date' }]
		expect(computePathnameFromSpec(spec, { date: new Date('2024-01-15T00:00:00Z') })).toBe('/archive/2024-01-15')
	})

	test('numeric field value can still be remapped', () => {
		const spec: PathnameSpec = [{ field: 'year', map: { '2024': 'this-year' } }]
		expect(computePathnameFromSpec(spec, { year: 2024 })).toBe('/this-year')
	})

	test('non-coercible field value (object) yields undefined', () => {
		const spec: PathnameSpec = [{ field: 'slug' }]
		expect(computePathnameFromSpec(spec, { slug: { nested: true } })).toBeUndefined()
	})

	test('null field value yields undefined', () => {
		const spec: PathnameSpec = [{ field: 'slug' }]
		expect(computePathnameFromSpec(spec, { slug: null })).toBeUndefined()
	})

	test('trailing slash is stripped and duplicate slashes collapsed', () => {
		const spec: PathnameSpec = [{ literal: 'podcast/' }, { field: 'slug' }]
		expect(computePathnameFromSpec(spec, { slug: 'ep-1' })).toBe('/podcast/ep-1')
	})

	test('a single literal with a trailing slash normalizes without a trailing slash', () => {
		const spec: PathnameSpec = [{ literal: 'about/' }]
		expect(computePathnameFromSpec(spec, {})).toBe('/about')
	})
})

describe('parseConfigSource — cms.pathname extraction', () => {
	test('extracts a field+map / field pathname spec from defineCmsCollection', () => {
		const result = parseConfigSource(`
			import { defineCmsCollection, n } from '@nuasite/cms'
			import { glob } from 'astro/loaders'
			const articles = defineCmsCollection({
				loader: glob({ pattern: '**/*.md', base: './content/articles' }),
				schema: n.object({
					title: n.text(),
					topic: n.text(),
					slug: n.text(),
				}),
				cms: {
					pathname: [
						{ field: 'topic', map: { aktualne: 'aktualne-z-nezisku' } },
						{ field: 'slug' },
					],
				},
			})
			export const collections = { articles }
		`)
		expect(result.get('articles')?.pathname).toEqual([
			{ field: 'topic', map: { aktualne: 'aktualne-z-nezisku' } },
			{ field: 'slug' },
		])
	})

	test('extracts a literal + field pathname spec', () => {
		const result = parseConfigSource(`
			import { defineCmsCollection, n } from '@nuasite/cms'
			import { glob } from 'astro/loaders'
			const podcasts = defineCmsCollection({
				loader: glob({ pattern: '**/*.md', base: './content/podcasts' }),
				schema: n.object({ slug: n.text() }),
				cms: { pathname: [{ literal: 'podcast' }, { field: 'slug' }] },
			})
			export const collections = { podcasts }
		`)
		expect(result.get('podcasts')?.pathname).toEqual([{ literal: 'podcast' }, { field: 'slug' }])
	})

	test('omits pathname when the cms block has none', () => {
		const result = parseConfigSource(`
			import { defineCmsCollection, n } from '@nuasite/cms'
			import { glob } from 'astro/loaders'
			const people = defineCmsCollection({
				loader: glob({ pattern: '**/*.md', base: './content/people' }),
				schema: n.object({ slug: n.text() }),
				cms: { display: 'tabs' },
			})
			export const collections = { people }
		`)
		expect(result.get('people')?.pathname).toBeUndefined()
	})

	test('does not throw and omits pathname on a malformed spec', () => {
		const result = parseConfigSource(`
			import { defineCmsCollection, n } from '@nuasite/cms'
			import { glob } from 'astro/loaders'
			const broken = defineCmsCollection({
				loader: glob({ pattern: '**/*.md', base: './content/broken' }),
				schema: n.object({ slug: n.text() }),
				cms: { pathname: 'not-an-array' },
			})
			export const collections = { broken }
		`)
		expect(result.get('broken')?.pathname).toBeUndefined()
	})
})
