import { defineCmsCollection, n } from '@nuasite/cms'
import { glob } from 'astro/loaders'
import { describe, expect, test } from 'bun:test'

describe('defineCmsCollection — runtime config normalization', () => {
	test('strips the `cms` block from the returned config', () => {
		const result = defineCmsCollection({
			schema: n.object({ title: n.text() }),
			cms: { pathname: [{ field: 'slug' }] },
		})
		expect('cms' in result).toBe(false)
		expect('schema' in result).toBe(true)
	})

	test('stamps `type: content_layer` on a loader (Content Layer) collection', () => {
		// Astro's content-config parser requires a loader collection to carry
		// `type: 'content_layer'` (its own `defineCollection` sets it). Without this
		// the bare config is rejected with "Invalid input" at content-config load.
		const result = defineCmsCollection({
			loader: glob({ pattern: '**/*.md', base: './content/articles' }),
			schema: n.object({ title: n.text() }),
			cms: { pathname: [{ field: 'slug' }] },
		})
		expect((result as { type?: string }).type).toBe('content_layer')
		expect('loader' in result).toBe(true)
	})

	test('leaves a loader-less (folder) collection without a `type`', () => {
		// Legacy `type: 'content'`/`'data'` collections have no `loader`; Astro's
		// parser accepts them with an absent type, so we must not stamp one.
		const result = defineCmsCollection({
			schema: n.object({ title: n.text() }),
			cms: { display: 'tabs' },
		})
		expect('type' in result).toBe(false)
	})

	test('does not override an explicit `type` on a loader collection', () => {
		const result = defineCmsCollection({
			type: 'content_layer',
			loader: glob({ pattern: '**/*.md', base: './content/x' }),
			schema: n.object({ title: n.text() }),
		})
		expect((result as { type?: string }).type).toBe('content_layer')
	})
})
