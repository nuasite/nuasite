/**
 * The version an exact range names (`7.4.2`, `=7.4.2`, `v7.4.2`, `7.4.2+build.1`,
 * `7.0.0-beta.1`), or null when the range matches more than one version.
 */
export function exactVersion(range: string): string | null {
	const cleaned = range.trim().replace(/^=\s*/, '').replace(/^v/, '').replace(/\+[0-9A-Za-z.-]+$/, '')
	return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(cleaned) ? cleaned : null
}

/**
 * The peer range to publish for a catalog version.
 *
 * Catalogs hold the exact version the tests run on. A peer on a package released
 * apart from nuasite (astro) has to accept other patch and minor releases, or
 * every site on another one gets a peer conflict (ERESOLVE under npm), so its
 * exact catalog version is published as a caret range with that version as the
 * floor. `@nuasite/*` peers stay exact: they are released in lockstep, so the
 * exact version is the set tested together. `allowPinned` keeps a package's
 * peers exact (`@nuasite/core`, whose job is pinning them).
 */
export function peerRange(name: string, version: string, options: { allowPinned: boolean }): string {
	if (options.allowPinned || name.startsWith('@nuasite/')) return version
	const exact = exactVersion(version)
	return exact ? `^${exact}` : version
}

/** Third-party peers still pinned to one version after resolution, as error messages. */
export function pinnedPeers(peers: Record<string, unknown> | undefined, options: { allowPinned: boolean }): string[] {
	if (options.allowPinned) return []
	return Object.entries(peers ?? {})
		.filter(([name, range]) => !name.startsWith('@nuasite/') && exactVersion(String(range)) !== null)
		.map(([name, range]) => `peerDependencies:${name} is pinned to ${range}; publish a range`)
}
