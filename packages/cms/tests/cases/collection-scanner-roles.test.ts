import { expect, test } from 'bun:test'
import { scanCollections } from '../../src/collection-scanner'
import { partitionFields } from '../../src/editor/components/field-utils'
import type { FieldDefinition } from '../../src/types'
import { setupContentCollections, withTempDir } from '../utils'

withTempDir('collection-scanner: semantic role detection', (getCtx) => {
	test('tags a boolean `draft` field as publish-toggle', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await ctx.writeFile('src/content/posts/post-1.md', `---\ntitle: A\ndraft: true\n---\n`)
		await ctx.writeFile('src/content/posts/post-2.md', `---\ntitle: B\ndraft: false\n---\n`)

		const result = await scanCollections()
		const draft = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'draft')
		expect(draft?.role).toBe('publish-toggle')
	})

	test('tags `isDraft` and other publish-toggle synonyms', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await ctx.writeFile('src/content/posts/post-1.md', `---\ntitle: A\nisDraft: true\npublished: false\n---\n`)
		await ctx.writeFile('src/content/posts/post-2.md', `---\ntitle: B\nisDraft: false\npublished: true\n---\n`)

		const result = await scanCollections()
		const fields = result['posts']!.fields
		const toggles = fields.filter((f: FieldDefinition) => f.role === 'publish-toggle')
		// Only the first matching boolean is tagged — one toggle per collection.
		expect(toggles.length).toBe(1)
		expect(['isDraft', 'published']).toContain(toggles[0]!.name)
	})

	test('non-boolean fields named draft are NOT tagged as publish-toggle', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await ctx.writeFile('src/content/posts/post-1.md', `---\ntitle: A\ndraft: "maybe"\n---\n`)

		const result = await scanCollections()
		const draft = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'draft')
		expect(draft?.role).toBeUndefined()
	})

	test('tags a `date` field as publish-date', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await ctx.writeFile('src/content/posts/post-1.md', `---\ntitle: A\ndate: '2025-01-01'\n---\n`)

		const result = await scanCollections()
		const date = result['posts']!.fields.find((f: FieldDefinition) => f.name === 'date')
		expect(date?.role).toBe('publish-date')
	})

	test('tags publish-date synonyms by name (publishDate, publishedAt, pubDate)', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['a', 'b', 'c'])
		await ctx.writeFile('src/content/a/e1.md', `---\ntitle: A\npublishDate: '2025-01-01'\n---\n`)
		await ctx.writeFile('src/content/b/e1.md', `---\ntitle: B\npublishedAt: '2025-01-01'\n---\n`)
		await ctx.writeFile('src/content/c/e1.md', `---\ntitle: C\npubDate: '2025-01-01'\n---\n`)

		const result = await scanCollections()
		expect(result['a']!.fields.find((f: FieldDefinition) => f.name === 'publishDate')?.role).toBe('publish-date')
		expect(result['b']!.fields.find((f: FieldDefinition) => f.name === 'publishedAt')?.role).toBe('publish-date')
		expect(result['c']!.fields.find((f: FieldDefinition) => f.name === 'pubDate')?.role).toBe('publish-date')
	})

	test('falls back to the first date-typed field when no name matches', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['events'])
		await ctx.writeFile('src/content/events/e1.md', `---\ntitle: A\neventDate: '2025-01-01'\n---\n`)

		const result = await scanCollections()
		const field = result['events']!.fields.find((f: FieldDefinition) => f.name === 'eventDate')
		expect(field?.type).toBe('date')
		expect(field?.role).toBe('publish-date')
	})

	test('only one publish-date is tagged per collection', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])
		await ctx.writeFile(
			'src/content/posts/post-1.md',
			`---\ntitle: A\ndate: '2025-01-01'\nupdatedAt: '2025-02-01'\n---\n`,
		)

		const result = await scanCollections()
		const tagged = result['posts']!.fields.filter((f: FieldDefinition) => f.role === 'publish-date')
		expect(tagged.length).toBe(1)
		expect(tagged[0]!.name).toBe('date')
	})
})

// ============================================================================
// partitionFields — UI consumer of the semantic roles
// ============================================================================

function field(overrides: Partial<FieldDefinition> & Pick<FieldDefinition, 'name'>): FieldDefinition {
	return { type: 'text', required: false, position: 'sidebar', ...overrides }
}

test('partitionFields: places publish-toggle above publish-date in the sidebar', () => {
	const { sidebar } = partitionFields([
		field({ name: 'title', position: 'header' }),
		field({ name: 'isDraft', type: 'boolean', role: 'publish-toggle' }),
		field({ name: 'releasedAt', type: 'date', role: 'publish-date' }),
		field({ name: 'cover', type: 'image' }),
	])
	const names = sidebar.map((f) => f.name)
	const draftIdx = names.indexOf('isDraft')
	const dateIdx = names.indexOf('releasedAt')
	expect(draftIdx).toBeGreaterThanOrEqual(0)
	expect(dateIdx).toBeGreaterThan(draftIdx)
})

test('partitionFields: prepends publish-toggle when no publish-date exists', () => {
	const { sidebar } = partitionFields([
		field({ name: 'cover', type: 'image' }),
		field({ name: 'author' }),
		field({ name: 'draft', type: 'boolean', role: 'publish-toggle' }),
	])
	expect(sidebar[0]!.name).toBe('draft')
})

test('partitionFields: respects @position header directive on the toggle', () => {
	const { sidebar, header } = partitionFields([
		field({ name: 'date', type: 'date', role: 'publish-date' }),
		field({ name: 'draft', type: 'boolean', role: 'publish-toggle', position: 'header' }),
	])
	expect(sidebar.some((f) => f.name === 'draft')).toBe(false)
	expect(header.some((f) => f.name === 'draft')).toBe(true)
})

test('partitionFields: ignores legacy magic-name fields without a role', () => {
	// A field literally named 'draft' but missing the role tag must not be moved —
	// proves the partitioning is driven by role, not by the field name.
	const { sidebar } = partitionFields([
		field({ name: 'date', type: 'date', role: 'publish-date' }),
		field({ name: 'draft', type: 'boolean' }),
	])
	expect(sidebar.map((f) => f.name)).toEqual(['date', 'draft'])
})
