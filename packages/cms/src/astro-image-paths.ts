import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const HUGO_INDEX_RE = /^index\.(md|mdx)$/i

/** True when the entry uses the Hugo-style `<slug>/index.md(x)` layout (vs. a flat `<slug>.md` file). */
export function isHugoStyleEntry(entryAbsPath: string): boolean {
	return HUGO_INDEX_RE.test(path.basename(entryAbsPath))
}

/** First 8 hex chars of a sha256 digest — enough entropy to disambiguate collision suffixes. */
export function shortContentHash(buf: Buffer): string {
	return createHash('sha256').update(buf).digest('hex').slice(0, 8)
}

/**
 * Compute the on-disk target for an Astro `image()` field's value.
 *
 * Layout rules:
 * - Hugo-style entry (`<slug>/index.md`) → file goes inside the entry's directory, bare filename.
 * - Flat entry (`<slug>.md`) → file goes next to the entry, prefixed with the slug
 *   so multiple entries don't collide on a shared filename.
 *
 * If a candidate slot already holds a file with identical bytes to `compareBuffer`,
 * it's reused; otherwise the filename gets a content-hash suffix.
 */
export async function pickAstroImageTarget(args: {
	entryAbsPath: string
	slug: string
	originalFilename: string
	compareBuffer: Buffer
}): Promise<{ absPath: string; relPath: string }> {
	const entryDir = path.dirname(args.entryAbsPath)
	const isHugoStyle = isHugoStyleEntry(args.entryAbsPath)

	// `originalFilename` may come from user-controlled multipart input — strip any
	// directory components so a `../` segment can't escape the entry directory.
	const safeFilename = path.basename(args.originalFilename)
	if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
		throw new Error(`Invalid filename: ${args.originalFilename}`)
	}

	const baseName = isHugoStyle ? safeFilename : `${args.slug}-${safeFilename}`
	const baseAbs = path.join(entryDir, baseName)
	if (await isFreeOrMatching(baseAbs, args.compareBuffer)) {
		return { absPath: baseAbs, relPath: `./${baseName}` }
	}

	const candidateAbs = await pickHashedSibling(entryDir, baseName, args.compareBuffer)
	return { absPath: candidateAbs, relPath: `./${path.basename(candidateAbs)}` }
}

/**
 * Pick an absolute path in `dir` for `filename`; if a file with the same name already
 * exists, content-hash-suffix it. Reuses an existing file with identical bytes.
 *
 * `filename` may come from a URL pathname or other untrusted source — directory
 * components are stripped via `path.basename` so a `../` segment can't escape `dir`.
 */
export async function pickSiblingTarget(dir: string, filename: string, buf: Buffer): Promise<string> {
	const safe = path.basename(filename)
	if (!safe || safe === '.' || safe === '..') {
		throw new Error(`Invalid filename: ${filename}`)
	}
	const baseAbs = path.join(dir, safe)
	if (await isFreeOrMatching(baseAbs, buf)) return baseAbs
	return pickHashedSibling(dir, safe, buf)
}

async function pickHashedSibling(dir: string, baseName: string, buf: Buffer): Promise<string> {
	const hash = shortContentHash(buf)
	const ext = path.extname(baseName)
	const stem = path.basename(baseName, ext)
	for (let attempt = 0; attempt < 5; attempt++) {
		const suffix = attempt === 0 ? hash : `${hash}-${attempt}`
		const candidateAbs = path.join(dir, `${stem}-${suffix}${ext}`)
		if (await isFreeOrMatching(candidateAbs, buf)) return candidateAbs
	}
	throw new Error(`Could not pick a unique filename for ${baseName} in ${dir}`)
}

/** True if the slot is empty, or holds a file with identical bytes to `compareBuffer`. */
export async function isFreeOrMatching(absPath: string, compareBuffer: Buffer): Promise<boolean> {
	try {
		const stat = await fs.stat(absPath)
		if (stat.size !== compareBuffer.length) return false
		const existing = await fs.readFile(absPath)
		return compareBuffer.equals(existing)
	} catch {
		return true
	}
}
