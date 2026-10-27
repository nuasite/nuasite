import { unified } from '@astrojs/markdown-remark'
import { defineConfig as astroDefineConfig } from 'astro/config'
import nua from './integration'
import type { NuaIntegrationOptions } from './types'

export type { NuaIntegrationOptions } from './types'

type AstroUserConfig = Parameters<typeof astroDefineConfig>[0]

export interface NuaConfig extends AstroUserConfig {
	/**
	 * Configure the nua integration options.
	 * Set to `false` to disable the nua integration entirely.
	 */
	nua?: NuaIntegrationOptions | false
}

/**
 * Wrapper around Astro's `defineConfig` with nua integration pre-configured.
 *
 * @example
 * ```ts
 * // astro.config.ts
 * import { defineConfig } from '@nuasite/nua/config'
 *
 * export default defineConfig({
 *   site: 'https://example.com',
 * })
 * ```
 *
 * @example
 * ```ts
 * // With nua options
 * import { defineConfig } from '@nuasite/nua/config'
 *
 * export default defineConfig({
 *   site: 'https://example.com',
 *   nua: {
 *     sitemap: false,
 *   },
 * })
 * ```
 */
export function defineConfig(config: NuaConfig = {}) {
	const { nua: nuaOptions, integrations = [], vite = {}, markdown = {}, ...astroConfig } = config

	const mergedVite = {
		...vite,
		build: {
			sourcemap: true,
			...vite.build,
		},
	}

	const defaults = {
		site: 'http://localhost:4321',
		vite: mergedVite,
		// Astro 7 strips whitespace between elements by JSX rules by default (`'jsx'`), so
		// `<span>a</span> <em>b</em>` renders as "ab". Sites built on nua keep Astro 6's output.
		compressHTML: true,
		// Astro 7 renders markdown with Sätteri by default, which does not run remark or rehype
		// plugins. The CMS's directives and markers are remark/rehype plugins, so nua keeps the
		// `unified()` pipeline unless the site chose a processor itself.
		markdown: {
			...markdown,
			processor: markdown.processor ?? unified(),
		},
		legacy: {
			collectionsBackwardsCompat: true,
		},
	}

	// If nua is explicitly disabled, just pass through to Astro
	if (nuaOptions === false) {
		return astroDefineConfig({ ...defaults, ...astroConfig, integrations })
	}

	return astroDefineConfig({
		...defaults,
		...astroConfig,
		integrations: [nua(nuaOptions), ...integrations],
	})
}
