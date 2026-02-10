import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateComponentPreviews } from '../../src/preview-generator'
import type { ComponentDefinition, ComponentInstance, ManifestEntry } from '../../src/types'

let tempDir: string

beforeEach(async () => {
	tempDir = path.join(import.meta.dir, '..', '.tmp-preview-' + Date.now())
	await fs.mkdir(tempDir, { recursive: true })
})

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

function createPageHtml(sections: string[]): string {
	return `<!DOCTYPE html>
<html>
<head>
<link rel="stylesheet" href="/styles.css">
<style>body { margin: 0; }</style>
</head>
<body>
<main>
${sections.map((s, i) => `<section data-cms-component-id="comp-${i}">${s}</section>`).join('\n')}
</main>
</body>
</html>`
}

describe('generateComponentPreviews', () => {
	test('generates preview HTML file for a component', async () => {
		const html = createPageHtml([
			'<h1>Hero Title</h1><p>Hero description</p>',
		])
		await fs.mkdir(path.join(tempDir, 'index.html').replace('/index.html', ''), { recursive: true })
		await fs.writeFile(path.join(tempDir, 'index.html'), html)

		const pageManifests = new Map<string, any>()
		pageManifests.set('/', {
			entries: {} as Record<string, ManifestEntry>,
			components: {
				'comp-0': {
					id: 'comp-0',
					componentName: 'HeroSection',
					file: 'index.html',
					sourcePath: 'src/components/HeroSection.astro',
					sourceLine: 1,
					props: { title: 'Hero Title' },
				} satisfies ComponentInstance,
			},
		})

		const componentDefinitions: Record<string, ComponentDefinition> = {
			HeroSection: {
				name: 'HeroSection',
				file: 'src/components/HeroSection.astro',
				props: [{ name: 'title', type: 'string', required: true }],
			},
		}

		await generateComponentPreviews(tempDir, pageManifests, componentDefinitions)

		// Check preview file was created
		const previewPath = path.join(tempDir, '_cms-preview', 'HeroSection', 'index.html')
		const previewExists = await fs.access(previewPath).then(() => true).catch(() => false)
		expect(previewExists).toBe(true)

		// Check preview content
		const previewHtml = await fs.readFile(previewPath, 'utf-8')
		expect(previewHtml).toContain('noindex, nofollow')
		expect(previewHtml).toContain('cms-preview-container')
		expect(previewHtml).toContain('Hero Title')
		expect(previewHtml).toContain('cms-preview-update')
		expect(previewHtml).toContain('cms-preview-ready')

		// Check styles were copied from source page
		expect(previewHtml).toContain('/styles.css')
		expect(previewHtml).toContain('body { margin: 0; }')

		// Check previewUrl was set on the definition
		expect(componentDefinitions.HeroSection?.previewUrl).toBe('/_cms-preview/HeroSection/')
	})

	test('annotates text props with data-cms-preview-prop', async () => {
		const html = createPageHtml([
			'<h2>My Button Text</h2><p>Click to learn more</p>',
		])
		await fs.writeFile(path.join(tempDir, 'index.html'), html)

		const pageManifests = new Map<string, any>()
		pageManifests.set('/', {
			entries: {} as Record<string, ManifestEntry>,
			components: {
				'comp-0': {
					id: 'comp-0',
					componentName: 'CTASection',
					file: 'index.html',
					sourcePath: 'src/components/CTASection.astro',
					sourceLine: 1,
					props: { heading: 'My Button Text', subtitle: 'Click to learn more' },
				} satisfies ComponentInstance,
			},
		})

		const componentDefinitions: Record<string, ComponentDefinition> = {
			CTASection: {
				name: 'CTASection',
				file: 'src/components/CTASection.astro',
				props: [
					{ name: 'heading', type: 'string', required: true },
					{ name: 'subtitle', type: 'string', required: false },
				],
			},
		}

		await generateComponentPreviews(tempDir, pageManifests, componentDefinitions)

		const previewHtml = await fs.readFile(
			path.join(tempDir, '_cms-preview', 'CTASection', 'index.html'),
			'utf-8',
		)
		expect(previewHtml).toContain('data-cms-preview-prop="heading"')
		expect(previewHtml).toContain('data-cms-preview-prop="subtitle"')
	})

	test('skips non-string props for annotation', async () => {
		const html = createPageHtml([
			'<h2>Title</h2><span>true</span>',
		])
		await fs.writeFile(path.join(tempDir, 'index.html'), html)

		const pageManifests = new Map<string, any>()
		pageManifests.set('/', {
			entries: {} as Record<string, ManifestEntry>,
			components: {
				'comp-0': {
					id: 'comp-0',
					componentName: 'Toggle',
					file: 'index.html',
					sourcePath: 'src/components/Toggle.astro',
					sourceLine: 1,
					props: { label: 'Title', enabled: true },
				} satisfies ComponentInstance,
			},
		})

		const componentDefinitions: Record<string, ComponentDefinition> = {
			Toggle: {
				name: 'Toggle',
				file: 'src/components/Toggle.astro',
				props: [
					{ name: 'label', type: 'string', required: true },
					{ name: 'enabled', type: 'boolean', required: false },
				],
			},
		}

		await generateComponentPreviews(tempDir, pageManifests, componentDefinitions)

		const previewHtml = await fs.readFile(
			path.join(tempDir, '_cms-preview', 'Toggle', 'index.html'),
			'utf-8',
		)
		expect(previewHtml).toContain('data-cms-preview-prop="label"')
		expect(previewHtml).not.toContain('data-cms-preview-prop="enabled"')
	})

	test('generates previews for multiple components from different pages', async () => {
		const page1 = createPageHtml(['<h1>Hero</h1>'])
		const page2 = createPageHtml(['<h2>About Title</h2>'])

		await fs.writeFile(path.join(tempDir, 'index.html'), page1)
		await fs.mkdir(path.join(tempDir, 'about'), { recursive: true })
		await fs.writeFile(path.join(tempDir, 'about', 'index.html'), page2)

		const pageManifests = new Map<string, any>()
		pageManifests.set('/', {
			entries: {},
			components: {
				'comp-0': {
					id: 'comp-0',
					componentName: 'HeroSection',
					file: 'index.html',
					sourcePath: 'src/components/HeroSection.astro',
					sourceLine: 1,
					props: {},
				},
			},
		})
		pageManifests.set('/about', {
			entries: {},
			components: {
				'comp-0': {
					id: 'comp-0',
					componentName: 'AboutSection',
					file: 'about/index.html',
					sourcePath: 'src/components/AboutSection.astro',
					sourceLine: 1,
					props: {},
				},
			},
		})

		const componentDefinitions: Record<string, ComponentDefinition> = {
			HeroSection: { name: 'HeroSection', file: 'src/components/HeroSection.astro', props: [] },
			AboutSection: { name: 'AboutSection', file: 'src/components/AboutSection.astro', props: [] },
		}

		await generateComponentPreviews(tempDir, pageManifests, componentDefinitions)

		const heroExists = await fs.access(path.join(tempDir, '_cms-preview', 'HeroSection', 'index.html')).then(() => true).catch(() => false)
		const aboutExists = await fs.access(path.join(tempDir, '_cms-preview', 'AboutSection', 'index.html')).then(() => true).catch(() => false)

		expect(heroExists).toBe(true)
		expect(aboutExists).toBe(true)
		expect(componentDefinitions.HeroSection?.previewUrl).toBe('/_cms-preview/HeroSection/')
		expect(componentDefinitions.AboutSection?.previewUrl).toBe('/_cms-preview/AboutSection/')
	})

	test('only generates one preview per component name (uses first occurrence)', async () => {
		const html = createPageHtml([
			'<h2>CTA 1</h2>',
			'<h2>CTA 2</h2>',
		])
		await fs.writeFile(path.join(tempDir, 'index.html'), html)

		const pageManifests = new Map<string, any>()
		pageManifests.set('/', {
			entries: {},
			components: {
				'comp-0': {
					id: 'comp-0',
					componentName: 'CTASection',
					file: 'index.html',
					sourcePath: 'src/components/CTASection.astro',
					sourceLine: 1,
					props: { heading: 'CTA 1' },
				},
				'comp-1': {
					id: 'comp-1',
					componentName: 'CTASection',
					file: 'index.html',
					sourcePath: 'src/components/CTASection.astro',
					sourceLine: 1,
					props: { heading: 'CTA 2' },
				},
			},
		})

		const componentDefinitions: Record<string, ComponentDefinition> = {
			CTASection: {
				name: 'CTASection',
				file: 'src/components/CTASection.astro',
				props: [{ name: 'heading', type: 'string', required: true }],
			},
		}

		await generateComponentPreviews(tempDir, pageManifests, componentDefinitions)

		// Only one preview directory should exist
		const previewDir = path.join(tempDir, '_cms-preview', 'CTASection')
		const exists = await fs.access(previewDir).then(() => true).catch(() => false)
		expect(exists).toBe(true)

		// The preview should use the first instance
		const previewHtml = await fs.readFile(path.join(previewDir, 'index.html'), 'utf-8')
		expect(previewHtml).toContain('CTA 1')
	})

	test('does not generate preview when component element is not found in HTML', async () => {
		// HTML with no data-cms-component-id matching the component
		const html = '<!DOCTYPE html><html><head></head><body><p>No components</p></body></html>'
		await fs.writeFile(path.join(tempDir, 'index.html'), html)

		const pageManifests = new Map<string, any>()
		pageManifests.set('/', {
			entries: {},
			components: {
				'comp-missing': {
					id: 'comp-missing',
					componentName: 'Ghost',
					file: 'index.html',
					sourcePath: 'src/components/Ghost.astro',
					sourceLine: 1,
					props: {},
				},
			},
		})

		const componentDefinitions: Record<string, ComponentDefinition> = {
			Ghost: { name: 'Ghost', file: 'src/components/Ghost.astro', props: [] },
		}

		await generateComponentPreviews(tempDir, pageManifests, componentDefinitions)

		const exists = await fs.access(path.join(tempDir, '_cms-preview', 'Ghost')).then(() => true).catch(() => false)
		expect(exists).toBe(false)
		expect(componentDefinitions.Ghost?.previewUrl).toBeUndefined()
	})
})
