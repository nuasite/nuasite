import { defineConfig as astroDefineConfig } from 'astro/config'
import type { AstroUserConfig } from 'astro/config'
import nua from './integration'
import type { NuaIntegrationOptions } from './types'

export type { NuaIntegrationOptions } from './types'

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
 *     tailwindcss: true,
 *   },
 * })
 * ```
 */
export function defineConfig(config: NuaConfig = {}) {
	const { nua: nuaOptions, integrations = [], vite = {}, ...astroConfig } = config

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
