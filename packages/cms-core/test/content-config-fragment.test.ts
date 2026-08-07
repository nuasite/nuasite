import { createNodeFs, parseConfigSource, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

// `cms: { fragment: true }` marks a collection that is rendered inside other pages and
// owns no URL of its own, so nothing downstream may invent one for its entries.
// `previewOf` names the page it shows up on — a preview target, not a URL claim.
describe('parseConfigSource — cms.fragment / cms.previewOf', () => {
	function config(cmsBlock: string): string {
		return `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const tags = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/tags' }),
	schema: n.object({ title: n.text() }),
	cms: ${cmsBlock},
})
export const collections = { tags }
`
	}

	test('fragment: true is parsed', () => {
		const parsed = parseConfigSource(config('{ fragment: true }'))
		expect(parsed.get('tags')?.fragment).toBe(true)
	})

	test('fragment: false leaves the collection routed as usual', () => {
		const parsed = parseConfigSource(config('{ fragment: false }'))
		expect(parsed.get('tags')?.fragment).toBeUndefined()
	})

	test('no cms block at all leaves fragment/previewOf undefined', () => {
		const parsed = parseConfigSource(`import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
const tags = defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/tags' }) })
export const collections = { tags }
`)
		expect(parsed.get('tags')?.fragment).toBeUndefined()
		expect(parsed.get('tags')?.previewOf).toBeUndefined()
	})

	test('previewOf is parsed alongside fragment', () => {
		const parsed = parseConfigSource(config(`{ fragment: true, previewOf: '/aktualne' }`))
		expect(parsed.get('tags')?.fragment).toBe(true)
		expect(parsed.get('tags')?.previewOf).toBe('/aktualne')
	})

	test('a non-string or empty previewOf is ignored', () => {
		expect(parseConfigSource(config('{ fragment: true, previewOf: 42 }')).get('tags')?.previewOf).toBeUndefined()
		expect(parseConfigSource(config(`{ fragment: true, previewOf: '' }`)).get('tags')?.previewOf).toBeUndefined()
	})

	test('fragment + pathname is reported as a conflict, not silently resolved', () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const parsed = parseConfigSource(config(`{ fragment: true, pathname: [{ literal: 'tags' }, { field: 'slug' }] }`))
			// The pathname rule loses — and the warning says which one won, so the outcome
			// isn't a silent preference.
			expect(parsed.get('tags')?.fragment).toBe(true)
			expect(parsed.get('tags')?.pathname).toBeUndefined()

			expect(warn).toHaveBeenCalledTimes(1)
			const message = String(warn.mock.calls[0]?.[0])
			expect(message).toContain('[cms]')
			expect(message).toContain('tags')
			expect(message).toContain('cms.fragment')
			expect(message).toContain('cms.pathname')
			expect(message).toContain('ignored')
		} finally {
			warn.mockRestore()
		}
	})

	test('pathname without fragment is untouched and warns about nothing', () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const parsed = parseConfigSource(config(`{ pathname: [{ literal: 'tags' }, { field: 'slug' }] }`))
			expect(parsed.get('tags')?.pathname).toEqual([{ literal: 'tags' }, { field: 'slug' }])
			expect(warn).not.toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})
})

describe('scanCollections — fragment reaches the collection definition', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__fragment-scan-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	test('fragment + previewOf are carried onto the scanned definition', async () => {
		const files: Record<string, string> = {
			'src/content/testimonials/jana.md': '---\ntitle: Jana\n---\n',
			'src/content.config.ts': `import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
const testimonials = defineCmsCollection({
	loader: glob({ pattern: '*.md', base: './src/content/testimonials' }),
	schema: n.object({ title: n.text() }),
	cms: { fragment: true, previewOf: '/' },
})
export const collections = { testimonials }
`,
		}
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}

		const collections = await scanCollections(createNodeFs(root))
		expect(collections['testimonials']?.fragment).toBe(true)
		expect(collections['testimonials']?.previewOf).toBe('/')
	})
})
