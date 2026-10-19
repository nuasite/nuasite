import { parse } from '@astrojs/compiler'
import { type CmsCommit, commitChangeset } from '@nuasite/cms-core'
import { createEditorHost, type EditorHost, type EditorHostOptions } from '@nuasite/cms/editor-host'
import { describe, expect, test } from 'bun:test'
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
