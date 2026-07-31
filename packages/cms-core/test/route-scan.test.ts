import { scanRouteCollections } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

function astro(frontmatter: string, body = '<h1>{entry.data.title}</h1>'): string {
	return `---\n${frontmatter}\n---\n\n${body}\n`
}

describe('scanRouteCollections', () => {
	test('extracts collections from an exported getStaticPaths function', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			export async function getStaticPaths() {
				const posts = await getCollection('posts')
				const references = await getCollection('references')
				return [...posts, ...references].map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
			}
		`)

		expect(scanRouteCollections(source)).toEqual({
			staticPaths: ['posts', 'references'],
			all: ['posts', 'references'],
		})
	})

	test('supports arrow and function-expression getStaticPaths declarations', () => {
		const arrow = astro(`
			import { getCollection } from 'astro:content'
			export const getStaticPaths = async () => {
				const services = await getCollection('services')
				return services.map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
			}
		`)
		const expression = astro(`
			import { getCollection } from 'astro:content'
			export const getStaticPaths = async function () {
				const products = await getCollection('products')
				return products.map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
			}
		`)

		expect(scanRouteCollections(arrow)).toEqual({ staticPaths: ['services'], all: ['services'] })
		expect(scanRouteCollections(expression)).toEqual({ staticPaths: ['products'], all: ['products'] })
	})

	test('recognizes aliased and namespace astro:content imports', () => {
		const source = astro(`
			import { getCollection as loadCollection } from 'astro:content'
			import * as content from 'astro:content'
			export async function getStaticPaths() {
				const products = await loadCollection('products')
				const references = await content.getCollection('references')
				return [...products, ...references]
			}
		`)

		expect(scanRouteCollections(source)).toEqual({
			staticPaths: ['products', 'references'],
			all: ['products', 'references'],
		})
	})

	test('accepts string and no-substitution template literals', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			export async function getStaticPaths() {
				const posts = await getCollection(\`posts\`)
				const collection = 'authors'
				const authors = await getCollection(collection)
				return [...posts, ...authors]
			}
		`)

		expect(scanRouteCollections(source)).toEqual({ staticPaths: ['posts'], all: ['posts'] })
	})

	test('only accepts getCollection references imported from astro:content', () => {
		const source = astro(`
			import { getEntry } from 'astro:content'
			import type { getCollection as typeGetCollection } from 'astro:content'
			import { getCollection as externalGetCollection } from './content'
			import * as externalContent from './content'
			function getCollection(name: string) { return name }
			getEntry('posts', 'first-post')
			typeGetCollection('type-only')
			getCollection('local')
			externalGetCollection('external')
			externalContent.getCollection('external-namespace')
		`)

		expect(scanRouteCollections(source)).toEqual({ staticPaths: [], all: [] })
	})

	test('rejects locally shadowed astro:content imports', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			function load(getCollection: (name: string) => unknown) {
				return getCollection('shadowed')
			}
			const posts = await getCollection('posts')
		`)

		expect(scanRouteCollections(source)).toEqual({ staticPaths: [], all: ['posts'] })
	})

	test('limits static path drivers to the exported function body', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			async function loadProducts() {
				return getCollection('products')
			}
			export async function getStaticPaths() {
				const posts = await getCollection('posts')
				const products = await loadProducts()
				return [...posts, ...products]
			}
			const authors = await getCollection('authors')
		`)

		expect(scanRouteCollections(source)).toEqual({
			staticPaths: ['posts'],
			all: ['products', 'posts', 'authors'],
		})
	})

	test('does not treat a non-exported getStaticPaths function as a route driver', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			async function getStaticPaths() {
				return getCollection('posts')
			}
		`)

		expect(scanRouteCollections(source)).toEqual({ staticPaths: [], all: ['posts'] })
	})

	test('keeps render lookups in all but excludes them from static path drivers', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			export async function getStaticPaths() {
				const posts = await getCollection('posts')
				return posts.map((entry) => ({ params: { slug: entry.id }, props: { entry } }))
			}
			const { entry } = Astro.props
			const authors = await getCollection('authors')
			const author = authors.find((candidate) => candidate.id === entry.data.author)
		`)

		expect(scanRouteCollections(source)).toEqual({ staticPaths: ['posts'], all: ['posts', 'authors'] })
	})

	test('deduplicates collections while preserving source order', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			const references = await getCollection('references')
			export async function getStaticPaths() {
				const posts = await getCollection('posts')
				const moreReferences = await getCollection('references')
				const morePosts = await getCollection('posts')
				return [...posts, ...moreReferences, ...morePosts]
			}
		`)

		expect(scanRouteCollections(source)).toEqual({
			staticPaths: ['posts', 'references'],
			all: ['references', 'posts'],
		})
	})

	test('ignores getCollection-like text in comments, strings, and template expressions', () => {
		const source = astro(`
			import { getCollection } from 'astro:content'
			// getCollection('comment')
			const example = "getCollection('string')"
			const name = 'dynamic'
			export async function getStaticPaths() {
				const dynamic = await getCollection(\`\${name}\`)
				return getCollection('posts')
			}
		`)

		expect(scanRouteCollections(source)).toEqual({ staticPaths: ['posts'], all: ['posts'] })
	})

	test('handles a BOM and CRLF frontmatter fences', () => {
		const source =
			"\uFEFF---\r\nimport { getCollection } from 'astro:content'\r\nexport const getStaticPaths = () => getCollection('posts')\r\n---\r\n<h1>Post</h1>\r\n"

		expect(scanRouteCollections(source)).toEqual({ staticPaths: ['posts'], all: ['posts'] })
	})

	test('returns empty for absent, empty, unclosed, and malformed frontmatter', () => {
		expect(scanRouteCollections('<h1>Just markup</h1>\n')).toEqual({ staticPaths: [], all: [] })
		expect(scanRouteCollections(astro(''))).toEqual({ staticPaths: [], all: [] })
		expect(scanRouteCollections("---\nimport { getCollection } from 'astro:content'\n")).toEqual({ staticPaths: [], all: [] })
		expect(scanRouteCollections(astro("import { getCollection } from 'astro:content'; const = getCollection('posts')"))).toEqual({
			staticPaths: [],
			all: [],
		})
	})
})
