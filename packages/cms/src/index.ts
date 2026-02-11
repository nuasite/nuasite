import type { AstroIntegration } from 'astro'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { processBuildOutput } from './build-processor'
import { scanCollections } from './collection-scanner'
import { ComponentRegistry } from './component-registry'
import { resetProjectRoot } from './config'
import { createDevMiddleware } from './dev-middleware'
import { getErrorCollector, resetErrorCollector } from './error-collector'
import { ManifestWriter } from './manifest-writer'
import { createLocalStorageAdapter } from './media/local'
import type { MediaStorageAdapter } from './media/types'
import type { CmsMarkerOptions, ComponentDefinition } from './types'
import { createVitePlugin } from './vite-plugin'

export interface NuaCmsOptions extends CmsMarkerOptions {
	/**
	 * URL to the CMS editor script.
	 * If not set, the built-in editor bundle is served from the dev server.
	 */
	src?: string
	/**
	 * CMS configuration passed as window.NuaCmsConfig.
	 */
	cmsConfig?: {
		apiBase?: string
		highlightColor?: string
		debug?: boolean
		theme?: Record<string, string>
		themePreset?: string
	}
	/**
	 * Proxy /_nua/cms requests to this target URL during dev.
	 * Example: 'http://localhost:8787'
	 */
	proxy?: string
	/**
	 * Media storage adapter for file uploads.
	 * Defaults to local filesystem (public/uploads) when no proxy is configured.
	 */
	media?: MediaStorageAdapter
}

const VIRTUAL_CMS_PATH = '/@nuasite/cms-editor.js'

export default function nuaCms(options: NuaCmsOptions = {}): AstroIntegration {
	const {
		// CMS editor options
		src,
		cmsConfig,
		proxy,
		media,
		// CMS marker options
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

	// When no proxy, enable local CMS API with default media adapter
	const enableCmsApi = !proxy
	const mediaAdapter = media ?? (enableCmsApi ? createLocalStorageAdapter() : undefined)

	// Default apiBase to local dev server when no proxy
	const resolvedCmsConfig = enableCmsApi && !cmsConfig?.apiBase
		? { ...cmsConfig, apiBase: '/_nua/cms' }
		: cmsConfig

	let componentDefinitions: Record<string, ComponentDefinition> = {}

	const idCounter = { value: 0 }
	const manifestWriter = new ManifestWriter(manifestFile, componentDefinitions)

	const markerConfig = {
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
		name: '@nuasite/astro-cms',
		hooks: {
			'astro:config:setup': async ({ updateConfig, command, injectScript, logger }) => {
				// --- CMS Marker setup ---
				idCounter.value = 0
				manifestWriter.reset()
				resetErrorCollector()
				resetProjectRoot()

				await manifestWriter.loadAvailableColors()

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

				const collectionDefinitions = await scanCollections(contentDir)
				manifestWriter.setCollectionDefinitions(collectionDefinitions)

				const collectionCount = Object.keys(collectionDefinitions).length
				if (collectionCount > 0) {
					logger.info(`Found ${collectionCount} content collection(s)`)
				}

				const pluginContext = {
					manifestWriter,
					componentDefinitions,
					config: markerConfig,
					idCounter,
					command,
				}

				const vitePlugins: any[] = [...(createVitePlugin(pluginContext) as any)]
				const cmsDir = !src ? dirname(fileURLToPath(import.meta.url)) : undefined

				// Detect pre-built editor bundle (present when installed from npm)
				const editorBundlePath = cmsDir ? join(cmsDir, '../dist/editor.js') : undefined
				const hasPrebuiltBundle = editorBundlePath ? existsSync(editorBundlePath) : false

				// --- CMS Editor setup (dev only) ---
				if (command === 'dev') {
					const editorSrc = src ?? VIRTUAL_CMS_PATH

					const configScript = resolvedCmsConfig
						? `window.NuaCmsConfig = ${JSON.stringify(resolvedCmsConfig)};`
						: ''

					injectScript(
						'page',
						`
						${configScript}
						if (!document.querySelector('script[data-nuasite-cms]')) {
							const s = document.createElement('script');
							s.type = 'module';
							s.src = ${JSON.stringify(editorSrc)};
							s.dataset.nuasiteCms = '';
							document.head.appendChild(s);
						}
					`,
					)

					if (!src) {
						if (hasPrebuiltBundle) {
							// Pre-built bundle exists (npm install case):
							// Serve it via a virtual module — no JSX pragma, Tailwind, or aliases needed.
							const bundleContent = readFileSync(editorBundlePath!, 'utf-8')
							vitePlugins.push({
								name: 'nuasite-cms-editor',
								resolveId(id: string) {
									if (id === VIRTUAL_CMS_PATH) {
										return VIRTUAL_CMS_PATH
									}
								},
								load(id: string) {
									if (id === VIRTUAL_CMS_PATH) {
										return bundleContent
									}
								},
							})
						} else {
							// No pre-built bundle (monorepo dev case):
							// Serve source files directly — Vite transforms TSX, resolves imports, HMR works.
							vitePlugins.push({
								name: 'nuasite-cms-editor',
								resolveId(id: string) {
									if (id === VIRTUAL_CMS_PATH) {
										return join(cmsDir!, 'editor/index.tsx')
									}
								},
							})

							// Prepend @jsxImportSource pragma for editor .tsx files
							// so Vite's esbuild uses Preact's h function
							vitePlugins.push({
								name: 'nuasite-cms-preact-jsx',
								transform(code: string, id: string) {
									if (id.includes('/src/editor/') && id.endsWith('.tsx') && !code.includes('@jsxImportSource')) {
										return `/** @jsxImportSource preact */\n${code}`
									}
								},
							})

							// Add Tailwind CSS Vite plugin for editor styles
							const tailwindcss = (await import('@tailwindcss/vite')).default
							vitePlugins.push(tailwindcss())
						}
					}
				}

				// Proxy API requests to the backend
				const proxyConfig: Record<string, any> = {}
				if (proxy) {
					proxyConfig['/_nua'] = {
						target: proxy,
						changeOrigin: true,
					}
				}

				// Only add react->preact aliases when serving source files (not pre-built bundle)
				const needsAliases = !src && !hasPrebuiltBundle

				updateConfig({
					vite: {
						plugins: vitePlugins,
						resolve: needsAliases
							? {
								alias: {
									'react': 'preact/compat',
									'react-dom': 'preact/compat',
									'react/jsx-runtime': 'preact/jsx-runtime',
								},
							}
							: undefined,
						server: {
							proxy: proxyConfig,
						},
					},
				})
			},

			'astro:server:setup': ({ server, logger }) => {
				createDevMiddleware(
					server,
					markerConfig,
					manifestWriter,
					componentDefinitions,
					idCounter,
					{ enableCmsApi, mediaAdapter },
				)
				logger.info('CMS dev middleware initialized')
				if (enableCmsApi) {
					logger.info('CMS API enabled at /_nua/cms/')
				}
			},

			'astro:build:done': async ({ dir, logger }) => {
				if (generateManifest) {
					await processBuildOutput(dir, markerConfig, manifestWriter, idCounter, logger)
				}

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

export { createContemberStorageAdapter as contemberMedia } from './media/contember'
export { createLocalStorageAdapter as localMedia } from './media/local'
export { createS3StorageAdapter as s3Media } from './media/s3'
export type { MediaItem, MediaStorageAdapter } from './media/types'

export { scanCollections } from './collection-scanner'
export { getProjectRoot, resetProjectRoot, setProjectRoot } from './config'
export type { CollectionInfo, MarkdownContent, SourceLocation, VariableReference } from './source-finder'
export { findCollectionSource, parseMarkdownContent } from './source-finder'
export type {
	Attribute,
	AvailableColors,
	AvailableTextStyles,
	CanonicalUrl,
	CmsManifest,
	CmsMarkerOptions,
	CollectionDefinition,
	CollectionEntry,
	ComponentDefinition,
	ComponentInstance,
	ComponentProp,
	ContentConstraints,
	FieldDefinition,
	FieldType,
	ImageMetadata,
	JsonLdEntry,
	ManifestEntry,
	ManifestMetadata,
	OpenGraphData,
	PageEntry,
	PageSeoData,
	SeoKeywords,
	SeoMetaTag,
	SeoOptions,
	SeoSourceInfo,
	SeoTitle,
	TailwindColor,
	TextStyleValue,
	TwitterCardData,
} from './types'
