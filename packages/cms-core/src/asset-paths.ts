/**
 * Where an asset value in frontmatter points on disk.
 *
 * Extracted from the entry read path so the content check resolves an image the
 * same way serving it does — two implementations would disagree the moment one
 * of the shapes below changes, and the check would then report missing files
 * that the CMS happily serves.
 */

/** The directory a relative asset value in `file`'s frontmatter resolves against. */
export function assetBaseDir(file: string): string {
	const lastSlash = file.lastIndexOf('/')
	return lastSlash >= 0 ? file.slice(0, lastSlash) : ''
}

/** Join `rel` onto `base` segments, applying `.`/`..`; `null` on traversal above root. */
export function normalizeSegments(base: string[], rel: string): string | null {
	const out = base.slice()
	for (const seg of rel.replace(/^\/+/, '').split('/')) {
		if (seg === '' || seg === '.') continue
		if (seg === '..') {
			if (out.length === 0) return null
			out.pop()
			continue
		}
		out.push(seg)
	}
	return out.join('/')
}

/**
 * Resolve a stored asset value (as it appears in frontmatter) to candidate on-disk
 * paths, root-relative, in priority order. Handles the shapes that actually occur:
 *
 * - **Leading `/`** — a runtime URL (`/assets/x.jpeg`, `/uploads/x.webp`). Astro
 *   serves the `public/` dir at the site root, so try `public/<path>` first, then
 *   `<path>` from the project root (assets kept outside `public/`). `baseDir` is
 *   irrelevant, so these resolve without an owning entry.
 * - **Relative** (`../../src/assets/x.webp`, `./x.png`, `x.png`) — an Astro
 *   `image()` value, resolved against `baseDir` (the entry's directory), honoring
 *   `.`/`..`.
 *
 * Returns `[]` when the path climbs above the project root, or is relative with no `baseDir`.
 */
export function resolveAssetCandidates(baseDir: string | undefined, rel: string): string[] {
	if (rel.startsWith('/')) {
		const fromRoot = normalizeSegments([], rel)
		if (fromRoot === null || fromRoot === '') return []
		return [`public/${fromRoot}`, fromRoot]
	}
	if (baseDir === undefined) return []
	const joined = normalizeSegments(baseDir.split('/').filter(Boolean), rel)
	return joined === null ? [] : [joined]
}
