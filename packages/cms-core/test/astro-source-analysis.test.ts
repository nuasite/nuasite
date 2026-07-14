import { parse } from '@babel/parser'
import { describe, expect, test } from 'bun:test'
import { analyzeAstroContentAst, analyzeAstroScript, analyzeAstroSource, extractAstroFrontmatter } from '../src/astro-source-analysis'

describe('extractAstroFrontmatter', () => {
	test('handles a BOM and CRLF while preserving source coordinates', () => {
		const source = [
			'\uFEFF---',
			"import { getCollection } from 'astro:content'",
			"const posts = await getCollection('posts')",
			'---',
			'<h1>{posts.length}</h1>',
		].join('\r\n')

		const frontmatter = extractAstroFrontmatter(source)
		expect(frontmatter?.code).toBe(
			"import { getCollection } from 'astro:content'\r\nconst posts = await getCollection('posts')",
		)
		expect(frontmatter?.range).toEqual({
			start: { offset: source.indexOf('import'), line: 2, column: 0 },
			end: { offset: source.indexOf('\r\n---', source.indexOf('const posts')), line: 3, column: 42 },
		})

		const analysis = analyzeAstroSource(source)
		expect(analysis.collectionCalls).toHaveLength(1)
		expect(analysis.collectionCalls[0]?.range?.start).toEqual({
			offset: source.indexOf("getCollection('posts')"),
			line: 3,
			column: 20,
		})
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
		expect(analysis.imports[0]?.specifiers).toMatchObject([
			{ kind: 'default', localName: 'helper', typeOnly: false },
			{ kind: 'named', importedName: 'value', localName: 'localValue', typeOnly: false },
			{ kind: 'named', importedName: 'HelperType', localName: 'HelperType', typeOnly: true },
		])
		expect(analysis.imports[1]?.specifiers).toEqual([])
		expect(analysis.collectionCalls.map(call => ({
			accessor: call.accessor,
			collectionName: call.collectionName,
			access: call.access,
			localName: call.localName,
		}))).toEqual([
			{ accessor: 'getCollection', collectionName: 'posts', access: 'named', localName: 'collect' },
			{ accessor: 'getEntry', collectionName: 'authors', access: 'named', localName: 'entry' },
			{ accessor: 'getEntryBySlug', collectionName: 'notes', access: 'named', localName: 'bySlug' },
			{ accessor: 'getEntries', collectionName: null, access: 'named', localName: 'entries' },
			{ accessor: 'getCollection', collectionName: 'products', access: 'namespace', localName: 'content' },
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

		expect(analysis.collectionBindings.map(binding => ({
			localName: binding.localName,
			accessor: binding.accessor,
			collectionName: binding.collectionName,
			shape: binding.shape,
			itemPath: binding.itemPath,
			kind: binding.kind,
			sourceName: binding.sourceName,
		}))).toEqual([
			{
				localName: 'articles',
				accessor: 'getCollection',
				collectionName: 'articles',
				shape: 'array',
				itemPath: '',
				kind: 'call',
				sourceName: null,
			},
			{
				localName: 'articleAlias',
				accessor: 'getCollection',
				collectionName: 'articles',
				shape: 'array',
				itemPath: '',
				kind: 'alias',
				sourceName: 'articles',
			},
			{
				localName: 'items',
				accessor: 'getCollection',
				collectionName: 'articles',
				shape: 'array',
				itemPath: '.data',
				kind: 'map',
				sourceName: 'articleAlias',
			},
			{
				localName: 'titles',
				accessor: 'getCollection',
				collectionName: 'articles',
				shape: 'array',
				itemPath: '.data.title',
				kind: 'map',
				sourceName: 'items',
			},
			{
				localName: 'author',
				accessor: 'getEntry',
				collectionName: 'authors',
				shape: 'entry',
				itemPath: '',
				kind: 'call',
				sourceName: null,
			},
			{
				localName: 'authorAlias',
				accessor: 'getEntry',
				collectionName: 'authors',
				shape: 'entry',
				itemPath: '',
				kind: 'alias',
				sourceName: 'author',
			},
			{
				localName: 'page',
				accessor: 'getEntryBySlug',
				collectionName: 'pages',
				shape: 'entry',
				itemPath: '',
				kind: 'call',
				sourceName: null,
			},
		])
		expect(analysis.collectionBindings.some(binding => binding.localName === 'ambiguous')).toBe(false)
	})
})

describe('source entrypoints', () => {
	test('accepts a pre-parsed Babel file with an absolute source origin', () => {
		const source = "import { getCollection } from 'astro:content'\ngetCollection('posts')"
		const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })
		const analysis = analyzeAstroContentAst(ast, { offset: 100, line: 7, column: 3 })

		expect(analysis.collectionCalls[0]?.range?.start).toEqual({
			offset: 100 + source.indexOf("getCollection('posts')"),
			line: 8,
			column: 0,
		})
	})

	test('returns empty facts for missing or fatally invalid frontmatter', () => {
		const missing = analyzeAstroSource('<h1>No frontmatter</h1>')
		expect(missing).toMatchObject({
			ast: null,
			frontmatter: null,
			imports: [],
			collectionCalls: [],
			collectionBindings: [],
		})

		const invalid = analyzeAstroSource('---\nconst broken = "\n---\n<h1>Broken</h1>')
		expect(invalid.frontmatter).not.toBeNull()
		expect(invalid.ast).toBeNull()
		expect(invalid.collectionCalls).toEqual([])
	})
})
