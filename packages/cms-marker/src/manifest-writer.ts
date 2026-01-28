import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from './config'
import { parseTailwindConfig, parseTextStyles } from './tailwind-colors'
import type {
	AvailableColors,
	AvailableTextStyles,
	CmsManifest,
	CollectionDefinition,
	CollectionEntry,
	ComponentDefinition,
	ComponentInstance,
	ManifestEntry,
	ManifestMetadata,
	PageEntry,
	PageSeoData,
} from './types'
import { generateManifestContentHash, generateSourceFileHashes } from './utils'

/** Current manifest schema version */
const MANIFEST_VERSION = '1.0'

/**
 * Manages streaming manifest writes during build.
 * Accumulates entries and writes per-page manifests as pages are processed.
 */
export class ManifestWriter {
	private globalManifest: CmsManifest
	private pageManifests: Map<string, {
		entries: Record<string, ManifestEntry>
		components: Record<string, ComponentInstance>
		collection?: CollectionEntry
		seo?: PageSeoData
	}> = new Map()
	private outDir: string = ''
	private manifestFile: string
	private componentDefinitions: Record<string, ComponentDefinition>
	private collectionDefinitions: Record<string, CollectionDefinition> = {}
	private availableColors: AvailableColors | undefined
	private availableTextStyles: AvailableTextStyles | undefined
	private writeQueue: Promise<void> = Promise.resolve()

	constructor(manifestFile: string, componentDefinitions: Record<string, ComponentDefinition> = {}) {
		this.manifestFile = manifestFile
		this.componentDefinitions = componentDefinitions
		this.globalManifest = {
			entries: {},
			components: {},
			componentDefinitions,
			collections: {},
			collectionDefinitions: {},
		}
	}

	/**
	 * Set the output directory for manifest files
	 */
	setOutDir(dir: string): void {
		this.outDir = dir
	}

	/**
	 * Update component definitions (called after initial scan)
	 */
	setComponentDefinitions(definitions: Record<string, ComponentDefinition>): void {
		this.componentDefinitions = definitions
		this.globalManifest.componentDefinitions = definitions
	}

	/**
	 * Load available Tailwind colors and text styles from the project's CSS config
	 */
	async loadAvailableColors(projectRoot: string = getProjectRoot()): Promise<void> {
		this.availableColors = await parseTailwindConfig(projectRoot)
		this.availableTextStyles = await parseTextStyles(projectRoot)
		this.globalManifest.availableColors = this.availableColors
		this.globalManifest.availableTextStyles = this.availableTextStyles
	}

	/**
	 * Set available colors directly (for testing or custom colors)
	 */
	setAvailableColors(colors: AvailableColors): void {
		this.availableColors = colors
		this.globalManifest.availableColors = colors
	}

	/**
	 * Set available text styles directly (for testing or custom styles)
	 */
	setAvailableTextStyles(textStyles: AvailableTextStyles): void {
		this.availableTextStyles = textStyles
		this.globalManifest.availableTextStyles = textStyles
	}

	/**
	 * Set collection definitions (inferred schemas for content collections)
	 */
	setCollectionDefinitions(definitions: Record<string, CollectionDefinition>): void {
		this.collectionDefinitions = definitions
		this.globalManifest.collectionDefinitions = definitions
	}

	/**
	 * Get collection definitions
	 */
	getCollectionDefinitions(): Record<string, CollectionDefinition> {
		return this.collectionDefinitions
	}

	/**
	 * Get the manifest path for a given page
	 * Places manifest next to the page: /about -> /about.json, / -> /index.json
	 */
	private getPageManifestPath(pagePath: string): string {
		if (pagePath === '/' || pagePath === '') {
			return path.join(this.outDir, 'index.json')
		}
		const cleanPath = pagePath.replace(/^\//, '')
		return path.join(this.outDir, `${cleanPath}.json`)
	}

	/**
	 * Add a page's entries to the manifest (called after each page is processed)
	 * This is non-blocking - writes are queued
	 */
	addPage(
		pagePath: string,
		entries: Record<string, ManifestEntry>,
		components: Record<string, ComponentInstance>,
		collection?: CollectionEntry,
		seo?: PageSeoData,
	): void {
		// Store in memory
		this.pageManifests.set(pagePath, { entries, components, collection, seo })

		// Update global manifest
		Object.assign(this.globalManifest.entries, entries)
		Object.assign(this.globalManifest.components, components)

		// Add collection entry to global manifest
		if (collection) {
			const collectionKey = `${collection.collectionName}/${collection.collectionSlug}`
			this.globalManifest.collections = this.globalManifest.collections || {}
			this.globalManifest.collections[collectionKey] = collection
		}

		// Queue the write operation (non-blocking)
		if (this.outDir) {
			this.writeQueue = this.writeQueue.then(() => this.writePageManifest(pagePath, entries, components, collection, seo))
		}
	}

	/**
	 * Write a single page manifest to disk
	 */
	private async writePageManifest(
		pagePath: string,
		entries: Record<string, ManifestEntry>,
		components: Record<string, ComponentInstance>,
		collection?: CollectionEntry,
		seo?: PageSeoData,
	): Promise<void> {
		const manifestPath = this.getPageManifestPath(pagePath)
		const manifestDir = path.dirname(manifestPath)

		await fs.mkdir(manifestDir, { recursive: true })

		// Generate metadata for this page manifest
		const metadata: ManifestMetadata = {
			version: MANIFEST_VERSION,
			generatedAt: new Date().toISOString(),
			generatedBy: 'astro-cms-marker',
			contentHash: generateManifestContentHash(entries),
			sourceFileHashes: generateSourceFileHashes(entries),
		}

		const pageManifest: {
			metadata: ManifestMetadata
			page: string
			entries: Record<string, ManifestEntry>
			components: Record<string, ComponentInstance>
			componentDefinitions: Record<string, ComponentDefinition>
			collection?: CollectionEntry
			seo?: PageSeoData
		} = {
			metadata,
			page: pagePath,
			entries,
			components,
			componentDefinitions: this.componentDefinitions,
		}

		if (collection) {
			pageManifest.collection = collection
		}

		if (seo) {
			pageManifest.seo = seo
		}

		await fs.writeFile(manifestPath, JSON.stringify(pageManifest, null, 2), 'utf-8')
	}

	/**
	 * Finalize manifest writes
	 * Call this in astro:build:done to ensure all writes complete
	 */
	async finalize(): Promise<{ totalEntries: number; totalPages: number; totalComponents: number }> {
		// Wait for all queued writes to complete
		await this.writeQueue

		// Build pages array with pathname and title, sorted by pathname
		const pages: PageEntry[] = Array.from(this.pageManifests.entries())
			.map(([pathname, data]) => {
				const entry: PageEntry = { pathname }
				if (data.seo?.title?.content) {
					entry.title = data.seo.title.content
				}
				return entry
			})
			.sort((a, b) => a.pathname.localeCompare(b.pathname))

		// Write global manifest with settings (component definitions, colors, text styles, collection definitions, and pages)
		if (this.outDir) {
			const globalManifestPath = path.join(this.outDir, this.manifestFile)
			const globalSettings: {
				componentDefinitions: Record<string, ComponentDefinition>
				collectionDefinitions?: Record<string, CollectionDefinition>
				availableColors?: AvailableColors
				availableTextStyles?: AvailableTextStyles
				pages: PageEntry[]
			} = {
				componentDefinitions: this.componentDefinitions,
				pages,
			}
			if (Object.keys(this.collectionDefinitions).length > 0) {
				globalSettings.collectionDefinitions = this.collectionDefinitions
			}
			if (this.availableColors) {
				globalSettings.availableColors = this.availableColors
			}
			if (this.availableTextStyles) {
				globalSettings.availableTextStyles = this.availableTextStyles
			}
			await fs.writeFile(
				globalManifestPath,
				JSON.stringify(globalSettings, null, 2),
				'utf-8',
			)
		}

		return {
			totalEntries: Object.keys(this.globalManifest.entries).length,
			totalPages: this.pageManifests.size,
			totalComponents: Object.keys(this.globalManifest.components).length,
		}
	}

	/**
	 * Get the global manifest (for virtual module support)
	 */
	getGlobalManifest(): CmsManifest {
		return this.globalManifest
	}

	/**
	 * Get a page's manifest data (for dev mode)
	 */
	getPageManifest(pagePath: string): {
		entries: Record<string, ManifestEntry>
		components: Record<string, ComponentInstance>
		collection?: CollectionEntry
		seo?: PageSeoData
	} | undefined {
		return this.pageManifests.get(pagePath)
	}

	/**
	 * Reset state (for dev mode reloads)
	 */
	reset(): void {
		this.pageManifests.clear()
		this.globalManifest = {
			entries: {},
			components: {},
			componentDefinitions: this.componentDefinitions,
			collections: {},
			collectionDefinitions: this.collectionDefinitions,
			availableColors: this.availableColors,
			availableTextStyles: this.availableTextStyles,
		}
		this.writeQueue = Promise.resolve()
	}

	/**
	 * Get available colors (for use in dev middleware)
	 */
	getAvailableColors(): AvailableColors | undefined {
		return this.availableColors
	}

	/**
	 * Get available text styles (for use in dev middleware)
	 */
	getAvailableTextStyles(): AvailableTextStyles | undefined {
		return this.availableTextStyles
	}
}
