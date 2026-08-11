import { applyDerivedTransform as coreApplyDerivedTransform, computeDerivedFieldUpdates } from '@nuasite/cms-core'
import type { CollectionDefinition, DerivedTransform } from '@nuasite/cms-types'
import { beforeEach, describe, expect, test } from 'bun:test'
import { currentMarkdownPage, markdownEditorState, resetAllState, setMarkdownPage, updateMarkdownFrontmatter } from '../../../src/editor/signals'
import type { BlogFrontmatter, MarkdownPageEntry } from '../../../src/editor/types'
import { applyDerivedTransform } from '../../../src/shared'

// The editor recomputes derived fields for instant feedback while typing, but the server
// (`applyDerivedFields` in `@nuasite/cms-core`) is what actually writes them. The two
// implementations are physically separate — `src/shared.ts` is bundled into the browser and
// cannot import `@nuasite/cms-core`, whose entry point reaches for `node:fs`. These tests are
// the thing that keeps them from drifting.
describe('derived fields — editor/server parity', () => {
	const CASES: Array<{ value: string; transform: DerivedTransform | undefined }> = [
		{ value: 'Aktuálně z nezisku', transform: undefined },
		{ value: 'Aktuálně z nezisku', transform: 'slugifyHref' },
		{ value: 'Aktuálně z nezisku', transform: 'slug' },
		{ value: 'Aktuálně z nezisku', transform: 'copy' },
		{ value: 'Lidé', transform: undefined },
		{ value: 'Lidé', transform: 'slug' },
		{ value: '', transform: undefined },
		{ value: '  Vedra jako zdravotní i sociální problém  ', transform: 'slug' },
		{ value: 'news/2024', transform: 'slug' },
		{ value: 'news/2024', transform: undefined },
		{ value: 'Už_tam_budeme?', transform: 'slug' },
	]

	test('every transform produces the identical string on both sides', () => {
		for (const { value, transform } of CASES) {
			expect(applyDerivedTransform(value, transform)).toBe(coreApplyDerivedTransform(value, transform))
		}
	})

	test('the default transform is `slugifyHref` on both sides', () => {
		expect(applyDerivedTransform('Lidé', undefined)).toBe('/lide')
		expect(coreApplyDerivedTransform('Lidé', undefined)).toBe('/lide')
	})

	test('`slug` drops the leading slash, `copy` changes nothing', () => {
		expect(applyDerivedTransform('Aktuálně z nezisku', 'slug')).toBe('aktualne-z-nezisku')
		expect(applyDerivedTransform('Aktuálně z nezisku', 'copy')).toBe('Aktuálně z nezisku')
	})
})

describe('derived fields — editor form state', () => {
	const fields: CollectionDefinition['fields'] = [
		{ name: 'title', type: 'text', required: true },
		{ name: 'category', type: 'text', required: true },
		{ name: 'categoryHref', type: 'text', required: false, hidden: true, derivedFrom: 'category' },
		{ name: 'categorySlug', type: 'text', required: false, hidden: true, derivedFrom: 'category', derivedTransform: 'slug' },
		{ name: 'titleCopy', type: 'text', required: false, hidden: true, derivedFrom: 'title', derivedTransform: 'copy' },
		// Declared derived but deliberately visible — still computed, exactly like on the server.
		{ name: 'visibleHref', type: 'text', required: false, hidden: false, derivedFrom: 'category' },
	]

	const collectionDefinition: CollectionDefinition = {
		name: 'articles',
		label: 'Articles',
		path: 'src/content/articles',
		entryCount: 1,
		fileExtension: 'md',
		fields,
	}

	const page: MarkdownPageEntry = {
		filePath: '/src/content/articles/aktualne.md',
		slug: 'aktualne',
		frontmatter: { title: 'Aktuálně', date: '2026-01-01', category: 'Lidé', categoryHref: '/lide' } as BlogFrontmatter,
		content: 'Body',
		isDirty: false,
	}

	beforeEach(() => {
		resetAllState()
		sessionStorage.clear()
		setMarkdownPage(page)
		markdownEditorState.value = { ...markdownEditorState.value, collectionDefinition }
	})

	test('editing the source field recomputes every field derived from it, each with its transform', () => {
		updateMarkdownFrontmatter({ category: 'Aktuálně z nezisku' } as Partial<BlogFrontmatter>)

		const frontmatter = currentMarkdownPage.value!.frontmatter as Record<string, unknown>
		expect(frontmatter['categoryHref']).toBe('/aktualne-z-nezisku')
		expect(frontmatter['categorySlug']).toBe('aktualne-z-nezisku')
	})

	test('a visible (`hidden: false`) derived field is computed too — the server does not consult `hidden` either', () => {
		updateMarkdownFrontmatter({ category: 'Lidé' } as Partial<BlogFrontmatter>)

		expect((currentMarkdownPage.value!.frontmatter as Record<string, unknown>)['visibleHref']).toBe('/lide')
	})

	test('a `copy` transform stores the source value verbatim', () => {
		updateMarkdownFrontmatter({ title: 'Aktuálně z nezisku' } as Partial<BlogFrontmatter>)

		expect((currentMarkdownPage.value!.frontmatter as Record<string, unknown>)['titleCopy']).toBe('Aktuálně z nezisku')
	})

	test('a non-string source value leaves the derived field alone', () => {
		updateMarkdownFrontmatter({ category: 42 } as unknown as Partial<BlogFrontmatter>)

		// Untouched: the stored value from the loaded page survives.
		expect((currentMarkdownPage.value!.frontmatter as Record<string, unknown>)['categoryHref']).toBe('/lide')
	})

	test('a patch that leaves the source alone computes nothing here — the server refreshes it on save', () => {
		// The editor only reacts to what the user just typed. For any field it *does* compute
		// the value equals the server's, because the server derives from a merge that carries
		// this very source value.
		updateMarkdownFrontmatter({ title: 'Nový titulek' } as Partial<BlogFrontmatter>)

		const frontmatter = currentMarkdownPage.value!.frontmatter as Record<string, unknown>
		expect(frontmatter['categoryHref']).toBe('/lide')
		expect(computeDerivedFieldUpdates(fields, frontmatter)['categoryHref']).toBe('/lide')
	})
})
