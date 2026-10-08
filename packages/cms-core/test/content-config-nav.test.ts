import { createNodeFs, parseConfigSource, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// `cms: { label, hidden, order, group }` describes how a collection is named, placed and
// sectioned wherever collections are listed. Declared in the content config rather than
// the Astro config so the standalone sidecar — which never loads the latter — serves it too.
describe('parseConfigSource — cms.label / cms.hidden / cms.order / cms.group', () => {
	function config(cmsBlock: string): string {
		return `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const cases = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/pripady-pripady' }),
	schema: n.object({ title: n.text() }),
	cms: ${cmsBlock},
})
export const collections = { cases }
`
	}

	test('all four keys are parsed', () => {
		const parsed = parseConfigSource(config(`{ label: 'Případy', hidden: true, order: 2, group: 'English' }`)).get('cases')
		expect(parsed?.label).toBe('Případy')
		expect(parsed?.hidden).toBe(true)
		expect(parsed?.order).toBe(2)
		expect(parsed?.group).toBe('English')
	})

	test('they sit alongside the layout and title keys of the same block', () => {
		const parsed = parseConfigSource(config(`{ display: 'tabs', titleField: 'title', label: 'Případy', order: 1 }`)).get('cases')
		expect(parsed?.layout).toEqual({ display: 'tabs' })
		expect(parsed?.titleField).toBe('title')
		expect(parsed?.label).toBe('Případy')
		expect(parsed?.order).toBe(1)
	})

	test('order accepts zero, a negative and a fraction', () => {
		expect(parseConfigSource(config('{ order: 0 }')).get('cases')?.order).toBe(0)
		expect(parseConfigSource(config('{ order: -1 }')).get('cases')?.order).toBe(-1)
		expect(parseConfigSource(config('{ order: 1.5 }')).get('cases')?.order).toBe(1.5)
	})

	test('hidden: false leaves the collection listed', () => {
		expect(parseConfigSource(config('{ hidden: false }')).get('cases')?.hidden).toBeUndefined()
	})

	test('a value resolved through a top-level const is read', () => {
		const source = config('{ group: ENGLISH, order: LAST }').replace('const cases', `const ENGLISH = 'English'\nconst LAST = 99\nconst cases`)
		const parsed = parseConfigSource(source).get('cases')
		expect(parsed?.group).toBe('English')
		expect(parsed?.order).toBe(99)
	})

	test('a value of the wrong type or an empty string is ignored', () => {
		const parsed = parseConfigSource(config(`{ label: 42, hidden: 'yes', order: '1', group: '' }`)).get('cases')
		expect(parsed?.label).toBeUndefined()
		expect(parsed?.hidden).toBeUndefined()
		expect(parsed?.order).toBeUndefined()
		expect(parsed?.group).toBeUndefined()
		expect(parseConfigSource(config(`{ label: '' }`)).get('cases')?.label).toBeUndefined()
	})

	test('a non-literal value is ignored', () => {
		const parsed = parseConfigSource(config('{ label: t(`cases`), hidden: isProd, order: 1 + 1, group: `English` }')).get('cases')
		expect(parsed?.label).toBeUndefined()
		expect(parsed?.hidden).toBeUndefined()
		expect(parsed?.order).toBeUndefined()
		expect(parsed?.group).toBeUndefined()
	})

	// Known limitation, shared with every other key of the block: a collection the parser can
	// place neither by an inline schema nor by a `glob()` loader is skipped whole, and its
	// `cms` block with it. Registering it would change what the content check counts and
	// walks, so it is pinned here and documented rather than changed in passing.
	test('a collection with no readable schema and no glob loader is skipped, cms block included', () => {
		const skipped = (definition: string) =>
			parseConfigSource(`import { defineCmsCollection } from '@nuasite/cms'
import { file, glob } from 'astro/loaders'
import { caseSchema } from './schemas'
const cases = defineCmsCollection(${definition})
export const collections = { cases }
`).get('cases')

		expect(skipped(`{ cms: { hidden: true, label: 'Případy' } }`)).toBeUndefined()
		expect(skipped(`{ schema: caseSchema, cms: { hidden: true, label: 'Případy' } }`)).toBeUndefined()
		expect(skipped(`{ loader: file('src/data/cases.json'), schema: caseSchema, cms: { hidden: true } }`)).toBeUndefined()
		// A glob loader is enough to place it, whatever the schema is.
		const placed = skipped(`{ loader: glob({ pattern: '*.md', base: './src/content/cases' }), schema: caseSchema, cms: { hidden: true } }`)
		expect(placed?.hidden).toBe(true)
	})

	test('no cms block at all leaves every key undefined', () => {
		const parsed = parseConfigSource(`import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const cases = defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/pripady-pripady' }) })
export const collections = { cases }
`).get('cases')
		expect(parsed).toBeDefined()
		expect(parsed?.label).toBeUndefined()
		expect(parsed?.hidden).toBeUndefined()
		expect(parsed?.order).toBeUndefined()
		expect(parsed?.group).toBeUndefined()
	})
})

describe('scanCollections — collection-browser keys reach the collection definition', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__nav-scan-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	/** Write root-relative files (parent dirs included). */
	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	test('label overrides the name-derived default; order and group are carried over', async () => {
		await write({
			'src/content/pripady-pripady/prvni.md': '---\ntitle: První\n---\n',
			'src/content/press-releases/first.md': '---\ntitle: First\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
const cases = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { label: 'Případy', order: 1 },
})
const press = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { group: 'English' },
})
export const collections = { 'pripady-pripady': cases, 'press-releases': press }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(collections['pripady-pripady']?.label).toBe('Případy')
		expect(collections['pripady-pripady']?.order).toBe(1)
		expect(collections['pripady-pripady']?.group).toBeUndefined()
		// No `cms.label`: the name-derived default stays.
		expect(collections['press-releases']?.label).toBe('Press Releases')
		expect(collections['press-releases']?.order).toBeUndefined()
		expect(collections['press-releases']?.group).toBe('English')
	})

	test('a hidden collection is flagged, not dropped — it still resolves, entries and all', async () => {
		await write({
			'src/content/authors/jana.md': '---\ntitle: Jana\n---\n',
			'src/content/blog/hello.md': '---\ntitle: Hello\nauthor: jana\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
import { reference } from 'astro:content'
const authors = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { hidden: true },
})
const blog = defineCmsCollection({
	schema: n.object({ title: n.text(), author: reference('authors') }),
})
export const collections = { authors, blog }
`,
		})

		const collections = await scanCollections(createNodeFs(root))

		expect(collections['authors']?.hidden).toBe(true)
		expect(collections['authors']?.entries?.map(e => e.slug)).toEqual(['jana'])
		expect(collections['blog']?.hidden).toBeUndefined()
		// The reference picker of `blog.author` resolves through the hidden collection.
		expect(collections['blog']?.fields.find(f => f.name === 'author')?.collection).toBe('authors')
	})

	test('a site declaring none of the keys scans exactly as before', async () => {
		await write({
			'src/content/blog/hello.md': '---\ntitle: Hello\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
const blog = defineCmsCollection({
	schema: n.object({ title: n.text() }),
	cms: { display: 'tabs' },
})
export const collections = { blog }
`,
		})

		const blog = (await scanCollections(createNodeFs(root)))['blog']

		expect(blog?.label).toBe('Blog')
		expect(blog && 'hidden' in blog).toBe(false)
		expect(blog && 'order' in blog).toBe(false)
		expect(blog && 'group' in blog).toBe(false)
	})
})
