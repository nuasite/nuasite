import type { AstroIntegration } from 'astro'
import { processBuildOutput } from './build-processor'
import { ComponentRegistry } from './component-registry'
import { createDevMiddleware } from './dev-middleware'
import { ManifestWriter } from './manifest-writer'
import type { CmsMarkerOptions, ComponentDefinition } from './types'
import { createVitePlugin } from './vite-plugin'

export default function cmsMarker(options: CmsMarkerOptions = {}): AstroIntegration {
	const {
		attributeName = 'data-cms-id',
		includeTags = null,
		excludeTags = ['html', 'head', 'body', 'script', 'style'],
		includeEmptyText = false,
		generateManifest = true,
		manifestFile = 'cms-manifest.json',
		markComponents = true,
		componentDirs = ['src/components'],
		contentDir = 'src/content',
	} = options

	let componentDefinitions: Record<string, ComponentDefinition> = {}

	// Shared counter for generating unique IDs across all pages
	const idCounter = { value: 0 }

	// Create manifest writer instance that persists across the build
	const manifestWriter = new ManifestWriter(manifestFile, componentDefinitions)

	const config = {
		attributeName,
		includeTags,
		excludeTags,
		includeEmptyText,
		generateManifest,
		manifestFile,
		markComponents,
		componentDirs,
		contentDir,
	}

	return {
		name: 'astro-cms-marker',
		hooks: {
			'astro:config:setup': async ({ updateConfig, command, logger }) => {
				// Reset state for new build/dev session
				idCounter.value = 0
				manifestWriter.reset()

				// Scan for component definitions
				if (markComponents) {
					const registry = new ComponentRegistry(componentDirs)
					await registry.scan()
					componentDefinitions = registry.getComponents()
					manifestWriter.setComponentDefinitions(componentDefinitions)

					const componentCount = Object.keys(componentDefinitions).length
					if (componentCount > 0) {
						logger.info(`Found ${componentCount} component definitions`)
					}
				}

				// Create Vite plugin context
				const pluginContext = {
					manifestWriter,
					componentDefinitions,
					config,
					idCounter,
					command,
				}

				updateConfig({
					vite: {
						// biome-ignore lint/suspicious/noExplicitAny: Vite version mismatch between standalone vite and Astro's bundled vite
						plugins: [createVitePlugin(pluginContext) as any],
					},
				})
			},

			'astro:server:setup': ({ server, logger }) => {
				// biome-ignore lint/suspicious/noExplicitAny: Vite version mismatch between standalone vite and Astro's bundled vite
				createDevMiddleware(server as any, config, manifestWriter, componentDefinitions, idCounter)
				logger.info('Dev middleware initialized')
			},

			'astro:build:done': async ({ dir, logger }) => {
				if (generateManifest) {
					await processBuildOutput(dir, config, manifestWriter, idCounter, logger)
				}
			},
		},
	}
}

// Re-export types for consumers
export { findCollectionSource, parseMarkdownContent } from './source-finder'
export type { CollectionInfo, MarkdownContent } from './source-finder'
export type { CmsManifest, CmsMarkerOptions, CollectionEntry, ComponentDefinition, ComponentInstance, ManifestEntry } from './types'
