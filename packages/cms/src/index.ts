import type { AstroIntegration } from 'astro'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLocalStorageAdapter, createNodeFs, createPublicStaticFileChecker, parseProjectCmsConfig } from '@nuasite/cms-core'
import { processBuildOutput } from './build-processor'
import type { CollectionOverrides } from './collection-overrides'
import { ComponentRegistry } from './component-registry'
import { getProjectRoot, resetProjectRoot } from './config'
import { createDevMiddleware } from './dev-middleware'
import { getErrorCollector, resetErrorCollector } from './error-collector'
import { ADMIN_ROUTE, createLocalAdminMiddleware } from './local-admin'
import { ManifestWriter } from './manifest-writer'
import { addMarkdownPlugins } from './markdown/processor'
import { rehypeCmsMarker } from './markdown/rehype'
import { resolveMarkerConfig } from './marker-config'
import type { MediaStorageAdapter } from './media/types'
import { type CmsMode, resolveCmsMode } from './mode'
import { mergeCmsRedirectsInto } from './redirects'
import { scanCollections } from './scan-cache'
import type { CmsFeatures, CmsMarkerOptions, ComponentDefinition } from './types'
import { createVitePlugin } from './vite-plugin'
import { inlineNuasitePackages } from './vite-plugin-inline-nuasite'

export { addMarkdownPlugins, unifiedOptionsOf } from './markdown/processor'
export { cmsRemarkPlugins } from './markdown/remark'

export interface NuaCmsOptions extends CmsMarkerOptions {
	/**
	 * URL to the CMS editor (inline visual-editing widget) script.
	 *
	 * Resolution order in dev:
	 * 1. this `src`, if set;
	 * 2. the `NUA_CMS_EDITOR_SRC` environment variable (lets the host runtime point
	 *    dev-preview at a specific CDN/local editor without a config change);
	 * 3. the public CDN editor (`DEFAULT_CDN_EDITOR_SRC`) when a pre-built editor
	 *    bundle ships with the package (the npm-installed case — e.g. a generated
	 *    site's dev-preview), so the inline editor updates via a CDN push,
	 *    independent of the site's `@nuasite/cms` version (matching hosting);
	 * 4. the bundled editor served from the dev server, used only in the monorepo
	 *    (no pre-built bundle) so editor source changes hot-reload.
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
		listStyles?: Array<{ label: string; class: string }>
		/**
		 * The project's language as a BCP 47 tag (`'cs'`). Collection labels are compared in it, so
		 * collections are listed in the same order for every editor and in every collection browser.
		 * Defaults to Astro's `i18n.defaultLocale`; without either, labels are compared as English.
		 *
		 * Only takes effect when written as a string literal (or a top-level `const` holding one)
		 * in the Astro config file itself, where the CMS options are passed: the `nua.cms` block,
		 * `nuaCms({ … })` or `nua({ cms: { … } })` in `integrations`. The value is read from that
		 * file's source, not from the options at runtime. A locale that comes from an env
		 * variable, a helper, an import, a spread, a conditional or `mergeConfig` does nothing,
		 * in the in-page editor as well as in a standalone sidecar; the dev server logs a warning
		 * when that happens. This way the two can never disagree.
		 */
		locale?: string
		/** Open the entry editor's metadata (frontmatter) panel by default instead of collapsed. */
		openMetadataByDefault?: boolean
		/**
		 * Describes the host site's color theme. The CMS draws editor chrome and outlines
		 * in a contrasting color. 'auto' (default) detects via prefers-color-scheme and
		 * the page's computed background.
		 */
		siteTheme?: 'auto' | 'light' | 'dark'
	}
	/**
	 * Run mode (cms-headless F7). Controls whether the plugin serves a local
	 * full-page collections admin:
	 *
	 * - `local` (default for `pletivo dev` on a developer machine): lazily spawn an
	 *   in-process cms-sidecar over the project's `node:fs` and serve the
	 *   `@nuasite/collections-admin` SPA at `/_nua/admin`. The inline widget runs
	 *   in-page as usual.
	 * - `hosted` (inside the agent sandbox): a no-op for spawning/serving — the
	 *   sidecar is a managed sandbox service and the admin is the webmaster tab.
	 *   The plugin stays marker + CDN-inject only.
	 *
	 * Auto-detected from the environment when omitted (a sandbox env signal ⇒
	 * `hosted`; otherwise `local`). An explicit value always wins.
	 */
	mode?: CmsMode
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
	 * Per-collection overrides for the CMS browser.
	 * Highest priority — overrides scanner defaults and frontmatter comment directives.
	 */
	collections?: CollectionOverrides
	/**
	 * Enable polling for file watching.
	 * Set to `true` on filesystems that don't support native events (e.g. network mounts).
	 * E2B sandboxes use ext4 with full inotify support, so polling is unnecessary.
	 * @default false
	 */
	usePolling?: boolean
	/**
	 * Maximum upload size in bytes. Applied to `/_nua/cms/media/upload` requests
	 * (enforced on the server and pre-checked on the client).
	 * @default 20 * 1024 * 1024 (20 MB)
	 */
	maxUploadSize?: number
}

const DEFAULT_MAX_UPLOAD_SIZE = 20 * 1024 * 1024

const VIRTUAL_CMS_PATH = '/@nuasite/cms-editor.js'

/**
 * Virtual module id of the local `/_nua/admin` SPA entry (cms-headless F7). The
 * HTML shell loads it as `<script type="module">`; the Vite plugin resolves it to
 * `src/admin/entry.tsx` so the dev server transforms it (TSX → JS, real React).
 */
const VIRTUAL_ADMIN_ENTRY = '/@nuasite/cms-admin-entry.js'

/**
 * Public CDN editor script. Same URL hosting injects (see webmaster
 * `packages/worker-hosting` `editorSrc`), so dev-preview and hosting load the
 * identical inline editor and a CDN push updates both without touching the site.
 */
const DEFAULT_CDN_EDITOR_SRC = 'https://cdn.nuasite.com/script/latest/cms-editor.js'

/**
 * Tailwind's Vite plugin, for the editor styles when the editor is served from source (the monorepo, where
 * `dist/editor.js` is not built). `@tailwindcss/vite` is only a dev dependency, so an installed package,
 * which ships the bundle, never loads it.
 *
 * Imported here, at the top level. Astro evaluates the integration through a Vite module runner that it
 * closes once the config is loaded, so an import made in `astro:config:setup` fails with "Vite module runner
 * has been closed" (#116). A top-level await finishes while the config is still loading.
 */
const editorTailwind = existsSync(join(dirname(fileURLToPath(import.meta.url)), '../dist/editor.js'))
	? undefined
	: (await import('@tailwindcss/vite').catch(() => undefined))?.default

export default function nuaCms(options: NuaCmsOptions = {}): AstroIntegration {
	const {
		// CMS editor options
		src,
		cmsConfig,
		proxy,
		media,
		mdxComponentDirs,
		usePolling = false,
		maxUploadSize = DEFAULT_MAX_UPLOAD_SIZE,
	} = options
	const markerConfig = resolveMarkerConfig(options)
	const { manifestFile, markComponents, componentDirs, contentDir } = markerConfig

	// Run mode (cms-headless F7): `local` serves a full-page collections admin at
	// /_nua/admin over an in-process sidecar; `hosted` (inside the agent sandbox)
	// is a no-op for that — the managed sandbox sidecar + the webmaster tab own it.
	// An explicit `options.mode` wins; otherwise auto-detect from the environment.
	const mode = resolveCmsMode(options.mode)
	const serveLocalAdmin = mode === 'local'

	// When no proxy, enable local CMS API with default media adapter
	const enableCmsApi = !proxy
	const mediaAdapter = media ?? (enableCmsApi ? createLocalStorageAdapter() : undefined)

	// Default apiBase to local dev server when no proxy; thread maxUploadSize through
	// to the editor so the client can pre-check before sending the upload.
	const resolvedCmsConfig = {
		...(cmsConfig ?? {}),
		...(enableCmsApi && !cmsConfig?.apiBase ? { apiBase: '/_nua/cms' } : {}),
		maxUploadSize,
	}

	let componentDefinitions: Record<string, ComponentDefinition> = {}
	let isPublicStaticFile: ((urlPath: string) => boolean) | undefined

	const idCounter = { value: 0 }
	const manifestWriter = new ManifestWriter(manifestFile, componentDefinitions)

	return {
		name: '@nuasite/cms',
		hooks: {
			'astro:config:setup': async ({ config, updateConfig, command, injectScript, injectRoute, logger }) => {
				// CMS is only needed during dev — skip all setup during build
				if (command !== 'dev') return

				// Inject dev-only component preview route (prerender:false → SSR with query param access)
				injectRoute({
					pattern: '/_nua/preview',
					entrypoint: new URL('./pages/component-preview.astro', import.meta.url).pathname,
					prerender: false,
				})

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

				// With the per-collection overrides from astro config applied (highest priority)
				const collectionDefinitions = await scanCollections(contentDir, options.collections)

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

				const vitePlugins: any[] = [...(createVitePlugin(pluginContext) as any), inlineNuasitePackages()]
				const cmsDir = dirname(fileURLToPath(import.meta.url))

				// Local-mode (cms-headless F7): resolve the /_nua/admin SPA entry virtual
				// module to src/admin/entry.tsx so Vite transforms it (TSX → JS, real
				// React) and HMR works. The HTML shell loads this id as a module script.
				if (serveLocalAdmin) {
					vitePlugins.push({
						name: 'nuasite-cms-admin-entry',
						resolveId(id: string) {
							if (id === VIRTUAL_ADMIN_ENTRY) {
								return join(cmsDir, 'admin/entry.tsx')
							}
						},
					})
				}

				// Detect pre-built editor bundle (present when installed from npm)
				const editorBundlePath = join(cmsDir, '../dist/editor.js')
				const hasPrebuiltBundle = existsSync(editorBundlePath)

				// Resolve which editor script dev-preview injects:
				// 1. explicit `src`; 2. `NUA_CMS_EDITOR_SRC` env; 3. the public CDN editor
				// when shipping a pre-built bundle (npm-installed site) — so dev-preview
				// loads the same CDN editor as hosting and a CDN push updates it without a
				// site rebuild; 4. the bundled source (monorepo only) for editor HMR.
				const envSrc = process.env.NUA_CMS_EDITOR_SRC
				const resolvedEditorSrc = src ?? envSrc ?? (hasPrebuiltBundle ? DEFAULT_CDN_EDITOR_SRC : VIRTUAL_CMS_PATH)

				// Local virtual-module serving is only needed when injecting the bundled
				// editor (the monorepo source path) — not for an external/CDN URL.
				const servesBundledEditor = resolvedEditorSrc === VIRTUAL_CMS_PATH

				// --- CMS Editor setup (dev only) ---
				if (command === 'dev') {
					const editorSrc = resolvedEditorSrc

					// The project's language, for ordering collection labels. Read from the config
					// source by the same function the sidecar's `/config` uses — rather than from the
					// resolved config at hand — so the in-page editor and every sidecar client are
					// given the same value, including when neither can read it: a `cmsConfig.locale`
					// the source does not give for this page is dropped here (`undefined` does not
					// serialize), not passed through — with a warning, since the option was set and
					// did nothing.
					const { locale } = await parseProjectCmsConfig(createNodeFs(getProjectRoot()))
					if (cmsConfig?.locale !== undefined && cmsConfig.locale !== locale) {
						// Three different reasons end up here, and the log line cannot tell which: the value
						// is not a literal in the source; it is, on a CMS instance that is not the one a
						// page ends up with; or it is, and the options reach the integration by a route the
						// source reader cannot follow. Naming only the first sends the others looking for a
						// fix they have already made.
						logger.warn(
							`cmsConfig.locale "${cmsConfig.locale}" differs from what the Astro config source gives`
								+ ` (${locale ? `"${locale}"` : 'nothing'}), so ${locale ? `"${locale}"` : 'no locale'} is used.`
								+ ` Either it is not a string literal there; or another CMS instance in the config is the one in effect`
								+ ` (nua runs its own CMS, which takes over from a nuaCms() listed next to it);`
								+ ` or the CMS options are not written where the integration is called in the config`
								+ ` (they come from a helper, an import, a spread, a conditional or nested \`integrations\` entry, or mergeConfig).`,
						)
					}
					const configScript = `window.NuaCmsConfig = ${JSON.stringify({ ...resolvedCmsConfig, locale })};`

					injectScript(
						'page',
						`
						if (window.location.pathname.startsWith('/_nua/')) {
							// Skip CMS editor on internal preview pages
						} else {
							${configScript}
							if (!document.querySelector('script[data-nuasite-cms]')) {
								const s = document.createElement('script');
								s.type = 'module';
								s.src = ${JSON.stringify(editorSrc)};
								s.dataset.nuasiteCms = '';
								document.head.appendChild(s);
							}
						}
					`,
					)

					if (servesBundledEditor) {
						// Monorepo dev (no pre-built bundle): serve the editor source files
						// directly so Vite transforms TSX, resolves imports, and HMR works.
						vitePlugins.push({
							name: 'nuasite-cms-editor',
							resolveId(id: string) {
								if (id === VIRTUAL_CMS_PATH) {
									return join(cmsDir, 'editor/index.tsx')
								}
							},
						})

						// Prepend @jsxImportSource pragma for editor .tsx files
						// so Vite's Oxc uses Preact's h function
						vitePlugins.push({
							name: 'nuasite-cms-preact-jsx',
							transform(code: string, id: string) {
								if (id.includes('/src/editor/') && id.endsWith('.tsx') && !code.includes('@jsxImportSource')) {
									return `/** @jsxImportSource preact */\n${code}`
								}
							},
						})

						// Add Tailwind CSS Vite plugin for editor styles
						if (editorTailwind) vitePlugins.push(editorTailwind())
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

				// Only add react->preact aliases when serving the editor source files
				// (monorepo dev) — an external/CDN editor URL needs no module rewriting.
				const needsAliases = servesBundledEditor

				// Marks where rendered markdown starts, so the HTML processor can find the entry's wrapper.
				if (!addMarkdownPlugins(config, { rehypePlugins: [rehypeCmsMarker] })) {
					logger.warn(
						`The "${config.markdown.processor.name}" markdown processor does not run rehype plugins, so markdown content is not marked`
							+ ` for editing. Set \`markdown.processor: unified()\` from @astrojs/markdown-remark (@nuasite/nua does this by default).`,
					)
				}

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
							...(usePolling ? { watch: { usePolling: true } } : {}),
						},
					},
				})
			},

			'astro:config:done': ({ config }) => {
				isPublicStaticFile = createPublicStaticFileChecker(fileURLToPath(config.publicDir))
			},

			'astro:server:setup': ({ server, logger }) => {
				createDevMiddleware(
					server,
					markerConfig,
					manifestWriter,
					componentDefinitions,
					idCounter,
					{ enableCmsApi, mediaAdapter, isPublicStaticFile, maxUploadSize, collectionOverrides: options.collections },
				)
				logger.info('CMS dev middleware initialized')
				if (enableCmsApi) {
					logger.info('CMS API enabled at /_nua/cms/')
				}

				// Local-mode full-page collections admin (cms-headless F7). Registered
				// only in `local` mode — in `hosted` (sandbox) this is a strict no-op:
				// the managed sandbox sidecar (F2) + the webmaster tab (F3) own it.
				// The in-process sidecar + SPA are built lazily on the first /_nua/admin
				// hit, so dev startup stays fast. Media defaults to local public/uploads.
				if (serveLocalAdmin) {
					createLocalAdminMiddleware(server, {
						contentDir,
						componentDirs,
						collectionOverrides: options.collections,
						mediaAdapter: media ?? createLocalStorageAdapter(),
						maxUploadSize,
						entryModuleId: VIRTUAL_ADMIN_ENTRY,
					})
					logger.info(`CMS collections admin available at ${ADMIN_ROUTE}`)
				}
			},

			'astro:build:done': async ({ dir, logger }) => {
				// The root the dev editor writes `src/_redirects` under, so the build reads what it wrote.
				await mergeCmsRedirectsInto(dir, getProjectRoot(), logger)
			},
		},
	}
}

export {
	createContemberStorageAdapter as contemberMedia,
	createLocalStorageAdapter as localMedia,
	createS3StorageAdapter as s3Media,
} from '@nuasite/cms-core'
export {
	type CollectionLayout,
	type CollectionLayoutSection,
	type Color,
	type Date,
	type DateHints,
	type DateTime,
	defineCmsCollection,
	type Email,
	FIELD_TYPES,
	type FileHints,
	type Image,
	type ImageHints,
	isFieldType,
	type LayoutHints,
	n,
	type NumberHints,
	type PathnameSegment,
	type PathnameSpec,
	type Reference,
	type Textarea,
	type TextareaHints,
	type TextHints,
	type Time,
	type Url,
	type VideoHints,
} from './fields'
export type { MediaFolderItem, MediaItem, MediaListOptions, MediaListResult, MediaStorageAdapter, MediaTypeFilter } from './media/types'
export { type CmsMode, detectHostedFromEnv, resolveCmsMode } from './mode'

export { scanCollections } from '@nuasite/cms-core'
export { createPublicStaticFileChecker } from '@nuasite/cms-core'
export { collectionPagesByPathname } from './collection-pages'
export { getProjectRoot, resetProjectRoot, setProjectRoot } from './config'
export { rehypeCmsMarker } from './markdown/rehype'
export { type FieldMigration, migrateAstroImages, type MigrationOptions, type MigrationResult } from './migrate-astro-image'
export { type ProjectAtRoot, projectAtRoot, runAtProjectRoot } from './project/at-root'
export {
	astroRedirectLines,
	mergeCmsRedirectsInto,
	mergeConfigRedirectsInto,
	mergeRedirectsInto,
	type MergeRedirectsIntoOptions,
	type RedirectsLogger,
} from './redirects'
/**
 * Scan the content collections of the current project (its root, or the one entered with
 * {@link runAtProjectRoot}). Unlike cms-core's `scanCollections`, it takes no filesystem and shares the
 * project's content-config parse cache; it applies no Astro-config `collections` overrides, which only
 * change labels. Hand the result to {@link findCollectionSource} or {@link collectionPagesByPathname}
 * when resolving many pages in a row: without it, every call scans every collection again.
 */
export { scanCollections as scanProjectCollections } from './scan-cache'
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
	CmsFeatures,
	CmsInboundMessage,
	CmsManifest,
	CmsMarkerOptions,
	CmsOpenEntryMessage,
	CmsPageNavigatedMessage,
	CmsPostMessage,
	CmsReadyData,
	CmsReadyMessage,
	CmsSelectedElement,
	CmsSetFeaturesMessage,
	CmsStateChangedMessage,
	CollectionDefinition,
	CollectionEntry,
	ComponentDefinition,
	ComponentInstance,
	ComponentProp,
	ContentConstraints,
	FieldDefinition,
	FieldHints,
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
