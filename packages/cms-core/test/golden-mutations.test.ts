// The structural handlers are imported via relative source paths — the same way
// `@nuasite/cms`'s own tests reach them — so this golden parity test exercises
// the existing handlers verbatim without changing the `@nuasite/cms` public API.
import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ComponentRegistry } from '../../cms/src/component-registry'
import { resetProjectRoot, setProjectRoot } from '../../cms/src/config'
import {
	handleCreateMarkdown as legacyCreateMarkdown,
	handleDeleteMarkdown as legacyDeleteMarkdown,
	handleGetMarkdownContent as legacyGetMarkdownContent,
	handleRenameMarkdown as legacyRenameMarkdown,
	handleUpdateMarkdown as legacyUpdateMarkdown,
} from '../../cms/src/handlers/markdown-ops'
import {
	handleCreatePage as legacyCreatePage,
	handleDeletePage as legacyDeletePage,
	handleDuplicatePage as legacyDuplicatePage,
	handleGetLayouts as legacyGetLayouts,
} from '../../cms/src/handlers/page-ops'
import {
	handleAddRedirect as legacyAddRedirect,
	handleDeleteRedirect as legacyDeleteRedirect,
	handleGetRedirects as legacyGetRedirects,
	handleUpdateRedirect as legacyUpdateRedirect,
} from '../../cms/src/handlers/redirect-ops'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'sample-project')

/** Mirror of the legacy ComponentRegistry default. */
const COMPONENT_DIRS = ['src/components']

async function copyFixture(suffix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cms-core-golden-${suffix}-`))
	await fs.cp(FIXTURE_ROOT, dir, { recursive: true })
	return dir
}

/** Read every file under `root` into a `{ relPath -> bytes }` map (forward-slash keys). */
async function snapshot(root: string): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	async function walk(abs: string): Promise<void> {
		const entries = await fs.readdir(abs, { withFileTypes: true })
		for (const entry of entries) {
			const full = path.join(abs, entry.name)
			if (entry.isDirectory()) {
				await walk(full)
			} else if (entry.isFile()) {
				const rel = path.relative(root, full).split(path.sep).join('/')
				out.set(rel, await fs.readFile(full, 'utf-8'))
			}
		}
	}
	await walk(root)
	return out
}

/**
 * Run `legacyFn` against a fixture copy via the project-root override, and
 * `coreFn` against an independent fixture copy via the node:fs adapter. Returns
 * both file snapshots plus the two operation results, so a test can assert byte
 * parity and side-effect parity.
 */
async function runBoth<L, C>(
	legacyFn: () => Promise<L>,
	coreFn: (core: ReturnType<typeof createCmsCore>) => Promise<C>,
): Promise<{ legacy: L; core: C; legacySnap: Map<string, string>; coreSnap: Map<string, string>; legacyRoot: string; coreRoot: string }> {
	const legacyRoot = await copyFixture('legacy')
	const coreRoot = await copyFixture('core')

	setProjectRoot(legacyRoot)
	let legacy: L
	try {
		legacy = await legacyFn()
	} finally {
		resetProjectRoot()
	}

	const core = createCmsCore(createNodeFs(coreRoot), { componentDirs: COMPONENT_DIRS })
	const coreResult = await coreFn(core)

	return {
		legacy,
		core: coreResult,
		legacySnap: await snapshot(legacyRoot),
		coreSnap: await snapshot(coreRoot),
		legacyRoot,
		coreRoot,
	}
}

/** Assert the two trees are byte-identical (same set of files, identical bytes). */
function expectIdenticalTrees(a: Map<string, string>, b: Map<string, string>): void {
	expect([...a.keys()].sort()).toEqual([...b.keys()].sort())
	for (const [rel, bytes] of a) {
		expect(b.get(rel)).toBe(bytes)
	}
}

describe('cms-core mutations — byte parity with @nuasite/cms handlers', () => {
	const cleanups: string[] = []
	afterEach(async () => {
		for (const dir of cleanups.splice(0)) {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	async function both<L, C>(
		legacyFn: () => Promise<L>,
		coreFn: (core: ReturnType<typeof createCmsCore>) => Promise<C>,
	) {
		const res = await runBoth(legacyFn, coreFn)
		cleanups.push(res.legacyRoot, res.coreRoot)
		return res
	}

	// ---- createEntry ----
	test('createEntry (markdown) is byte-identical', async () => {
		const fixedFrontmatter = { title: 'New Post', date: '2024-06-01', draft: false, tags: ['alpha', 'beta'] }
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyCreateMarkdown({
					collection: 'blog',
					title: 'New Post',
					slug: 'new-post',
					frontmatter: { date: '2024-06-01', draft: false, tags: ['alpha', 'beta'] },
					content: '# New Post\n\nBody here.',
				}),
			(core) =>
				core.createEntry({
					collection: 'blog',
					slug: 'new-post',
					frontmatter: fixedFrontmatter,
					body: '# New Post\n\nBody here.',
				}),
		)
		const created = coreSnap.get('src/content/blog/new-post.md')
		expect(created).toContain('title: New Post')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('createEntry (data/json) is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyCreateMarkdown({
					collection: 'team',
					title: 'Carol',
					slug: 'carol',
					frontmatter: { name: 'Carol', role: 'Designer' },
					fileExtension: 'json',
				}),
			(core) =>
				core.createEntry({
					collection: 'team',
					slug: 'carol',
					frontmatter: { name: 'Carol', role: 'Designer' },
					fileExtension: 'json',
				}),
		)
		expect(coreSnap.get('src/content/team/carol.json')).toBeDefined()
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- updateEntry ----
	test('updateEntry (frontmatter + body) is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyUpdateMarkdown(
					{
						filePath: 'src/content/blog/hello-world.md',
						frontmatter: { title: 'Hello (edited)', tags: ['intro', 'news', 'update'] },
						content: '# Hello World\n\nEdited body.',
					},
					{},
				),
			(core) =>
				core.updateEntry({
					collection: 'blog',
					slug: 'hello-world',
					frontmatter: { title: 'Hello (edited)', tags: ['intro', 'news', 'update'] },
					body: '# Hello World\n\nEdited body.',
				}),
		)
		expect(coreSnap.get('src/content/blog/hello-world.md')).toContain('Hello (edited)')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('updateEntry (data/yaml merge) is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyUpdateMarkdown(
					{ filePath: 'src/content/settings/site.yaml', frontmatter: { tagline: 'We ship things' } },
					{},
				),
			(core) => core.updateEntry({ collection: 'settings', slug: 'site', frontmatter: { tagline: 'We ship things' } }),
		)
		expect(coreSnap.get('src/content/settings/site.yaml')).toContain('We ship things')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- updateEntry on MDX with a component (proves internal componentDefinitions resolution) ----
	test('updateEntry (.mdx with component) injects the same import as the manifest-fed legacy path', async () => {
		// Both copies get an identical MDX entry that references <Hero>. The legacy
		// path is fed the componentDefinitions from a scan of src/components; the
		// core path resolves them internally. The injected import must match byte-for-byte.
		const legacyRoot = await copyFixture('legacy-mdx')
		const coreRoot = await copyFixture('core-mdx')
		cleanups.push(legacyRoot, coreRoot)

		const mdxRel = 'src/content/blog/with-hero.mdx'
		const mdxBody = '# Post\n\n<Hero title="Hi" />'
		const initial = '---\ntitle: With Hero\n---\n# placeholder\n'
		await fs.writeFile(path.join(legacyRoot, mdxRel), initial)
		await fs.writeFile(path.join(coreRoot, mdxRel), initial)

		// Legacy: scan components (as the dev server does), feed the manifest's defs.
		setProjectRoot(legacyRoot)
		try {
			const registry = new ComponentRegistry(COMPONENT_DIRS)
			await registry.scan()
			const legacyDefs = registry.getComponents()
			await legacyUpdateMarkdown({ filePath: mdxRel, content: mdxBody }, legacyDefs)
		} finally {
			resetProjectRoot()
		}

		// Core: resolve componentDefinitions internally.
		const core = createCmsCore(createNodeFs(coreRoot), { componentDirs: COMPONENT_DIRS })
		await core.updateEntry({ collection: 'blog', slug: 'with-hero', body: mdxBody })

		const legacyOut = await fs.readFile(path.join(legacyRoot, mdxRel), 'utf-8')
		const coreOut = await fs.readFile(path.join(coreRoot, mdxRel), 'utf-8')

		expect(legacyOut).toContain("import Hero from '../../components/Hero.astro'")
		expect(coreOut).toBe(legacyOut)
	})

	// ---- deleteEntry ----
	test('deleteEntry removes the same file (byte parity)', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyDeleteMarkdown({ filePath: 'src/content/blog/draft-post.md' }),
			(core) => core.deleteEntry('blog', 'draft-post'),
		)
		expect(coreSnap.has('src/content/blog/draft-post.md')).toBe(false)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- renameEntry ----
	test('renameEntry removes old + creates new (byte parity)', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyRenameMarkdown({ filePath: 'src/content/blog/hello-world.md', newSlug: 'hello-renamed' }),
			(core) => core.renameEntry('blog', 'hello-world', 'hello-renamed'),
		)
		expect(coreSnap.has('src/content/blog/hello-world.md')).toBe(false)
		expect(coreSnap.has('src/content/blog/hello-renamed.md')).toBe(true)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- addArrayItem / removeArrayItem (entry frontmatter) ----
	// The legacy headless path edits frontmatter arrays via a whole-frontmatter
	// updateEntry; cms-core's addArrayItem/removeArrayItem splice the array and
	// write back through the same frontmatter representation. Parity is asserted
	// against the equivalent whole-frontmatter legacy update.
	test('addArrayItem (markdown frontmatter) matches a whole-frontmatter legacy update', async () => {
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyUpdateMarkdown(
					{ filePath: 'src/content/blog/hello-world.md', frontmatter: { tags: ['intro', 'news', 'release'] } },
					{},
				),
			(core) => core.addArrayItem({ collection: 'blog', slug: 'hello-world', field: 'tags', value: 'release' }),
		)
		expect(coreSnap.get('src/content/blog/hello-world.md')).toContain('release')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('addArrayItem at an explicit index matches the equivalent whole-frontmatter legacy update', async () => {
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyUpdateMarkdown(
					{ filePath: 'src/content/blog/hello-world.md', frontmatter: { tags: ['intro', 'middle', 'news'] } },
					{},
				),
			(core) => core.addArrayItem({ collection: 'blog', slug: 'hello-world', field: 'tags', value: 'middle', index: 1 }),
		)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('removeArrayItem (markdown frontmatter) matches a whole-frontmatter legacy update', async () => {
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyUpdateMarkdown(
					{ filePath: 'src/content/blog/hello-world.md', frontmatter: { tags: ['news'] } },
					{},
				),
			(core) => core.removeArrayItem({ collection: 'blog', slug: 'hello-world', field: 'tags', index: 0 }),
		)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('addArrayItem (data/json frontmatter) matches a whole-frontmatter legacy update', async () => {
		const newLinks = [
			{ label: 'GitHub', url: 'https://github.com/alice' },
			{ label: 'Twitter', url: 'https://twitter.com/alice' },
			{ label: 'Blog', url: 'https://alice.example' },
		]
		const { legacySnap, coreSnap } = await both(
			() => legacyUpdateMarkdown({ filePath: 'src/content/team/alice.json', frontmatter: { links: newLinks } }, {}),
			(core) =>
				core.addArrayItem({
					collection: 'team',
					slug: 'alice',
					field: 'links',
					value: { label: 'Blog', url: 'https://alice.example' },
				}),
		)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- createPage ----
	test('createPage is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyCreatePage({ title: 'Contact', slug: 'contact' }),
			(core) => core.createPage({ title: 'Contact', slug: 'contact' }),
		)
		expect(coreSnap.get('src/pages/contact.astro')).toContain('Contact')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('createPage with explicit layout is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyCreatePage({ title: 'Services', slug: 'services', layoutPath: 'src/layouts/Base.astro' }),
			(core) => core.createPage({ title: 'Services', slug: 'services', layoutPath: 'src/layouts/Base.astro' }),
		)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- duplicatePage ----
	test('duplicatePage is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyDuplicatePage({ sourcePagePath: '/about', slug: 'about-copy', title: 'About Copy' }),
			(core) => core.duplicatePage({ sourcePagePath: '/about', slug: 'about-copy', title: 'About Copy' }),
		)
		expect(coreSnap.get('src/pages/about-copy.astro')).toContain('About Copy')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- deletePage ----
	test('deletePage removes the same file (byte parity)', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyDeletePage({ pagePath: '/about' }),
			(core) => core.deletePage({ pagePath: '/about' }),
		)
		expect(coreSnap.has('src/pages/about.astro')).toBe(false)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- redirects ----
	test('addRedirect is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyAddRedirect({ source: '/promo', destination: '/about', statusCode: 302 }),
			(core) => core.addRedirect({ source: '/promo', destination: '/about', statusCode: 302 }),
		)
		expect(coreSnap.get('src/_redirects')).toContain('/promo /about 302')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('addRedirect with default status is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyAddRedirect({ source: '/x', destination: '/about' }),
			(core) => core.addRedirect({ source: '/x', destination: '/about' }),
		)
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('updateRedirect is byte-identical', async () => {
		// The first rule in the fixture _redirects is `/old-home /` (after the comment line).
		const { legacySnap, coreSnap } = await both(
			() =>
				legacyGetRedirects().then((r) =>
					legacyUpdateRedirect({ lineIndex: r.rules[0]!.lineIndex, source: '/old-home', destination: '/home', statusCode: 301 })
				),
			(core) =>
				core.listRedirects().then((r) =>
					core.updateRedirect({ lineIndex: r.rules[0]!.lineIndex, source: '/old-home', destination: '/home', statusCode: 301 })
				),
		)
		expect(coreSnap.get('src/_redirects')).toContain('/old-home /home 301')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	test('deleteRedirect is byte-identical', async () => {
		const { legacySnap, coreSnap } = await both(
			() => legacyGetRedirects().then((r) => legacyDeleteRedirect({ lineIndex: r.rules[0]!.lineIndex })),
			(core) => core.listRedirects().then((r) => core.deleteRedirect({ lineIndex: r.rules[0]!.lineIndex })),
		)
		expect(coreSnap.get('src/_redirects')).not.toContain('/old-home')
		expectIdenticalTrees(legacySnap, coreSnap)
	})

	// ---- getLayouts / listRedirects / getEntry read parity ----
	test('getLayouts matches the legacy scan', async () => {
		setProjectRoot(FIXTURE_ROOT)
		let legacy
		try {
			legacy = await legacyGetLayouts()
		} finally {
			resetProjectRoot()
		}
		const core = createCmsCore(createNodeFs(FIXTURE_ROOT), { componentDirs: COMPONENT_DIRS })
		expect(await core.getLayouts()).toEqual(legacy)
	})

	test('listRedirects matches the legacy parse', async () => {
		setProjectRoot(FIXTURE_ROOT)
		let legacy
		try {
			legacy = await legacyGetRedirects()
		} finally {
			resetProjectRoot()
		}
		const core = createCmsCore(createNodeFs(FIXTURE_ROOT), { componentDirs: COMPONENT_DIRS })
		expect(await core.listRedirects()).toEqual(legacy)
	})

	test('getEntry matches the legacy markdown read', async () => {
		setProjectRoot(FIXTURE_ROOT)
		let legacy
		try {
			legacy = await legacyGetMarkdownContent('src/content/blog/hello-world.md')
		} finally {
			resetProjectRoot()
		}
		const core = createCmsCore(createNodeFs(FIXTURE_ROOT), { componentDirs: COMPONENT_DIRS })
		const entry = await core.getEntry('blog', 'hello-world')
		expect(entry?.content).toBe(legacy!.content)
		expect(entry?.frontmatter).toEqual(legacy!.frontmatter)
		expect(entry?.sourcePath).toBe(legacy!.filePath)
	})
})
