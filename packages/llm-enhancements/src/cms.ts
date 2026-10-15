import type * as Cms from '@nuasite/cms'

/**
 * `@nuasite/cms`, an optional peer: without it every page is converted from its rendered HTML.
 *
 * Imported here, at the top level, and nowhere later. Astro evaluates an integration through a Vite
 * module runner that it closes once the config is loaded, so an import made in a hook fails in any Astro
 * build, Node or Bun ("Vite module runner has been closed"). A top-level await finishes while the config
 * is still loading.
 */
export const cms: typeof Cms | undefined = await import('@nuasite/cms').catch((error: unknown) => {
	if (isMissing(error)) return undefined
	throw error
})

/** The package is not installed, as opposed to installed and failing to load. */
function isMissing(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code
	const message = error instanceof Error ? error.message : String(error)
	return (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /Cannot find (module|package)/.test(message))
		// Quoted, so a missing `@nuasite/cms-types` under an installed cms is not taken for cms itself.
		&& /['"]@nuasite\/cms['"]/.test(message)
}
