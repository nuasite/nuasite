import type { Plugin } from 'vite'
import { invalidateCollectionRoutesCache } from './editor-service.ts'
import { expectedDeletions } from './expected-deletions.ts'
import type { ManifestWriter } from './manifest-writer.ts'
import { markFileDirty } from './source-finder/index.ts'
import type { CmsMarkerOptions, ComponentDefinition } from './types.ts'
import { createArrayTransformPlugin } from './vite-plugin-array-transform.ts'

export interface VitePluginContext {
	manifestWriter: ManifestWriter
	componentDefinitions: Record<string, ComponentDefinition>
	config: Required<CmsMarkerOptions>
	idCounter: { value: number }
	command: 'dev' | 'build' | 'preview' | 'sync'
}

export function createVitePlugin(context: VitePluginContext): Plugin[] {
	const { manifestWriter, componentDefinitions, command } = context

	const virtualManifestPlugin: Plugin = {
		name: 'cms-marker-virtual-manifest',
		resolveId(id) {
			if (id === '/@cms/manifest' || id === 'virtual:cms-manifest') {
				return '\0virtual:cms-manifest'
			}
			if (id === '/@cms/components' || id === 'virtual:cms-components') {
				return '\0virtual:cms-components'
			}
			if (id === 'virtual:cms-component-preview') {
				return '\0virtual:cms-component-preview'
			}
		},
		load(id) {
			if (id === '\0virtual:cms-manifest') {
				return `export default ${JSON.stringify(manifestWriter.getGlobalManifest())};`
			}
			if (id === '\0virtual:cms-components') {
				return `export default ${JSON.stringify(componentDefinitions)};`
			}
			if (id === '\0virtual:cms-component-preview') {
				const entries = Object.values(componentDefinitions).map(
					(def) => `  ${JSON.stringify(def.file)}: () => import(${JSON.stringify('/' + def.file)})`,
				)
				return `export const components = {\n${entries.join(',\n')}\n};`
			}
		},
	}

	// File extensions that are indexed by the CMS search index
	const INDEXED_EXTENSIONS = /\.(astro|tsx|jsx|json|ya?ml|mdx?)$/

	// Stable handler reference so configureServer re-entry doesn't leak listeners
	const onFileChange = (filePath: string) => {
		if (INDEXED_EXTENSIONS.test(filePath)) {
			markFileDirty(filePath)
		}
		// Invalidate cached collection routes when a dynamic route file changes
		if (filePath.includes('/src/pages/') && filePath.includes('[')) {
			invalidateCollectionRoutesCache()
			manifestWriter.clearCollectionPathnames()
		}
	}

	// Intercept Vite's file watcher to:
	// 1. Mark changed source files dirty for incremental re-indexing
	// 2. Suppress full page reloads when the CMS deletes a content collection entry
	const watcherPlugin: Plugin = {
		name: 'cms-suppress-delete-reload',
		configureServer(server) {
			if (command !== 'dev') return

			const watcher = server.watcher

			// Mark changed files dirty so the search index re-indexes only them.
			// Remove first to avoid duplicate listeners on Astro dev server restarts.
			watcher.off('change', onFileChange).on('change', onFileChange)
			watcher.off('add', onFileChange).on('add', onFileChange)
			// Astro + Vite plugins collectively add many 'change' listeners to the
			// shared watcher. Raise the limit to suppress the spurious warning.
			watcher.setMaxListeners(20)

			// Monkey-patch the watcher to intercept unlink events before Vite/Astro
			// processes them. We use prependListener so our handler runs first.
			const origEmit = watcher.emit.bind(watcher)
			watcher.emit = ((event: string, filePath: string, ...args: any[]) => {
				if (event === 'unlink' || event === 'unlinkDir') {
					if (expectedDeletions.has(filePath)) {
						expectedDeletions.delete(filePath)
						// Swallow the event — don't let Vite/Astro see it
						return true
					}
					// Invalidate cached collection routes when a dynamic route file is deleted
					if (filePath.includes('/src/pages/') && filePath.includes('[')) {
						invalidateCollectionRoutesCache()
						manifestWriter.clearCollectionPathnames()
					}
				}
				return origEmit(event, filePath, ...args)
			}) as typeof watcher.emit
		},
	}

	// Note: We cannot use transformIndexHtml for static Astro builds because
	// Astro generates HTML files directly without going through Vite's HTML pipeline.
	// HTML processing is done in build-processor.ts after pages are generated.
	// Source location attributes are provided natively by Astro's compiler
	// (data-astro-source-file, data-astro-source-loc) in dev mode.
	return [virtualManifestPlugin, watcherPlugin, createArrayTransformPlugin()]
}
