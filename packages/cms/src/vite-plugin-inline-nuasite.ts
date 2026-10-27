import type { Plugin, ResolvedConfig, UserConfig } from 'vite'

const NUASITE_PACKAGE = /^@nuasite\//

/**
 * Keep every `@nuasite/*` package inside Vite in dev, in every environment.
 *
 * Astro crawls the dependency tree in dev and lists packages that do not depend
 * on Astro themselves (`@nuasite/cms-core`, `@nuasite/components`) as explicit
 * externals, and an explicit external wins over `noExternal`. An external is
 * loaded by the runtime instead of Vite. The compiled packages publish JS that
 * Node loads, but some packages publish source only Vite can load: the `.astro`
 * components of `@nuasite/components`, the `.tsx` of `@nuasite/collections-admin`.
 * Under Bun the `.astro` imports then resolve to file paths and render as
 * path-named tags; under Node they do not load at all.
 *
 * Dropping the ids from the explicit list is enough: Vite does not externalize
 * a resolved `.ts`/`.astro` file on its own. An `@nuasite/*` external the site
 * set itself (`userExternals`) is kept. The build bundles these packages and is
 * left alone.
 */
export function inlineNuasitePackages(options: { keep?: Iterable<string> } = {}): Plugin {
	const keep = new Set(options.keep)
	return {
		name: 'nuasite-inline-nuasite-packages',
		apply: 'serve',
		configResolved(config) {
			for (const environment of [config, ...Object.values(config.environments ?? {})]) {
				dropCrawledExternals(environment.resolve, keep)
			}
		},
	}
}

/** Remove `@nuasite/*` ids from an explicit external list, except those in `keep`. */
export function dropCrawledExternals(resolve: Pick<ResolvedConfig['resolve'], 'external'> | undefined, keep: ReadonlySet<string> = new Set()): void {
	if (!resolve || !Array.isArray(resolve.external)) return
	const kept = resolve.external.filter(id => !NUASITE_PACKAGE.test(id) || keep.has(id))
	resolve.external.splice(0, resolve.external.length, ...kept)
}

/** The `@nuasite/*` ids the site's own Vite config lists as external, anywhere. */
export function userExternals(vite: UserConfig | undefined): string[] {
	if (!vite) return []
	const lists = [
		vite.ssr?.external,
		vite.resolve?.external,
		...Object.values(vite.environments ?? {}).map(environment => environment?.resolve?.external),
	]
	return lists.flatMap(list => Array.isArray(list) ? list.filter(id => NUASITE_PACKAGE.test(id)) : [])
}
