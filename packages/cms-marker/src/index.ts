import type { AstroIntegration } from 'astro'
import { processBuildOutput } from './build-processor'
import { scanCollections } from './collection-scanner'
import { ComponentRegistry } from './component-registry'
import { resetProjectRoot } from './config'
import { createDevMiddleware } from './dev-middleware'
import { getErrorCollector, resetErrorCollector } from './error-collector'
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
		seo = { trackSeo: true, markTitle: true, parseJsonLd: true },
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
		seo,
	}

	return {
		name: 'astro-cms-marker',
		hooks: {
			'astro:config:setup': async ({ updateConfig, command, logger }) => {
				// Reset state for new build/dev session
				idCounter.value = 0
				manifestWriter.reset()
				resetErrorCollector()
				resetProjectRoot()

				// Load available colors from Tailwind config
				await manifestWriter.loadAvailableColors()

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

				// Scan content collections for schema inference
				const collectionDefinitions = await scanCollections(contentDir)
				manifestWriter.setCollectionDefinitions(collectionDefinitions)

				const collectionCount = Object.keys(collectionDefinitions).length
				if (collectionCount > 0) {
					logger.info(`Found ${collectionCount} content collection(s)`)
				}

				// Create Vite plugin context
				const pluginContext = {
					manifestWriter,
					componentDefinitions,
					config,
					idCounter,
					command,
				}

				// VitePluginLike is compatible with both Astro's bundled Vite and root Vite
				updateConfig({
					vite: {
						plugins: createVitePlugin(pluginContext) as any,
					},
				})
			},

			'astro:server:setup': ({ server, logger }) => {
				createDevMiddleware(server, config, manifestWriter, componentDefinitions, idCounter)
				logger.info('Dev middleware initialized')
			},

			'astro:build:done': async ({ dir, logger }) => {
				if (generateManifest) {
					await processBuildOutput(dir, config, manifestWriter, idCounter, logger)
				}

				// Report any warnings collected during processing
				const errorCollector = getErrorCollector()
				if (errorCollector.hasWarnings()) {
					const warnings = errorCollector.getWarnings()
					logger.warn(`${warnings.length} warning(s) during processing:`)
					for (const { context, message } of warnings) {
						logger.warn(`  - ${context}: ${message}`)
					}
				}
			},
		},
	}
}

// Re-export collection scanner
export { scanCollections } from './collection-scanner'
// Re-export config functions for testing
export { getProjectRoot, resetProjectRoot, setProjectRoot } from './config'
export type { CollectionInfo, MarkdownContent, SourceLocation, VariableReference } from './source-finder'
// Re-export types for consumers
export { findCollectionSource, parseMarkdownContent } from './source-finder'
export type {
	AriaAttributes,
	AvailableColors,
	AvailableTextStyles,
	ButtonAttributes,
	CanonicalUrl,
	CmsManifest,
	CmsMarkerOptions,
	CollectionDefinition,
	CollectionEntry,
	ColorClasses,
	ComponentDefinition,
	ComponentInstance,
	ComponentProp,
	ContentConstraints,
	DataAttributes,
	FieldDefinition,
	FieldType,
	FormAttributes,
	GradientClasses,
	IframeAttributes,
	ImageMetadata,
	InputAttributes,
	JsonLdEntry,
	LinkAttributes,
	ManifestEntry,
	ManifestMetadata,
	MediaAttributes,
	OpacityClasses,
	OpenGraphData,
	PageEntry,
	PageSeoData,
	SelectAttributes,
	SeoKeywords,
	SeoMetaTag,
	SeoOptions,
	SeoSourceInfo,
	SeoTitle,
	SourceContext,
	TailwindColor,
	TextareaAttributes,
	TextStyleValue,
	TwitterCardData,
} from './types'
