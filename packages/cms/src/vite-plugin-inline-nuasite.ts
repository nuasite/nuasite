import type { Plugin, ResolvedConfig } from 'vite'

const NUASITE_PACKAGE = /^@nuasite\//

/**
 * Keep every `@nuasite/*` package inside Vite in dev, in every environment.
 *
 * The packages ship TypeScript source as their entry points (`./src/index.ts`)
 * and re-export with extensionless paths. Only Vite (or Bun) can load that.
 * Astro, though, crawls the dependency tree and lists packages that do not
 * depend on Astro themselves (`@nuasite/cms-core`, `@nuasite/cms-types`) as
 * explicit externals, and an explicit external wins over `noExternal`. Under
 * Node, the content config's `import { n } from '@nuasite/cms'` then reaches
 * `cms-core` through Node's own loader, which cannot resolve the extensionless
 * path, or refuses to strip types under `node_modules` altogether, and the
 * content config does not load.
 *
 * The build bundles the content config, so only the dev server needs this.
 */
export function inlineNuasitePackages(): Plugin {
	return {
		name: 'nuasite-cms-inline-nuasite-packages',
		apply: 'serve',
		configResolved(config) {
			for (const environment of [config, ...Object.values(config.environments ?? {})]) {
				inlineIn(environment.resolve)
			}
		},
	}
}

type ResolveOptions = Pick<ResolvedConfig['resolve'], 'external' | 'noExternal'>

/** Drop `@nuasite/*` from the explicit externals and make sure it is not externalized by default either. */
export function inlineIn(resolve: ResolveOptions | undefined): void {
	if (!resolve) return
	if (Array.isArray(resolve.external)) {
		const kept = resolve.external.filter(id => !NUASITE_PACKAGE.test(id))
		resolve.external.splice(0, resolve.external.length, ...kept)
	}
	if (resolve.noExternal === true) return
	const noExternal = Array.isArray(resolve.noExternal) ? resolve.noExternal : resolve.noExternal ? [resolve.noExternal] : []
	if (!noExternal.some(entry => entry instanceof RegExp && entry.source === NUASITE_PACKAGE.source)) noExternal.push(NUASITE_PACKAGE)
	;(resolve as { noExternal: ResolveOptions['noExternal'] }).noExternal = noExternal
}
