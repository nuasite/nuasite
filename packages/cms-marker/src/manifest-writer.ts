import fs from 'node:fs/promises'
import path from 'node:path'
import { parseTailwindConfig } from './tailwind-colors'
import type { AvailableColors, CmsManifest, CollectionEntry, ComponentDefinition, ComponentInstance, ManifestEntry, ManifestMetadata } from './types'
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
	}> = new Map()
	private outDir: string = ''
	private manifestFile: string
	private componentDefinitions: Record<string, ComponentDefinition>
	private availableColors: AvailableColors | undefined
	private writeQueue: Promise<void> = Promise.resolve()

	constructor(manifestFile: string, componentDefinitions: Record<string, ComponentDefinition> = {}) {
		this.manifestFile = manifestFile
		this.componentDefinitions = componentDefinitions
		this.globalManifest = {
			entries: {},
			components: {},
			componentDefinitions,
			collections: {},
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
	 * Load available Tailwind colors from the project's CSS config
	 */
	async loadAvailableColors(projectRoot: string = process.cwd()): Promise<void> {
		this.availableColors = await parseTailwindConfig(projectRoot)
		this.globalManifest.availableColors = this.availableColors
	}

	/**
	 * Set available colors directly (for testing or custom colors)
	 */
	setAvailableColors(colors: AvailableColors): void {
		this.availableColors = colors
		this.globalManifest.availableColors = colors
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
	): void {
		// Store in memory
		this.pageManifests.set(pagePath, { entries, components, collection })

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
			this.writeQueue = this.writeQueue.then(() => this.writePageManifest(pagePath, entries, components, collection))
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

		await fs.writeFile(manifestPath, JSON.stringify(pageManifest, null, 2), 'utf-8')
	}

	/**
	 * Finalize manifest writes
	 * Call this in astro:build:done to ensure all writes complete
	 */
	async finalize(): Promise<{ totalEntries: number; totalPages: number; totalComponents: number }> {
		// Wait for all queued writes to complete
		await this.writeQueue

		// Write global manifest with settings (component definitions and available colors)
		if (this.outDir) {
			const globalManifestPath = path.join(this.outDir, this.manifestFile)
			const globalSettings: {
				componentDefinitions: Record<string, ComponentDefinition>
				availableColors?: AvailableColors
			} = {
				componentDefinitions: this.componentDefinitions,
			}
			if (this.availableColors) {
				globalSettings.availableColors = this.availableColors
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
			availableColors: this.availableColors,
		}
		this.writeQueue = Promise.resolve()
	}

	/**
	 * Get available colors (for use in dev middleware)
	 */
	getAvailableColors(): AvailableColors | undefined {
		return this.availableColors
	}
}
