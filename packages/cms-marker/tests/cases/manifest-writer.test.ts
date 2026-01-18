import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ManifestWriter } from '../../src/manifest-writer'
import type { ManifestEntry, ComponentInstance, CollectionEntry } from '../../src/types'

async function createTestContext() {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-writer-test-'))
	const manifestWriter = new ManifestWriter('cms-manifest.json')
	manifestWriter.setOutDir(tempDir)
	return {
		tempDir,
		manifestWriter,
		cleanup: async () => {
			await fs.rm(tempDir, { recursive: true, force: true })
		},
	}
}

describe('ManifestWriter', () => {

	describe('page manifests', () => {
		test('should write page manifest for index page', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				const entries: Record<string, ManifestEntry> = {
					'cms-0': {
						id: 'cms-0',
						sourcePath: '/index.html',
						tag: 'h1',
						text: 'Hello World',
					},
				}
				const components: Record<string, ComponentInstance> = {}

				manifestWriter.addPage('/', entries, components)
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.page).toBe('/')
				expect(manifest.entries['cms-0'].text).toBe('Hello World')
			} finally {
				await cleanup()
			}
		})

		test('should write page manifest for nested page', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				const entries: Record<string, ManifestEntry> = {
					'cms-0': {
						id: 'cms-0',
						sourcePath: '/about/index.html',
						tag: 'p',
						text: 'About us',
					},
				}
				const components: Record<string, ComponentInstance> = {}

				manifestWriter.addPage('/about', entries, components)
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'about.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.page).toBe('/about')
				expect(manifest.entries['cms-0'].text).toBe('About us')
			} finally {
				await cleanup()
			}
		})

		test('should include metadata in page manifest', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				const entries: Record<string, ManifestEntry> = {
					'cms-0': {
						id: 'cms-0',
						sourcePath: '/index.html',
						tag: 'h1',
						text: 'Test',
					},
				}

				manifestWriter.addPage('/', entries, {})
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.metadata).toBeDefined()
				expect(manifest.metadata.version).toBe('1.0')
				expect(manifest.metadata.generatedBy).toBe('astro-cms-marker')
				expect(manifest.metadata.generatedAt).toBeDefined()
				expect(manifest.metadata.contentHash).toBeDefined()
			} finally {
				await cleanup()
			}
		})

		test('should include collection entry in page manifest', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				const entries: Record<string, ManifestEntry> = {
					'cms-0': {
						id: 'cms-0',
						sourcePath: '/blog/post.html',
						tag: 'div',
						text: '',
						sourceType: 'collection',
						collectionName: 'blog',
						collectionSlug: 'my-post',
					},
				}
				const collection: CollectionEntry = {
					collectionName: 'blog',
					collectionSlug: 'my-post',
					sourcePath: 'src/content/blog/my-post.md',
					frontmatter: {
						title: { value: 'My Post', line: 2 },
					},
					body: '# Content',
					bodyStartLine: 5,
				}

				manifestWriter.addPage('/blog/my-post', entries, {}, collection)
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'blog/my-post.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.collection).toBeDefined()
				expect(manifest.collection.collectionName).toBe('blog')
				expect(manifest.collection.collectionSlug).toBe('my-post')
				expect(manifest.collection.frontmatter.title.value).toBe('My Post')
			} finally {
				await cleanup()
			}
		})
	})

	describe('available colors', () => {
		test('should set available colors directly', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				manifestWriter.setAvailableColors({
					colors: [
						{ name: 'primary', shades: ['500', '600', '700'], isCustom: true },
						{ name: 'blue', shades: ['50', '100', '500', '900'], isCustom: false },
					],
					defaultColors: ['blue'],
					customColors: ['primary'],
				})

				const entries: Record<string, ManifestEntry> = {
					'cms-0': { id: 'cms-0', sourcePath: '/index.html', tag: 'h1', text: 'Test' },
				}
				manifestWriter.addPage('/', entries, {})
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.availableColors).toBeDefined()
				expect(manifest.availableColors.customColors).toContain('primary')
				expect(manifest.availableColors.defaultColors).toContain('blue')
				expect(manifest.availableColors.colors).toHaveLength(2)
			} finally {
				await cleanup()
			}
		})

		test('should include available colors in page manifest', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				manifestWriter.setAvailableColors({
					colors: [
						{ name: 'white', shades: [], isCustom: false },
						{ name: 'black', shades: [], isCustom: false },
						{ name: 'red', shades: ['50', '500', '900'], isCustom: false },
					],
					defaultColors: ['white', 'black', 'red'],
					customColors: [],
				})

				const entries: Record<string, ManifestEntry> = {
					'cms-0': { id: 'cms-0', sourcePath: '/index.html', tag: 'button', text: 'Click' },
				}
				manifestWriter.addPage('/', entries, {})
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.availableColors).toBeDefined()
				const redColor = manifest.availableColors.colors.find((c: any) => c.name === 'red')
				expect(redColor).toBeDefined()
				expect(redColor.shades).toContain('500')
			} finally {
				await cleanup()
			}
		})

		test('should load available colors from CSS file', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				// Create a mock CSS file with Tailwind v4 @theme
				const cssContent = `
@tailwind base;
@tailwind components;
@tailwind utilities;

@theme {
	--color-primary-50: #eff6ff;
	--color-primary-100: #dbeafe;
	--color-primary-500: #3b82f6;
	--color-primary-900: #1e3a8a;
	--color-accent-500: #f59e0b;
}
`
				const cssDir = path.join(tempDir, 'src', 'styles')
				await fs.mkdir(cssDir, { recursive: true })
				await fs.writeFile(path.join(cssDir, 'global.css'), cssContent)

				await manifestWriter.loadAvailableColors(tempDir)

				const entries: Record<string, ManifestEntry> = {
					'cms-0': { id: 'cms-0', sourcePath: '/index.html', tag: 'h1', text: 'Test' },
				}
				manifestWriter.addPage('/', entries, {})
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				expect(manifest.availableColors).toBeDefined()
				expect(manifest.availableColors.customColors).toContain('primary')
				expect(manifest.availableColors.customColors).toContain('accent')

				const primaryColor = manifest.availableColors.colors.find((c: any) => c.name === 'primary')
				expect(primaryColor).toBeDefined()
				expect(primaryColor.isCustom).toBe(true)
				expect(primaryColor.shades).toContain('50')
				expect(primaryColor.shades).toContain('500')
				expect(primaryColor.shades).toContain('900')
			} finally {
				await cleanup()
			}
		})

		test('should preserve available colors after reset', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				manifestWriter.setAvailableColors({
					colors: [{ name: 'custom', shades: ['500'], isCustom: true }],
					defaultColors: [],
					customColors: ['custom'],
				})

				manifestWriter.reset()

				const entries: Record<string, ManifestEntry> = {
					'cms-0': { id: 'cms-0', sourcePath: '/index.html', tag: 'h1', text: 'Test' },
				}
				manifestWriter.addPage('/', entries, {})
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				// Available colors should be preserved after reset
				expect(manifest.availableColors).toBeDefined()
				expect(manifest.availableColors.customColors).toContain('custom')
			} finally {
				await cleanup()
			}
		})

		test('getAvailableColors should return set colors', () => {
			const manifestWriter = new ManifestWriter('cms-manifest.json')

			expect(manifestWriter.getAvailableColors()).toBeUndefined()

			manifestWriter.setAvailableColors({
				colors: [{ name: 'test', shades: ['100'], isCustom: true }],
				defaultColors: [],
				customColors: ['test'],
			})

			const colors = manifestWriter.getAvailableColors()
			expect(colors).toBeDefined()
			expect(colors?.customColors).toContain('test')
		})
	})

	describe('global manifest', () => {
		test('should accumulate entries from multiple pages', async () => {
			const { manifestWriter, cleanup } = await createTestContext()
			try {
				manifestWriter.addPage('/', {
					'cms-0': { id: 'cms-0', sourcePath: '/index.html', tag: 'h1', text: 'Home' },
				}, {})

				manifestWriter.addPage('/about', {
					'cms-1': { id: 'cms-1', sourcePath: '/about.html', tag: 'h1', text: 'About' },
				}, {})

				// Must finalize to wait for all queued writes to complete
				await manifestWriter.finalize()

				const globalManifest = manifestWriter.getGlobalManifest()

				expect(Object.keys(globalManifest.entries)).toHaveLength(2)
				expect(globalManifest.entries['cms-0']!.text).toBe('Home')
				expect(globalManifest.entries['cms-1']!.text).toBe('About')
			} finally {
				await cleanup()
			}
		})

		test('should include component definitions in global manifest', () => {
			const manifestWriter = new ManifestWriter('cms-manifest.json')

			manifestWriter.setComponentDefinitions({
				Button: {
					name: 'Button',
					file: 'src/components/Button.astro',
					props: [{ name: 'variant', type: 'string', required: false }],
				},
			})

			const globalManifest = manifestWriter.getGlobalManifest()

			expect(globalManifest.componentDefinitions.Button).toBeDefined()
			expect(globalManifest.componentDefinitions.Button!.name).toBe('Button')
		})

		test('finalize should return stats', async () => {
			const { manifestWriter, cleanup } = await createTestContext()
			try {
				manifestWriter.addPage('/', {
					'cms-0': { id: 'cms-0', sourcePath: '/index.html', tag: 'h1', text: 'Home' },
					'cms-1': { id: 'cms-1', sourcePath: '/index.html', tag: 'p', text: 'Welcome' },
				}, {
					'comp-0': { id: 'comp-0', componentName: 'Hero', file: 'src/components/Hero.astro', sourcePath: 'src/pages/index.astro', sourceLine: 5, props: {} },
				})

				manifestWriter.addPage('/about', {
					'cms-2': { id: 'cms-2', sourcePath: '/about.html', tag: 'h1', text: 'About' },
				}, {})

				const stats = await manifestWriter.finalize()

				expect(stats.totalEntries).toBe(3)
				expect(stats.totalPages).toBe(2)
				expect(stats.totalComponents).toBe(1)
			} finally {
				await cleanup()
			}
		})
	})

	describe('color classes in entries', () => {
		test('should preserve colorClasses in page manifest', async () => {
			const { tempDir, manifestWriter, cleanup } = await createTestContext()
			try {
				const entries: Record<string, ManifestEntry> = {
					'cms-0': {
						id: 'cms-0',
						sourcePath: '/index.html',
						tag: 'button',
						text: 'Click me',
						colorClasses: {
							bg: 'bg-blue-500',
							text: 'text-white',
							hoverBg: 'hover:bg-blue-600',
							allColorClasses: ['bg-blue-500', 'text-white', 'hover:bg-blue-600'],
						},
					},
				}

				manifestWriter.addPage('/', entries, {})
				await manifestWriter.finalize()

				const manifestPath = path.join(tempDir, 'index.json')
				const content = await fs.readFile(manifestPath, 'utf-8')
				const manifest = JSON.parse(content)

				const buttonEntry = manifest.entries['cms-0']
				expect(buttonEntry.colorClasses).toBeDefined()
				expect(buttonEntry.colorClasses.bg).toBe('bg-blue-500')
				expect(buttonEntry.colorClasses.text).toBe('text-white')
				expect(buttonEntry.colorClasses.hoverBg).toBe('hover:bg-blue-600')
				expect(buttonEntry.colorClasses.allColorClasses).toContain('bg-blue-500')
			} finally {
				await cleanup()
			}
		})
	})
})
