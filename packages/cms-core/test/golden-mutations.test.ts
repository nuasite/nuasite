// Self-contained golden-file mutation tests for cms-core.
//
// F0.2 proved byte parity by running these operations against the legacy
// `@nuasite/cms` handlers and comparing the resulting file trees. Those handlers
// have since been deleted (F0.3 — `@nuasite/cms` now delegates its dev API to
// cms-core), so the proven byte output is committed here as golden literals.
// Each test runs cms-core against a fresh fixture copy and asserts the exact bytes
// written — keeping mutation coverage without importing deleted code.
import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'sample-project')

/** Mirror of the legacy ComponentRegistry default. */
const COMPONENT_DIRS = ['src/components']

const cleanups: string[] = []
afterEach(async () => {
	for (const dir of cleanups.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

async function freshCore(): Promise<{ core: ReturnType<typeof createCmsCore>; root: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-core-golden-'))
	await fs.cp(FIXTURE_ROOT, root, { recursive: true })
	cleanups.push(root)
	return { core: createCmsCore(createNodeFs(root), { componentDirs: COMPONENT_DIRS }), root }
}

async function readFile(root: string, rel: string): Promise<string> {
	return fs.readFile(path.join(root, rel), 'utf-8')
}

async function fileExists(root: string, rel: string): Promise<boolean> {
	try {
		await fs.access(path.join(root, rel))
		return true
	} catch {
		return false
	}
}

describe('cms-core mutations — committed golden output (proven byte-parity with the former @nuasite/cms handlers)', () => {
	// ---- createEntry ----
	test('createEntry (markdown) writes the golden frontmatter + body', async () => {
		const { core, root } = await freshCore()
		const res = await core.createEntry({
			collection: 'blog',
			slug: 'new-post',
			frontmatter: { title: 'New Post', date: '2024-06-01', draft: false, tags: ['alpha', 'beta'] },
			body: '# New Post\n\nBody here.',
		})
		expect(res).toEqual({ success: true, sourcePath: 'src/content/blog/new-post.md' })
		expect(await readFile(root, 'src/content/blog/new-post.md')).toBe(
			"---\ntitle: New Post\ndate: '2024-06-01'\ndraft: false\ntags:\n  - alpha\n  - beta\n---\n# New Post\n\nBody here.",
		)
	})

	test('createEntry (data/json) writes the golden JSON', async () => {
		const { core, root } = await freshCore()
		const res = await core.createEntry({
			collection: 'team',
			slug: 'carol',
			frontmatter: { name: 'Carol', role: 'Designer' },
			fileExtension: 'json',
		})
		expect(res).toEqual({ success: true, sourcePath: 'src/content/team/carol.json' })
		expect(await readFile(root, 'src/content/team/carol.json')).toBe('{\n  "name": "Carol",\n  "role": "Designer"\n}\n')
	})

	// ---- updateEntry ----
	test('updateEntry (frontmatter + body) merges and writes the golden output', async () => {
		const { core, root } = await freshCore()
		const res = await core.updateEntry({
			collection: 'blog',
			slug: 'hello-world',
			frontmatter: { title: 'Hello (edited)', tags: ['intro', 'news', 'update'] },
			body: '# Hello World\n\nEdited body.',
		})
		expect(res).toEqual({ success: true, sourcePath: 'src/content/blog/hello-world.md' })
		expect(await readFile(root, 'src/content/blog/hello-world.md')).toBe(
			"---\ntitle: Hello (edited)\ndate: '2024-01-15'\ndraft: false\ncover: ./hello.jpg\ntags:\n  - intro\n  - news\n  - update\nauthor: jane-doe\n---\n# Hello World\n\nEdited body.",
		)
	})

	test('updateEntry (data/yaml) merges and writes the golden output', async () => {
		const { core, root } = await freshCore()
		const res = await core.updateEntry({ collection: 'settings', slug: 'site', frontmatter: { tagline: 'We ship things' } })
		expect(res).toEqual({ success: true, sourcePath: 'src/content/settings/site.yaml' })
		expect(await readFile(root, 'src/content/settings/site.yaml')).toBe(
			'name: Acme Site\ntagline: We ship things\ncontactEmail: hello@acme.test\nsocial:\n  twitter: acme\n  github: acme-org\n',
		)
	})

	// ---- updateEntry on MDX with a component (proves internal componentDefinitions resolution) ----
	test('updateEntry (.mdx with component) injects the component import resolved internally', async () => {
		const { core, root } = await freshCore()
		const mdxRel = 'src/content/blog/with-hero.mdx'
		await fs.writeFile(path.join(root, mdxRel), '---\ntitle: With Hero\n---\n# placeholder\n')

		const res = await core.updateEntry({ collection: 'blog', slug: 'with-hero', body: '# Post\n\n<Hero title="Hi" />' })
		expect(res.success).toBe(true)

		const out = await readFile(root, mdxRel)
		// cms-core resolves <Hero> from src/components internally (no manifest needed).
		expect(out).toContain("import Hero from '../../components/Hero.astro'")
		expect(out).toContain('<Hero title="Hi" />')
	})

	// ---- deleteEntry ----
	test('deleteEntry removes the resolved file', async () => {
		const { core, root } = await freshCore()
		expect(await fileExists(root, 'src/content/blog/draft-post.md')).toBe(true)
		const res = await core.deleteEntry('blog', 'draft-post')
		expect(res).toEqual({ success: true, sourcePath: 'src/content/blog/draft-post.md' })
		expect(await fileExists(root, 'src/content/blog/draft-post.md')).toBe(false)
	})

	// ---- renameEntry ----
	test('renameEntry removes the old file and creates the new one with identical bytes', async () => {
		const { core, root } = await freshCore()
		const before = await readFile(root, 'src/content/blog/hello-world.md')
		const res = await core.renameEntry('blog', 'hello-world', 'hello-renamed')
		expect(res).toEqual({ success: true, sourcePath: 'src/content/blog/hello-renamed.md' })
		expect(await fileExists(root, 'src/content/blog/hello-world.md')).toBe(false)
		expect(await readFile(root, 'src/content/blog/hello-renamed.md')).toBe(before)
	})

	// ---- addArrayItem / removeArrayItem (entry frontmatter) ----
	test('addArrayItem (markdown frontmatter) appends and writes the golden output', async () => {
		const { core, root } = await freshCore()
		const res = await core.addArrayItem({ collection: 'blog', slug: 'hello-world', field: 'tags', value: 'release' })
		expect(res).toEqual({ success: true, sourcePath: 'src/content/blog/hello-world.md' })
		expect(await readFile(root, 'src/content/blog/hello-world.md')).toBe(
			"---\ntitle: Hello World\ndate: '2024-01-15'\ndraft: false\ncover: ./hello.jpg\ntags:\n  - intro\n  - news\n  - release\nauthor: jane-doe\n---\n# Hello World\n\nThis is the first post.\n",
		)
	})

	test('addArrayItem at an explicit index inserts and writes the golden output', async () => {
		const { core, root } = await freshCore()
		await core.addArrayItem({ collection: 'blog', slug: 'hello-world', field: 'tags', value: 'middle', index: 1 })
		expect(await readFile(root, 'src/content/blog/hello-world.md')).toBe(
			"---\ntitle: Hello World\ndate: '2024-01-15'\ndraft: false\ncover: ./hello.jpg\ntags:\n  - intro\n  - middle\n  - news\nauthor: jane-doe\n---\n# Hello World\n\nThis is the first post.\n",
		)
	})

	test('removeArrayItem (markdown frontmatter) removes and writes the golden output', async () => {
		const { core, root } = await freshCore()
		await core.removeArrayItem({ collection: 'blog', slug: 'hello-world', field: 'tags', index: 0 })
		expect(await readFile(root, 'src/content/blog/hello-world.md')).toBe(
			"---\ntitle: Hello World\ndate: '2024-01-15'\ndraft: false\ncover: ./hello.jpg\ntags:\n  - news\nauthor: jane-doe\n---\n# Hello World\n\nThis is the first post.\n",
		)
	})

	test('addArrayItem (data/json frontmatter) appends and writes the golden output', async () => {
		const { core, root } = await freshCore()
		await core.addArrayItem({
			collection: 'team',
			slug: 'alice',
			field: 'links',
			value: { label: 'Blog', url: 'https://alice.example' },
		})
		expect(await readFile(root, 'src/content/team/alice.json')).toBe(
			'{\n  "name": "Alice",\n  "role": "Engineer",\n  "links": [\n    {\n      "label": "GitHub",\n      "url": "https://github.com/alice"\n    },\n    {\n      "label": "Twitter",\n      "url": "https://twitter.com/alice"\n    },\n    {\n      "label": "Blog",\n      "url": "https://alice.example"\n    }\n  ]\n}\n',
		)
	})

	// ---- createPage ----
	test('createPage writes the golden Astro page (default layout)', async () => {
		const { core, root } = await freshCore()
		const res = await core.createPage({ title: 'Contact', slug: 'contact' })
		expect(res).toEqual({ success: true, filePath: 'src/pages/contact.astro', slug: 'contact', url: '/contact' })
		expect(await readFile(root, 'src/pages/contact.astro')).toBe(
			'---\nimport Base from \'../layouts/Base.astro\'\n---\n\n<Base title="Contact" description="">\n\t<main>\n\t\t<h1>Contact</h1>\n\t</main>\n</Base>\n',
		)
	})

	test('createPage with explicit layout writes the golden Astro page', async () => {
		const { core, root } = await freshCore()
		const res = await core.createPage({ title: 'Services', slug: 'services', layoutPath: 'src/layouts/Base.astro' })
		expect(res).toEqual({ success: true, filePath: 'src/pages/services.astro', slug: 'services', url: '/services' })
		expect(await readFile(root, 'src/pages/services.astro')).toBe(
			'---\nimport Base from \'../layouts/Base.astro\'\n---\n\n<Base title="Services" description="">\n\t<main>\n\t\t<h1>Services</h1>\n\t</main>\n</Base>\n',
		)
	})

	// ---- duplicatePage ----
	test('duplicatePage copies the source page and rewrites the title (golden output)', async () => {
		const { core, root } = await freshCore()
		const res = await core.duplicatePage({ sourcePagePath: '/about', slug: 'about-copy', title: 'About Copy' })
		expect(res).toEqual({ success: true, filePath: 'src/pages/about-copy.astro', slug: 'about-copy', url: '/about-copy' })
		expect(await readFile(root, 'src/pages/about-copy.astro')).toBe(
			'---\nimport Base from \'../layouts/Base.astro\'\n---\n\n<Base title="About Copy" description="Learn more about us">\n\t<main>\n\t\t<h1>About Copy</h1>\n\t\t<p>We build things.</p>\n\t</main>\n</Base>\n',
		)
	})

	// ---- deletePage ----
	test('deletePage removes the resolved page file', async () => {
		const { core, root } = await freshCore()
		expect(await fileExists(root, 'src/pages/about.astro')).toBe(true)
		const res = await core.deletePage({ pagePath: '/about' })
		expect(res).toEqual({ success: true, filePath: 'src/pages/about.astro', url: '/about' })
		expect(await fileExists(root, 'src/pages/about.astro')).toBe(false)
	})

	// ---- redirects ----
	test('addRedirect appends the golden redirect line (explicit status)', async () => {
		const { core, root } = await freshCore()
		const res = await core.addRedirect({ source: '/promo', destination: '/about', statusCode: 302 })
		expect(res).toEqual({ success: true })
		expect(await readFile(root, 'src/_redirects')).toBe('# Existing redirects\n/old-home /\n/legacy /about 301\n\n/promo /about 302\n')
	})

	test('addRedirect appends the golden redirect line (default status omits the code)', async () => {
		const { core, root } = await freshCore()
		await core.addRedirect({ source: '/x', destination: '/about' })
		expect(await readFile(root, 'src/_redirects')).toBe('# Existing redirects\n/old-home /\n/legacy /about 301\n\n/x /about\n')
	})

	test('updateRedirect rewrites the rule at the given line index (golden output)', async () => {
		const { core, root } = await freshCore()
		const { rules } = await core.listRedirects()
		await core.updateRedirect({ lineIndex: rules[0]!.lineIndex, source: '/old-home', destination: '/home', statusCode: 301 })
		expect(await readFile(root, 'src/_redirects')).toBe('# Existing redirects\n/old-home /home 301\n/legacy /about 301\n')
	})

	test('deleteRedirect removes the rule at the given line index (golden output)', async () => {
		const { core, root } = await freshCore()
		const { rules } = await core.listRedirects()
		await core.deleteRedirect({ lineIndex: rules[0]!.lineIndex })
		expect(await readFile(root, 'src/_redirects')).toBe('# Existing redirects\n/legacy /about 301\n')
	})

	// ---- getLayouts / listRedirects / getEntry read parity ----
	test('getLayouts returns the golden layout list', async () => {
		const core = createCmsCore(createNodeFs(FIXTURE_ROOT), { componentDirs: COMPONENT_DIRS })
		expect(await core.getLayouts()).toEqual([{ name: 'Base', path: 'src/layouts/Base.astro' }])
	})

	test('listRedirects returns the golden parsed rules', async () => {
		const core = createCmsCore(createNodeFs(FIXTURE_ROOT), { componentDirs: COMPONENT_DIRS })
		expect(await core.listRedirects()).toEqual({
			rules: [
				{ source: '/old-home', destination: '/', statusCode: 307, lineIndex: 1 },
				{ source: '/legacy', destination: '/about', statusCode: 301, lineIndex: 2 },
			],
		})
	})

	test('getEntry returns the golden parsed frontmatter + body', async () => {
		const core = createCmsCore(createNodeFs(FIXTURE_ROOT), { componentDirs: COMPONENT_DIRS })
		const entry = await core.getEntry('blog', 'hello-world')
		expect(entry?.content).toBe('# Hello World\n\nThis is the first post.\n')
		expect(entry?.frontmatter).toEqual({
			title: 'Hello World',
			date: '2024-01-15',
			draft: false,
			cover: './hello.jpg',
			tags: ['intro', 'news'],
			author: 'jane-doe',
		})
		expect(entry?.sourcePath).toBe('src/content/blog/hello-world.md')
	})
})
