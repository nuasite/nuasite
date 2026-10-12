import { describe, expect, test } from 'bun:test'
import { analyzeAstroScript, analyzeAstroSource } from '../src/astro-source-analysis'

describe('Astro frontmatter', () => {
	test('handles a BOM and CRLF', () => {
		const source = [
			'\uFEFF---',
			"import { getCollection } from 'astro:content'",
			"const posts = await getCollection('posts')",
			'---',
			'<h1>{posts.length}</h1>',
		].join('\r\n')

		const analysis = analyzeAstroSource(source)
		expect(analysis.imports).toEqual([{ source: 'astro:content' }])
		expect(analysis.collectionCalls[0]).toMatchObject({ accessor: 'getCollection', collectionName: 'posts' })
	})
})

describe('Astro content imports and calls', () => {
	test('recognizes named aliases, namespace access, all accessors, and static templates', () => {
		const analysis = analyzeAstroScript(`
			import helper, { value as localValue, type HelperType } from './helper'
			import './side-effect'
			import {
				getCollection as collect,
				getEntry as entry,
				getEntryBySlug as bySlug,
				getEntries as entries,
			} from 'astro:content'
			import * as content from 'astro:content'
			await collect('posts')
			await entry(\`authors\`, 'ada')
			await bySlug('notes', 'welcome')
			await entries([])
			await content.getCollection(\`products\`)
		`)

		expect(analysis.imports.map(imported => imported.source)).toEqual([
			'./helper',
			'./side-effect',
			'astro:content',
			'astro:content',
		])
		expect(analysis.collectionCalls.map(call => ({
			accessor: call.accessor,
			collectionName: call.collectionName,
		}))).toEqual([
			{ accessor: 'getCollection', collectionName: 'posts' },
			{ accessor: 'getEntry', collectionName: 'authors' },
			{ accessor: 'getEntryBySlug', collectionName: 'notes' },
			{ accessor: 'getEntries', collectionName: null },
			{ accessor: 'getCollection', collectionName: 'products' },
		])
	})

	test('rejects local, unrelated, type-only, and shadowed accessor names', () => {
		const analysis = analyzeAstroScript(`
			import { getCollection as collect } from 'astro:content'
			import type { getEntry } from 'astro:content'
			import { getCollection as unrelated } from './helper'
			function getCollection(name: string) { return name }
			function shadowed(collect: (name: string) => unknown) {
				collect('shadowed')
			}
			getCollection('local')
			getEntry('type-only', 'entry')
			unrelated('unrelated')
			collect('verified')
		`)

		expect(analysis.collectionCalls.map(call => call.collectionName)).toEqual(['verified'])
	})

	test('marks only calls inside the exported getStaticPaths function', () => {
		const analysis = analyzeAstroScript(`
			import { getCollection, getEntry } from 'astro:content'
			export async function getStaticPaths() {
				const posts = await getCollection('posts')
				await getEntry('authors', 'ada')
				return posts.map(post => ({ params: { slug: post.id } }))
			}
			await getCollection('navigation')
		`)

		expect(analysis.collectionCalls.map(call => [
			call.collectionName,
			call.inExportedGetStaticPaths,
		])).toEqual([
			['posts', true],
			['authors', true],
			['navigation', false],
		])
	})

	test('recognizes a locally named function exported as getStaticPaths', () => {
		const analysis = analyzeAstroScript(`
			import * as content from 'astro:content'
			const buildPaths = async () => content.getCollection('pages')
			export { buildPaths as getStaticPaths }
		`)

		expect(analysis.collectionCalls[0]?.inExportedGetStaticPaths).toBe(true)
	})
})

describe('top-level collection bindings', () => {
	test('tracks direct calls, aliases, entry shapes, and map projections', () => {
		const analysis = analyzeAstroScript(`
			import { getCollection as load, getEntry, getEntryBySlug, getEntries } from 'astro:content'
			const articles = await load('articles')
			const articleAlias = articles
			const items = articleAlias.map(article => article.data)
			const titles = items.map(item => item.title)
			const author = await getEntry('authors', 'ada')
			const authorAlias = author
			const page = await getEntryBySlug(\`pages\`, 'home')
			const ambiguous = await getEntries([])
		`)

		expect(analysis.collectionBindings).toEqual([
			{
				localName: 'articles',
				collectionName: 'articles',
				itemPath: '',
			},
			{
				localName: 'articleAlias',
				collectionName: 'articles',
				itemPath: '',
			},
			{
				localName: 'items',
				collectionName: 'articles',
				itemPath: '.data',
			},
			{
				localName: 'titles',
				collectionName: 'articles',
				itemPath: '.data.title',
			},
			{
				localName: 'author',
				collectionName: 'authors',
				itemPath: '',
			},
			{
				localName: 'authorAlias',
				collectionName: 'authors',
				itemPath: '',
			},
			{
				localName: 'page',
				collectionName: 'pages',
				itemPath: '',
			},
		])
		expect(analysis.collectionBindings.some(binding => binding.localName === 'ambiguous')).toBe(false)
	})
})

describe('source entrypoints', () => {
	test('parses JSX and TSX modules', () => {
		const analysis = analyzeAstroScript(`
			import { getCollection } from 'astro:content'
			const posts = await getCollection('posts')
			export const Listing = () => <ul>{posts.map(post => <li>{post.id}</li>)}</ul>
		`)

		expect(analysis.collectionCalls.map(call => call.collectionName)).toEqual(['posts'])
	})

	test('returns empty facts for missing or fatally invalid frontmatter', () => {
		const missing = analyzeAstroSource('<h1>No frontmatter</h1>')
		expect(missing).toEqual({
			imports: [],
			collectionCalls: [],
			collectionBindings: [],
		})

		const invalid = analyzeAstroSource('---\nconst broken = "\n---\n<h1>Broken</h1>')
		expect(invalid).toEqual({ imports: [], collectionCalls: [], collectionBindings: [] })
	})
})
