import type { AstroConfig } from 'astro'

// Astro's own checks on a redirect that need no routes (astro/dist/core/routing: `createRedirectRoutes`
// and `getParts` in create-manifest.js, `validateSegment` in segment.js). One that fails them stops
// the dev server, as Astro builds its route manifest from every redirect.
const ROUTE_DYNAMIC_SPLIT = /\[([^[\]()]+(?:\([^)]+\))?)\]/
const PARAM_NAME = /^(?:\.\.\.)?[\w$]+$/

/**
 * Why Astro's route manifest refuses the redirect from `from` to `destination`, or `null` when it passes
 * the checks that need no routes. A source with params whose destination is not a page is refused too,
 * but the routes are not known while the config is set up.
 */
export function astroRedirectRejection(from: string, destination: string): string | null {
	for (const segment of from.split('/').filter(Boolean)) {
		if (segment.includes('][')) return 'its parameters must be separated'
		if (segment.split('[').length !== segment.split(']').length) return 'its brackets are unbalanced'
		const parts = segment.split(ROUTE_DYNAMIC_SPLIT)
		for (let i = 1; i < parts.length; i += 2) {
			const name = /([^(]+)$/.exec(parts[i] ?? '')?.[1]
			if (name === undefined || !PARAM_NAME.test(name)) return `its parameter "[${parts[i]}]" is not named with letters, digits, _ or $`
		}
	}
	if (URL.canParse(destination) && !/^https?:\/\//.test(destination)) return `its destination "${destination}" is not an http(s) URL`
	return null
}

/**
 * The config's redirects without the ones Astro's route manifest refuses, each of which is reported.
 * The dev server answers redirects through that manifest, and a single refused one keeps it from starting.
 */
export function redirectsAstroServes(redirects: AstroConfig['redirects'], warn: (message: string) => void): AstroConfig['redirects'] {
	const served: AstroConfig['redirects'] = {}
	for (const [from, value] of Object.entries(redirects)) {
		const rejection = astroRedirectRejection(from, typeof value === 'string' ? value : value.destination)
		if (rejection === null) served[from] = value
		else warn(`The dev server leaves out the redirect from "${from}", which Astro rejects: ${rejection}.`)
	}
	return served
}
