import type { AstroConfig } from 'astro'
import { writeFile } from 'node:fs/promises'

/** Read by the Nua hosting at publish time. Its format is shared with it and must not drift. */
export const DOMAINS_FILE = '_domains.json'

/** Locale path (as in `i18n.locales`) to the origin that serves it, e.g. `{ sk: 'https://www.example.sk' }`. */
export type NuaDomains = Record<string, string>

export interface DomainMapping {
	origin: string
	/** Where the locale sits in the build: `/sk`, or `''` for an unprefixed default locale. */
	prefix: string
}

/**
 * Turns `nua.domains` into the mapping the hosting serves by. The build itself does not change: every
 * locale stays under its path prefix, so the same output works on preview URLs. On each mapped domain
 * the hosting serves that prefix from the root and rewrites links to the public URLs.
 *
 * Astro's own `i18n.domains` cannot do this for us: it is limited to `output: 'server'`.
 */
export function resolveDomainMappings(i18n: AstroConfig['i18n'], domains: NuaDomains): DomainMapping[] {
	const entries = Object.entries(domains)
	if (entries.length === 0) {
		return []
	}
	if (!i18n) {
		throw new Error('nua.domains maps locales to domains, so it needs an `i18n` config with those locales.')
	}

	const paths = i18n.locales.map(locale => typeof locale === 'string' ? locale : locale.path)
	const prefixDefaultLocale = typeof i18n.routing === 'object' && i18n.routing.prefixDefaultLocale === true
	const origins = new Set<string>()

	return entries.map(([locale, origin]) => {
		if (!paths.includes(locale)) {
			throw new Error(`nua.domains: "${locale}" is not one of i18n.locales (${paths.join(', ')}).`)
		}
		const url = URL.canParse(origin) ? new URL(origin) : null
		if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname !== '/' || url.search || url.hash) {
			throw new Error(`nua.domains: "${origin}" must be a bare origin such as https://www.example.sk, with no path.`)
		}
		if (origins.has(url.origin)) {
			throw new Error(`nua.domains: ${url.origin} is mapped to more than one locale.`)
		}
		origins.add(url.origin)
		const unprefixed = locale === i18n.defaultLocale && !prefixDefaultLocale
		return { origin: url.origin, prefix: unprefixed ? '' : `/${locale}` }
	})
}

export async function writeDomainsFile(dir: URL, mappings: DomainMapping[]): Promise<void> {
	await writeFile(new URL(DOMAINS_FILE, dir), `${JSON.stringify({ domains: mappings }, null, '\t')}\n`)
}
