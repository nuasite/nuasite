import { parse } from '@astrojs/compiler'
import { describe, expect, test } from 'bun:test'
import { createProjectContext, runInProjectContext } from '../../../src/project/context'
import { pageRouteFile, projectTemplatesAmong } from '../../../src/source-finder/source-files'
import { createMemoryFileSystem } from '../../utils/memory-fs'

function inProject<T>(files: string[], run: () => T): T {
	const context = createProjectContext({
		root: '/project',
		fs: createMemoryFileSystem(Object.fromEntries(files.map(file => [file, '']))),
		parseAstro: parse,
	})
	return runInProjectContext(context, run)
}

function routeOf(files: string[], pageUrl: string): Promise<string | undefined> {
	return inProject(files, () => pageRouteFile(pageUrl))
}

describe('pageRouteFile', () => {
	test('a static page before a parameter before a catch-all', async () => {
		expect(await routeOf(['src/pages/about.astro', 'src/pages/[slug].astro', 'src/pages/[...rest].astro'], '/about')).toBe('src/pages/about.astro')
		expect(await routeOf(['src/pages/[slug].astro', 'src/pages/[...rest].astro'], '/about')).toBe('src/pages/[slug].astro')
		expect(await routeOf(['src/pages/[...rest].astro'], '/a/b/c')).toBe('src/pages/[...rest].astro')
	})

	test('a static directory before a parameter directory, also when only a deeper level is static', async () => {
		expect(await routeOf(['src/pages/blog/[slug].astro', 'src/pages/[lang]/about.astro'], '/blog/first')).toBe('src/pages/blog/[slug].astro')
		expect(await routeOf(['src/pages/[lang]/about.astro'], '/en/about')).toBe('src/pages/[lang]/about.astro')
		expect(await routeOf(['src/pages/index.astro', 'src/pages/[lang]/index.astro'], '/en')).toBe('src/pages/[lang]/index.astro')
	})

	test('index pages, and a catch-all that matches no segment', async () => {
		expect(await routeOf(['src/pages/index.astro'], '/')).toBe('src/pages/index.astro')
		expect(await routeOf(['src/pages/blog/index.md', 'src/pages/blog/[...slug].astro'], '/blog/')).toBe('src/pages/blog/index.md')
		expect(await routeOf(['src/pages/blog/[...slug].astro'], '/blog')).toBe('src/pages/blog/[...slug].astro')
		expect(await routeOf(['src/pages/[...slug]/edit.astro'], '/a/b/edit')).toBe('src/pages/[...slug]/edit.astro')
	})

	test('a parameter with static text matches only paths that have it', async () => {
		expect(await routeOf(['src/pages/[lang]-[slug].astro'], '/en-about')).toBe('src/pages/[lang]-[slug].astro')
		expect(await routeOf(['src/pages/[lang]-[slug].astro'], '/about')).toBeUndefined()
	})

	test('leaves out files Astro ignores and endpoints, and takes a full or encoded URL', async () => {
		expect(await routeOf(['src/pages/_hidden.astro', 'src/pages/_drafts/post.astro'], '/_hidden')).toBeUndefined()
		expect(await routeOf(['src/pages/_drafts/post.astro'], '/_drafts/post')).toBeUndefined()
		expect(await routeOf(['src/pages/[slug].json.ts'], '/x')).toBeUndefined()
		expect(await routeOf(['src/pages/blog/[slug].astro'], 'http://preview.test/blog/x?draft=1#top')).toBe('src/pages/blog/[slug].astro')
		expect(await routeOf(['src/pages/café.astro', 'src/pages/[slug].astro'], '/caf%C3%A9')).toBe('src/pages/café.astro')
	})
})

describe('projectTemplatesAmong', () => {
	test('keeps the own templates of the project as absolute paths, once, and leaves out other packages and other files', () => {
		const files = [
			'/project/src/layouts/A.astro',
			'src/pages/b.astro',
			'/src/components/C.astro',
			'/other/src/D.astro',
			'/project/node_modules/pkg/E.astro',
			'src/content/post.md',
			'/project/src/layouts/A.astro',
		]
		expect(inProject([], () => projectTemplatesAmong(files))).toEqual([
			'/project/src/layouts/A.astro',
			'/project/src/pages/b.astro',
			'/project/src/components/C.astro',
		])
	})
})
