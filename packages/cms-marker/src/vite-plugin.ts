import type { Plugin } from 'vite'
import type { ManifestWriter } from './manifest-writer'
import type { CmsMarkerOptions, ComponentDefinition } from './types'
import { createAstroTransformPlugin } from './astro-transform'

export interface VitePluginContext {
	manifestWriter: ManifestWriter
	componentDefinitions: Record<string, ComponentDefinition>
	config: Required<CmsMarkerOptions>
	idCounter: { value: number }
	command: 'dev' | 'build' | 'preview' | 'sync'
}

export function createVitePlugin(context: VitePluginContext): Plugin[] {
	const { manifestWriter, componentDefinitions, config, command } = context

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

	// Create the Astro transform plugin to inject source location attributes
	// Only enabled in dev mode - during build, source locations are handled
	// in build-processor.ts after HTML is generated
	const astroTransformPlugin = createAstroTransformPlugin({
		markComponents: config.markComponents,
		enabled: command === 'dev',
	})

	// Note: We cannot use transformIndexHtml for static Astro builds because
	// Astro generates HTML files directly without going through Vite's HTML pipeline.
	// HTML processing is done in build-processor.ts after pages are generated.
	return [astroTransformPlugin, virtualManifestPlugin]
}
