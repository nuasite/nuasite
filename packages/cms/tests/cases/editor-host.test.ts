import { parse } from '@astrojs/compiler'
import { type CmsCommit, commitChangeset } from '@nuasite/cms-core'
import {
	createEditorHost,
	type EditorDefinitions,
	type EditorDefinitionsStore,
	type EditorHost,
	type EditorHostOptions,
} from '@nuasite/cms/editor-host'
import { describe, expect, test } from 'bun:test'
import { getErrorCollector, resetErrorCollector } from '../../src/error-collector'
import type { ComponentInstance, ManifestEntry } from '../../src/types'
import { createMemoryFileSystem, type MemoryFileSystem } from '../utils/memory-fs'

const PAGE = `---
import Card from '../components/Card.astro'
---
<html>
<head><title>Home</title></head>
<body>
<h1>Hello world</h1>
<Card />
</body>
</html>
`

const CARD = `<article>
<h2>Card title</h2>
</article>
`

/**
 * The page above as a host renders it with the Astro compiler's `annotateSourceFile`: every
 * element carries its source file and `line:column`. The files are spelled absolute under `root`.
 */
function renderedPage(root: string, heading = 'Hello world'): string {
	const page = `${root}/src/pages/index.astro`
	const card = `${root}/src/components/Card.astro`
	return `<html><head><title>Home</title></head><body>
<h1 data-astro-source-file="${page}" data-astro-source-loc="7:1">${heading}</h1>
<article data-astro-source-file="${card}" data-astro-source-loc="1:1">
<h2 data-astro-source-file="${card}" data-astro-source-loc="2:1">Card title</h2>
</article>
</body></html>`
}

function project(): MemoryFileSystem {
	return createMemoryFileSystem({ 'src/pages/index.astro': PAGE, 'src/components/Card.astro': CARD })
}

function hostOver(fs: MemoryFileSystem, options: Partial<EditorHostOptions> = {}): Promise<EditorHost> {
	return createEditorHost({ root: '/project', fs, parseAstro: parse, ...options })
}

interface PageManifest {
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
}

async function fetchJson<T>(host: EditorHost, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
	const response = await host.fetch(new Request(`http://preview.test${path}`, init))
	if (!response) throw new Error(`The host did not answer ${path}`)
	const body: T = await response.json()
	return { status: response.status, body }
}

function entryWithText(manifest: PageManifest, text: string): ManifestEntry {
	const entry = Object.values(manifest.entries).find(candidate => candidate.text === text)
	if (!entry) throw new Error(`No manifest entry with text "${text}"`)
	return entry
}

function textChange(entry: ManifestEntry, newValue: string) {
	if (entry.sourcePath === undefined || entry.sourceLine === undefined || entry.sourceSnippet === undefined) {
		throw new Error(`Entry ${entry.id} has no source location`)
	}
	return {
		cmsId: entry.id,
		newValue,
		originalValue: entry.text ?? '',
		sourcePath: entry.sourcePath,
		sourceLine: entry.sourceLine,
		sourceSnippet: entry.sourceSnippet,
	}
}

async function save(host: EditorHost, changes: ReturnType<typeof textChange>[]) {
	return fetchJson<{ updated: number; errors?: Array<{ cmsId: string; error: string }> }>(host, '/_nua/cms/update', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ changes, meta: { source: 'test', url: 'http://preview.test/' } }),
	})
}

describe('createEditorHost', () => {
	test('builds the page manifest from annotated HTML and saves a text change through the filesystem', async () => {
		const fs = project()
		const host = await hostOver(fs)

		const marked = await host.processPage('/', renderedPage('/project'))
		expect(marked).toContain('data-cms-id=')

		const { body: manifest } = await fetchJson<PageManifest>(host, '/index.json')
		const heading = entryWithText(manifest, 'Hello world')
		const cardHeading = entryWithText(manifest, 'Card title')
		// Source paths keep the spelling of the annotations, as under the Astro dev server.
		expect([heading.sourcePath, heading.sourceLine]).toEqual(['/project/src/pages/index.astro', 7])
		expect([cardHeading.sourcePath, cardHeading.sourceLine]).toEqual(['/project/src/components/Card.astro', 2])
		expect(Object.values(manifest.components).map(component => component.componentName)).toContain('Card')

		const { body } = await save(host, [textChange(heading, 'Welcome')])
		expect(body).toEqual({ updated: 1 })
		expect(await fs.readFile('src/pages/index.astro')).toContain('<h1>Welcome</h1>')
	})

	test('accepts annotations spelled relative to the root', async () => {
		const fs = project()
		const host = await hostOver(fs)
		await host.processPage('/', renderedPage(''))
		const { body: manifest } = await fetchJson<PageManifest>(host, '/index.json')

		const { body } = await save(host, [textChange(entryWithText(manifest, 'Card title'), 'Renamed')])
		expect(body).toEqual({ updated: 1 })
		expect(await fs.readFile('src/components/Card.astro')).toContain('<h2>Renamed</h2>')
	})

	test('text passed as a prop is attributed to the invocation on this page, not to another component with the same text', async () => {
		const button = '---\nconst { label } = Astro.props\n---\n<a class="btn">{label}</a>\n'
		const invocation = (wrapper: string) => `---\nimport Button from './Button.astro'\n---\n<${wrapper}>\n<Button label="Details" />\n</${wrapper}>\n`
		const fs = createMemoryFileSystem({
			// Listed first, and first by name: a lookup that takes the first match lands here.
			'src/components/BlocksBoardDark.astro': invocation('section'),
			'src/components/Button.astro': button,
			'src/components/IndustryCard.astro': invocation('div'),
			'src/pages/index.astro': "---\nimport IndustryCard from '../components/IndustryCard.astro'\n---\n<html><body>\n<IndustryCard />\n</body></html>\n",
		})
		const host = await hostOver(fs)
		await host.processPage(
			'/',
			`<html><body>
<div data-astro-source-file="/project/src/components/IndustryCard.astro" data-astro-source-loc="4:1">
<a class="btn" data-astro-source-file="/project/src/components/Button.astro" data-astro-source-loc="4:1">Details</a>
</div>
</body></html>`,
		)
		const { body: manifest } = await fetchJson<PageManifest>(host, '/index.json')
		const details = entryWithText(manifest, 'Details')
		expect([details.sourcePath, details.sourceLine]).toEqual(['src/components/IndustryCard.astro', 5])

		const { body } = await save(host, [textChange(details, 'More')])
		expect(body).toEqual({ updated: 1 })
		expect(await fs.readFile('src/components/IndustryCard.astro')).toContain('<Button label="More" />')
		expect(await fs.readFile('src/components/BlocksBoardDark.astro')).toContain('<Button label="Details" />')
	})

	test('searches the project for text the page load left unlocated only when the editor asks for that entry', async () => {
		const fs = createMemoryFileSystem({
			'src/data/site.ts': "export const tagline = 'Built for people who ship'\n",
			'src/components/Hero.astro': "---\nimport { tagline } from '../data/site'\n---\n<section>\n<p>{tagline}</p>\n</section>\n",
			'src/pages/index.astro': "---\nimport Hero from '../components/Hero.astro'\n---\n<html><body>\n<Hero />\n</body></html>\n",
		})
		const host = await hostOver(fs)
		// No source annotations, so only a search of the sources can place the text.
		await host.processPage('/', '<html><body><section><p>Built for people who ship</p></section></body></html>')

		const { body: loaded } = await fetchJson<PageManifest>(host, '/index.json')
		const tagline = entryWithText(loaded, 'Built for people who ship')
		expect(tagline.sourcePath).toBeUndefined()

		const [first, second] = await Promise.all([
			fetchJson<PageManifest>(host, `/index.json?locate=${tagline.id}`),
			fetchJson<PageManifest>(host, `/index.json?locate=${tagline.id}`),
		])
		const located = entryWithText(first.body, 'Built for people who ship')
		expect([located.sourcePath, located.sourceLine]).toEqual(['src/data/site.ts', 1])
		expect(entryWithText(second.body, 'Built for people who ship').sourcePath).toBe('src/data/site.ts')

		const { body } = await save(host, [textChange(located, 'Built for people who care')])
		expect(body).toEqual({ updated: 1 })
		expect(await fs.readFile('src/data/site.ts')).toContain("'Built for people who care'")
	})

	test('searches for two entries at once keep both results', async () => {
		const fs = createMemoryFileSystem({
			'src/data/site.ts': "export const tagline = 'Built for people who ship'\nexport const motto = 'Small tools, sharp edges'\n",
			'src/components/Hero.astro':
				"---\nimport { tagline, motto } from '../data/site'\n---\n<section>\n<p>{tagline}</p>\n<h2>{motto}</h2>\n</section>\n",
			'src/pages/index.astro': "---\nimport Hero from '../components/Hero.astro'\n---\n<html><body>\n<Hero />\n</body></html>\n",
		})
		const host = await hostOver(fs)
		await host.processPage('/', '<html><body><section><p>Built for people who ship</p><h2>Small tools, sharp edges</h2></section></body></html>')

		const { body: loaded } = await fetchJson<PageManifest>(host, '/index.json')
		const tagline = entryWithText(loaded, 'Built for people who ship')
		const motto = entryWithText(loaded, 'Small tools, sharp edges')
		await Promise.all([
			fetchJson<PageManifest>(host, `/index.json?locate=${tagline.id}`),
			fetchJson<PageManifest>(host, `/index.json?locate=${motto.id}`),
		])

		const { body: after } = await fetchJson<PageManifest>(host, '/index.json')
		expect([entryWithText(after, 'Built for people who ship').sourcePath, entryWithText(after, 'Small tools, sharp edges').sourcePath])
			.toEqual(['src/data/site.ts', 'src/data/site.ts'])
	})

	test('a search for text two entries of a collection the page reads hold does not settle on equal text in a component', async () => {
		const fs = createMemoryFileSystem({
			'src/content/partners/acme.json': '{\n  "name": "ACME Corp"\n}\n',
			'src/content/partners/acme-eu.json': '{\n  "name": "ACME Corp"\n}\n',
			'src/components/Footer.astro': '<footer>\n<p>ACME Corp</p>\n</footer>\n',
			'src/pages/index.astro': [
				'---',
				'import { getCollection } from "astro:content"',
				'import Footer from "../components/Footer.astro"',
				'const partners = await getCollection("partners")',
				'---',
				'<html><body>',
				'{partners.map(p => <p>{p.data.name}</p>)}',
				'<Footer />',
				'</body></html>',
			].join('\n'),
		})
		const host = await hostOver(fs)
		await host.processPage('/', '<html><body><p>ACME Corp</p><p>ACME Corp</p><footer><p>ACME Corp</p></footer></body></html>')

		const { body: loaded } = await fetchJson<PageManifest>(host, '/index.json')
		const partner = entryWithText(loaded, 'ACME Corp')
		expect(partner.sourcePath).toBeUndefined()

		const { body: after } = await fetchJson<PageManifest>(host, `/index.json?locate=${partner.id}`)
		expect(after.entries[partner.id]?.sourcePath).toBeUndefined()
	})

	test('on a page of a dynamic route, text two entries hold stays unplaced after another entry was placed', async () => {
		const fs = createMemoryFileSystem({
			'src/content/partners/acme.json': '{\n  "name": "ACME Corp"\n}\n',
			'src/content/news/launch.json': '{\n  "title": "Launch day"\n}\n',
			'src/content/news/launch-eu.json': '{\n  "title": "Launch day"\n}\n',
			'src/components/Footer.astro': '<footer>\n<p>Launch day</p>\n</footer>\n',
			'src/pages/partners/[...page].astro': [
				'---',
				'import { getCollection } from "astro:content"',
				'import Footer from "../../components/Footer.astro"',
				'const partners = await getCollection("partners")',
				'const news = await getCollection("news")',
				'---',
				'<html><body>',
				'{partners.map(p => <h2>{p.data.name}</h2>)}',
				'{news.map(n => <p>{n.data.title}</p>)}',
				'<Footer />',
				'</body></html>',
			].join('\n'),
		})
		const host = await hostOver(fs)
		await host.processPage(
			'/partners/2',
			'<html><body><h2>ACME Corp</h2><p>Launch day</p><p>Launch day</p><footer><p>Launch day</p></footer></body></html>',
		)

		const { body: loaded } = await fetchJson<PageManifest>(host, '/partners/2.json')
		expect(entryWithText(loaded, 'ACME Corp').sourcePath).toBe('src/content/partners/acme.json')
		const launch = entryWithText(loaded, 'Launch day')
		expect(launch.sourcePath).toBeUndefined()

		const { body: after } = await fetchJson<PageManifest>(host, `/partners/2.json?locate=${launch.id}`)
		expect(after.entries[launch.id]?.sourcePath).toBeUndefined()
	})

	test('serves the global manifest with the components and pages of its own project', async () => {
		const host = await hostOver(project())
		const { body } = await fetchJson<{ componentDefinitions: Record<string, unknown>; pages: Array<{ pathname: string }> }>(
			host,
			'/cms-manifest.json',
		)
		expect(Object.keys(body.componentDefinitions)).toEqual(['Card'])
		expect(body.pages.map(page => page.pathname)).toEqual(['/'])
	})

	test('inserts a component next to another through the filesystem', async () => {
		const fs = project()
		const host = await hostOver(fs)
		await host.processPage('/', renderedPage('/project'))
		const { body: manifest } = await fetchJson<PageManifest>(host, '/index.json')
		const card = Object.values(manifest.components).find(component => component.componentName === 'Card')
		if (!card) throw new Error('No Card instance')

		const { body } = await fetchJson<{ success: boolean }>(host, '/_nua/cms/insert-component', {
			method: 'POST',
			body: JSON.stringify({
				position: 'after',
				referenceComponentId: card.id,
				componentName: 'Card',
				props: {},
				meta: { source: 'test', url: 'http://preview.test/' },
			}),
		})
		expect(body.success).toBe(true)
		expect((await fs.readFile('src/pages/index.astro')).match(/<Card \/>/g)).toHaveLength(2)
	})

	test('a file changed by someone else after the page loaded fails its own changes only', async () => {
		const fs = project()
		const outsideCard = '<article>\n<h2>Agent title</h2>\n</article>\n'
		const commit: CmsCommit = async changeset => {
			if (changeset.changes.some(change => change.path === 'src/components/Card.astro')) {
				await fs.writeFile('src/components/Card.astro', outsideCard)
			}
			await commitChangeset(fs)(changeset)
		}
		const host = await hostOver(fs, { commit })
		await host.processPage('/', renderedPage('/project'))
		const { body: manifest } = await fetchJson<PageManifest>(host, '/index.json')
		const cardHeading = entryWithText(manifest, 'Card title')

		const { body } = await save(host, [textChange(entryWithText(manifest, 'Hello world'), 'Welcome'), textChange(cardHeading, 'Editor title')])

		expect(body.updated).toBe(1)
		expect(body.errors).toEqual([{ cmsId: cardHeading.id, error: expect.stringContaining('src/components/Card.astro') }])
		expect(await fs.readFile('src/components/Card.astro')).toBe(outsideCard)
		expect(await fs.readFile('src/pages/index.astro')).toContain('<h1>Welcome</h1>')
	})

	test('picks up a component added outside after invalidate', async () => {
		const fs = project()
		const host = await hostOver(fs)
		await fs.writeFile('src/components/Hero.astro', '<section>Hero</section>\n')
		host.invalidate(['src/components/Hero.astro'])

		const { body } = await fetchJson<{ componentDefinitions: Record<string, unknown> }>(host, '/cms-manifest.json')
		expect(Object.keys(body.componentDefinitions).sort()).toEqual(['Card', 'Hero'])
	})

	test('after invalidating everything, parses again only the files whose content changed', async () => {
		const fs = project()
		const parsed: string[] = []
		const host = await hostOver(fs, {
			parseAstro: (source, options) => {
				parsed.push(source)
				return parse(source, options)
			},
		})
		await host.processPage('/', renderedPage('/project'))
		await fetchJson<PageManifest>(host, '/index.json')

		parsed.length = 0
		const card = CARD.replace('Card title', 'New title')
		await fs.writeFile('src/components/Card.astro', card)
		host.invalidate()
		await host.processPage('/', renderedPage('/project').replace('Card title', 'New title'))
		const { body: manifest } = await fetchJson<PageManifest>(host, '/index.json')

		expect(parsed).toEqual([card])
		const cardHeading = entryWithText(manifest, 'New title')
		expect([cardHeading.sourcePath, cardHeading.sourceLine]).toEqual(['/project/src/components/Card.astro', 2])
		expect(entryWithText(manifest, 'Hello world').sourcePath).toBe('/project/src/pages/index.astro')
	})

	test('a parse not read through four full invalidates is let go, so the file is parsed again', async () => {
		const fs = project()
		const parsed: string[] = []
		const host = await hostOver(fs, {
			parseAstro: (source, options) => {
				parsed.push(source)
				return parse(source, options)
			},
		})
		await host.processPage('/', renderedPage('/project'))

		parsed.length = 0
		for (let i = 0; i < 4; i++) host.invalidate()
		await host.processPage('/', renderedPage('/project'))
		expect(parsed).toEqual([])

		parsed.length = 0
		for (let i = 0; i < 5; i++) host.invalidate()
		await host.processPage('/', renderedPage('/project'))
		expect(parsed.toSorted()).toEqual([CARD, PAGE].toSorted())
	})

	test('a file that could not be read is parsed again when it is back', async () => {
		const fs = project()
		const parsed: string[] = []
		const host = await hostOver(fs, {
			parseAstro: (source, options) => {
				parsed.push(source)
				return parse(source, options)
			},
		})
		await host.processPage('/', renderedPage('/project'))

		await fs.remove('src/components/Card.astro')
		host.invalidate()
		await host.processPage('/', renderedPage('/project'))
		await fs.writeFile('src/components/Card.astro', CARD)
		parsed.length = 0
		host.invalidate()
		await host.processPage('/', renderedPage('/project'))

		expect(parsed).toEqual([CARD])
	})

	test('two hosts in one process keep their projects apart, also when used concurrently', async () => {
		const first = await createEditorHost({ root: '/first', fs: project(), parseAstro: parse })
		const second = await createEditorHost({
			root: '/second',
			fs: createMemoryFileSystem({ 'src/pages/index.astro': PAGE.replace('Hello world', 'Other heading'), 'src/components/Card.astro': CARD }),
			parseAstro: parse,
		})

		await Promise.all([
			first.processPage('/', renderedPage('/first')),
			second.processPage('/', renderedPage('/second', 'Other heading')),
		])
		const [firstManifest, secondManifest] = await Promise.all([
			fetchJson<PageManifest>(first, '/index.json'),
			fetchJson<PageManifest>(second, '/index.json'),
		])
		expect(entryWithText(firstManifest.body, 'Hello world').sourcePath).toBe('/first/src/pages/index.astro')
		expect(entryWithText(secondManifest.body, 'Other heading').sourcePath).toBe('/second/src/pages/index.astro')
		expect(Object.values(firstManifest.body.entries).some(entry => entry.text === 'Other heading')).toBe(false)
	})

	test('injects the editor and the reload client, and leaves other requests to the host', async () => {
		const host = await hostOver(project(), { editor: { src: '/editor.js', reloadUrl: '/_live' } })
		const marked = await host.processPage('/', renderedPage('/project'), { revision: 'r1' })

		expect(marked).toMatch(/<script>window\.NuaCmsConfig = \{"apiBase":"\/_nua\/cms","maxUploadSize":20971520\};<\/script>/)
		expect(marked).toContain('<script type="module" src="/editor.js" data-nuasite-cms></script>')
		expect(marked).toContain('"revision":"r1"')
		expect(marked.indexOf('data-nuasite-cms')).toBeLessThan(marked.indexOf('</head>'))

		expect(await host.fetch(new Request('http://preview.test/about'))).toBeUndefined()
		expect(await host.fetch(new Request('http://preview.test/missing.json'))).toBeUndefined()
		expect((await host.fetch(new Request('http://preview.test/_nua/cms/update', { method: 'OPTIONS' })))?.status).toBe(204)
	})
})

describe('createEditorHost with a definitions store', () => {
	const POST = '---\ntitle: First post\n---\nBody\n'

	function projectWithPosts(): MemoryFileSystem {
		return createMemoryFileSystem({
			'src/pages/index.astro': PAGE,
			'src/components/Card.astro': CARD,
			'src/content/posts/first.md': POST,
			'src/content/posts/second.md': POST.replace('First', 'Second'),
		})
	}

	/** Records the reads of component and content files, which only a scan makes. */
	function countScanReads(fs: MemoryFileSystem): string[] {
		const read: string[] = []
		const readFile = fs.readFile
		fs.readFile = path => {
			if (path.startsWith('src/components/') || path.startsWith('src/content/')) read.push(path)
			return readFile(path)
		}
		return read
	}

	/**
	 * A store as a host keeps one: definitions as JSON by its revision of the files, which the test
	 * moves. `failLoads` makes that many next loads reject.
	 */
	function revisionStore() {
		const saved = new Map<number, string>()
		const state = { revision: 1, loads: 0, failLoads: 0 }
		const store: EditorDefinitionsStore = {
			load: async () => {
				state.loads++
				if (state.failLoads > 0) {
					state.failLoads--
					throw new Error('store unavailable')
				}
				const revision = state.revision
				const json = saved.get(revision)
				if (json !== undefined) return { definitions: JSON.parse(json) }
				return { save: definitions => void saved.set(revision, JSON.stringify(definitions)) }
			},
		}
		const savedAt = (revision: number): EditorDefinitions | undefined => {
			const json = saved.get(revision)
			return json === undefined ? undefined : JSON.parse(json)
		}
		return { store, state, saved, savedAt }
	}

	/** Lets the queued saves run. */
	const settle = () => new Promise(resolve => setTimeout(resolve, 0))

	interface GlobalManifest {
		componentDefinitions: Record<string, unknown>
		collectionDefinitions: Record<string, { label: string; entryCount: number }>
		mdxComponents?: string[]
	}

	test('a start from saved definitions reads no component or entry, and serves what a scan serves', async () => {
		const { store, savedAt } = revisionStore()
		const scanningFs = projectWithPosts()
		const scanReads = countScanReads(scanningFs)
		const scanned = await hostOver(scanningFs, { definitions: store, mdxComponentDirs: ['src/components'] })
		const { body: scannedManifest } = await fetchJson<GlobalManifest>(scanned, '/cms-manifest.json')
		await settle()
		expect(savedAt(1)).toBeDefined()
		expect(scanReads.length).toBeGreaterThan(0)

		const fs = projectWithPosts()
		const reads = countScanReads(fs)
		const restarted = await hostOver(fs, { definitions: store, mdxComponentDirs: ['src/components'] })
		const { body: restartedManifest } = await fetchJson<GlobalManifest>(restarted, '/cms-manifest.json')

		expect(reads).toEqual([])
		expect(restartedManifest).toEqual(scannedManifest)
		expect(Object.keys(restartedManifest.componentDefinitions)).toEqual(['Card'])
		expect(restartedManifest.mdxComponents).toEqual(['Card'])
		expect(restartedManifest.collectionDefinitions.posts?.entryCount).toBe(2)
	})

	test('saves the scan before the collection overrides, and lays the overrides over saved definitions', async () => {
		const { store, savedAt } = revisionStore()
		const collections = { posts: { label: 'Articles' } }
		await hostOver(projectWithPosts(), { definitions: store, collections })
		await settle()
		expect(savedAt(1)?.collections.posts?.label).not.toBe('Articles')

		const restarted = await hostOver(projectWithPosts(), { definitions: store, collections })
		const { body } = await fetchJson<GlobalManifest>(restarted, '/cms-manifest.json')
		expect(body.collectionDefinitions.posts?.label).toBe('Articles')
	})

	test('what was saved does not change when the host goes on using its definitions', async () => {
		let saved: EditorDefinitions | undefined
		let atSave = ''
		const store: EditorDefinitionsStore = {
			load: async () => ({
				save: definitions => {
					saved = definitions
					atSave = JSON.stringify(definitions)
				},
			}),
		}
		const host = await hostOver(projectWithPosts(), { definitions: store, collections: { posts: { label: 'Articles' } } })
		await host.processPage('/', renderedPage('/project'))
		await fetchJson<GlobalManifest>(host, '/cms-manifest.json')
		await settle()
		expect(JSON.stringify(saved)).toBe(atSave)
	})

	test('after an invalidate, a miss scans and saves under the new revision, and a hit serves the saved definitions without a scan', async () => {
		const fs = projectWithPosts()
		const reads = countScanReads(fs)
		const { store, state, saved, savedAt } = revisionStore()
		const host = await hostOver(fs, { definitions: store })

		await fs.writeFile('src/components/Hero.astro', '<section>Hero</section>\n')
		state.revision = 2
		host.invalidate(['src/components/Hero.astro'])
		const { body: scanned } = await fetchJson<GlobalManifest>(host, '/cms-manifest.json')
		await settle()
		expect(Object.keys(scanned.componentDefinitions).sort()).toEqual(['Card', 'Hero'])
		expect(Object.keys(savedAt(2)?.components ?? {}).sort()).toEqual(['Card', 'Hero'])

		// Revision 3 was saved by another start; its Footer is not among the files, so only the store can serve it.
		const third = savedAt(2)!
		third.components.Footer = { name: 'Footer', file: 'src/components/Footer.astro', props: [] }
		saved.set(3, JSON.stringify(third))
		state.revision = 3
		reads.length = 0
		host.invalidate(['src/components/Footer.astro'])
		const { body: loaded } = await fetchJson<GlobalManifest>(host, '/cms-manifest.json')

		expect(reads).toEqual([])
		expect(Object.keys(loaded.componentDefinitions).sort()).toEqual(['Card', 'Footer', 'Hero'])
	})

	test('a load an invalidate superseded while it ran is neither served nor saved', async () => {
		const fs = projectWithPosts()
		const { store, state, savedAt } = revisionStore()
		const host = await hostOver(fs, { definitions: store })
		let delay = 0
		const readFile = fs.readFile
		fs.readFile = async path => {
			if (delay > 0 && path.startsWith('src/components/')) await new Promise(resolve => setTimeout(resolve, delay))
			return readFile(path)
		}

		await fs.writeFile('src/components/A.astro', CARD)
		state.revision = 2
		host.invalidate(['src/components/A.astro'])
		delay = 50
		const slow = fetchJson<GlobalManifest>(host, '/cms-manifest.json')
		await new Promise(resolve => setTimeout(resolve, 5))

		await fs.writeFile('src/components/B.astro', CARD)
		state.revision = 3
		host.invalidate(['src/components/B.astro'])
		delay = 0
		const { body: fast } = await fetchJson<GlobalManifest>(host, '/cms-manifest.json')
		const { body: slowBody } = await slow
		await new Promise(resolve => setTimeout(resolve, 100))
		const { body: after } = await fetchJson<GlobalManifest>(host, '/cms-manifest.json')

		expect(Object.keys(fast.componentDefinitions).sort()).toEqual(['A', 'B', 'Card'])
		expect(Object.keys(slowBody.componentDefinitions).sort()).toEqual(['A', 'B', 'Card'])
		expect(Object.keys(after.componentDefinitions).sort()).toEqual(['A', 'B', 'Card'])
		expect(savedAt(2)).toBeUndefined()
		expect(Object.keys(savedAt(3)?.components ?? {}).sort()).toEqual(['A', 'B', 'Card'])
	})

	test('a save that throws or rejects does not fail the start, and goes to the error collector', async () => {
		resetErrorCollector()
		let unhandled = 0
		const onUnhandled = () => unhandled++
		process.on('unhandledRejection', onUnhandled)
		const rejecting = () => Promise.reject(new Error('store down'))
		const throwing = () => {
			throw new Error('store down')
		}
		try {
			for (const save of [rejecting, throwing]) {
				const host = await hostOver(projectWithPosts(), { definitions: { load: async () => ({ save }) } })
				const { body } = await fetchJson<GlobalManifest>(host, '/cms-manifest.json')
				expect(Object.keys(body.componentDefinitions)).toEqual(['Card'])
			}
			await settle()
		} finally {
			process.off('unhandledRejection', onUnhandled)
		}
		expect(unhandled).toBe(0)
		expect(getErrorCollector().getErrors().map(({ context, error }) => [context, error.message])).toEqual([
			['Saving the editor definitions', 'store down'],
			['Saving the editor definitions', 'store down'],
		])
	})

	test('a load that failed is not kept: the next use loads again', async () => {
		const fs = projectWithPosts()
		const { store, state } = revisionStore()
		const host = await hostOver(fs, { definitions: store })

		await fs.writeFile('src/components/Hero.astro', '<section>Hero</section>\n')
		state.revision = 2
		state.failLoads = 1
		host.invalidate(['src/components/Hero.astro'])
		const failed = await host.fetch(new Request('http://preview.test/cms-manifest.json')).then(() => 'served', (error: Error) => error.message)
		const { body } = await fetchJson<GlobalManifest>(host, '/cms-manifest.json')

		expect(failed).toBe('store unavailable')
		expect(state.loads).toBe(3)
		expect(Object.keys(body.componentDefinitions).sort()).toEqual(['Card', 'Hero'])
	})
})
