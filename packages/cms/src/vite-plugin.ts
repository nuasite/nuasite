import { watch } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { invalidateContentCache, notifyContentStoreUpdated, type ViteServerLike } from './content-invalidator'
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

	// Vite's bundled chokidar 3.6.0 fails to detect changes to .astro/data-store.json
	// (added via watcher.add() in Astro's vite-plugin-content-virtual-mod).
	// Without this, content collection edits update the data store on disk but the
	// browser never receives a full-reload because Vite's watcher never fires "change"
	// for that file. We use native fs.watch as a reliable fallback.
	//
	// Caveat: native fs.watch on Linux tracks the inode, not the path. Astro writes
	// data-store.json via atomic rename (writeFile-tmp + rename), which replaces the
	// inode and silently kills the existing watcher. We re-attach on every event to
	// keep tracking the live file across atomic writes.
	const dataStoreWatchPlugin: Plugin = {
		name: 'cms-data-store-watch',
		configureServer(server) {
			if (command !== 'dev') return
			const root = server.config.root
			const dataStorePath = join(root, '.astro', 'data-store.json')
			let fsWatcher: ReturnType<typeof watch> | undefined
			let debounce: ReturnType<typeof setTimeout> | undefined
			let closed = false

			const invalidate = () => {
				invalidateContentCache(server as unknown as ViteServerLike)
				// Wake any CMS API middleware call that is currently blocked
				// waiting for the data store to reflect a just-written file.
				// This keeps the invalidation on a single path (here) and lets
				// the middleware respond only after the SSR module graph is fresh.
				notifyContentStoreUpdated()
			}

			const onEvent = () => {
				clearTimeout(debounce)
				debounce = setTimeout(invalidate, 80)
				// Re-attach: native fs.watch dies after the inode is replaced by an
				// atomic rename. Close current and restart so subsequent writes are
				// observed.
				fsWatcher?.close()
				fsWatcher = undefined
				if (!closed) startWatching()
			}

			const startWatching = () => {
				if (closed) return
				try {
					fsWatcher = watch(dataStorePath, onEvent)
				} catch {
					// File doesn't exist yet — retry when it appears
					setTimeout(startWatching, 2000)
				}
			}

			// Data store is created during content sync, which runs after server start
			setTimeout(startWatching, 3000)

			const origClose = server.close.bind(server)
			server.close = async () => {
				closed = true
				fsWatcher?.close()
				clearTimeout(debounce)
				return origClose()
			}
		},
	}

	// Note: We cannot use transformIndexHtml for static Astro builds because
	// Astro generates HTML files directly without going through Vite's HTML pipeline.
	// HTML processing is done in build-processor.ts after pages are generated.
	// Source location attributes are provided natively by Astro's compiler
	// (data-astro-source-file, data-astro-source-loc) in dev mode.
	return [virtualManifestPlugin, watcherPlugin, dataStoreWatchPlugin, createArrayTransformPlugin()]
}
