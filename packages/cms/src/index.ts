import type { AstroIntegration } from 'astro'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
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
import type { CmsFeatures, CmsMarkerOptions, ComponentDefinition } from './types'
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
		features?: CmsFeatures
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
	/**
	 * Directories containing components available in the MDX component picker.
	 * Only components within these directories (relative to project root) will appear.
	 * Example: ['src/components/mdx'] or ['src/components/mdx', 'src/components/blocks']
	 */
	mdxComponentDirs?: string[]
	/**
	 * Per-collection field overrides for position and grouping.
	 * Highest priority — overrides scanner defaults and frontmatter comment directives.
	 */
	collections?: Record<string, {
		fields?: Record<string, { position?: 'sidebar' | 'header'; group?: string }>
	}>
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
		mdxComponentDirs,
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
		name: '@nuasite/cms',
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

					if (mdxComponentDirs) {
						const normalizedDirs = mdxComponentDirs.map(dir => dir.endsWith('/') ? dir : dir + '/')
						const mdxNames = Object.values(componentDefinitions)
							.filter(def => normalizedDirs.some(dir => def.file.startsWith(dir)))
							.map(def => def.name)
						manifestWriter.setMdxComponents(mdxNames)
					}

					const componentCount = Object.keys(componentDefinitions).length
					if (componentCount > 0) {
						logger.info(`Found ${componentCount} component definitions`)
					}
				}

				const collectionDefinitions = await scanCollections(contentDir)

				// Apply per-collection field overrides from astro config (highest priority)
				if (options.collections) {
					for (const [collectionName, overrides] of Object.entries(options.collections)) {
						const def = collectionDefinitions[collectionName]
						if (!def || !overrides.fields) continue
						for (const field of def.fields) {
							const fieldOverride = overrides.fields[field.name]
							if (!fieldOverride) continue
							if (fieldOverride.position) field.position = fieldOverride.position
							if (fieldOverride.group) field.group = fieldOverride.group
						}
					}
				}

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

				// Merge CMS-managed redirects (src/_redirects) into dist/_redirects
				await mergeRedirects(dir, logger)

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

/**
 * Merge CMS-managed redirects from src/_redirects into the build output's dist/_redirects.
 * This ensures both Astro config redirects (written by adapters) and CMS-managed redirects coexist.
 */
async function mergeRedirects(dir: URL, logger: { info: (msg: string) => void }): Promise<void> {
	const srcRedirectsPath = join(process.cwd(), 'src', '_redirects')

	let cmsRedirects: string
	try {
		cmsRedirects = (await fs.readFile(srcRedirectsPath, 'utf-8')).trim()
	} catch {
		return
	}
	if (!cmsRedirects) return

	const distDir = fileURLToPath(dir)
	const distRedirectsPath = join(distDir, '_redirects')

	let existing = ''
	try {
		existing = await fs.readFile(distRedirectsPath, 'utf-8')
	} catch {
		// File doesn't exist yet — will be created
	}

	const separator = existing ? '\n\n# CMS-managed redirects\n' : '# CMS-managed redirects\n'
	await fs.writeFile(distRedirectsPath, existing + separator + cmsRedirects + '\n', 'utf-8')

	const lineCount = cmsRedirects.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length
	logger.info(`Merged ${lineCount} CMS redirect(s) into _redirects`)
}

export { createContemberStorageAdapter as contemberMedia } from './media/contember'
export { createLocalStorageAdapter as localMedia } from './media/local'
export { createS3StorageAdapter as s3Media } from './media/s3'
export type { MediaFolderItem, MediaItem, MediaListOptions, MediaListResult, MediaStorageAdapter, MediaTypeFilter } from './media/types'

export { scanCollections } from './collection-scanner'
export { getProjectRoot, resetProjectRoot, setProjectRoot } from './config'
export type { CollectionInfo, MarkdownContent, SourceLocation, VariableReference } from './source-finder'
export { findCollectionSource, parseMarkdownContent } from './source-finder'
export type {
	Attribute,
	AvailableColors,
	AvailableTextStyles,
	CanonicalUrl,
	CmsDeselectElementMessage,
	CmsEditorState,
	CmsElementDeselectedMessage,
	CmsElementSelectedMessage,
	CmsInboundMessage,
	CmsManifest,
	CmsMarkerOptions,
	CmsPageNavigatedMessage,
	CmsPostMessage,
	CmsReadyData,
	CmsReadyMessage,
	CmsSelectedElement,
	CmsStateChangedMessage,
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
