import type { Plugin } from 'vite'
import { expectedDeletions } from './dev-middleware'
import type { ManifestWriter } from './manifest-writer'
import { markFileDirty } from './source-finder'
import type { CmsMarkerOptions, ComponentDefinition } from './types'
import { createArrayTransformPlugin } from './vite-plugin-array-transform'

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
		},
		load(id) {
			if (id === '\0virtual:cms-manifest') {
				return `export default ${JSON.stringify(manifestWriter.getGlobalManifest())};`
			}
			if (id === '\0virtual:cms-components') {
				return `export default ${JSON.stringify(componentDefinitions)};`
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
				if ((event === 'unlink' || event === 'unlinkDir') && expectedDeletions.has(filePath)) {
					expectedDeletions.delete(filePath)
					// Swallow the event — don't let Vite/Astro see it
					return true
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
