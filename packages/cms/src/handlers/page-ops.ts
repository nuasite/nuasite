import fs from 'node:fs/promises'
import { resolveAndValidatePath, slugify } from '../utils'

const PAGE_EXTENSIONS = ['.astro', '.md', '.mdx']

/**
 * Check whether a page slug is already taken. Page create/duplicate/delete and
 * layout listing now live in `@nuasite/cms-core`; this slug check stays here
 * because it is not part of the cms-core structural interface.
 */
export async function handleCheckSlugExists(slug: string): Promise<{ exists: boolean; filePath?: string }> {
	const normalizedSlug = slugify(slug)
	if (!normalizedSlug) return { exists: false }

	const found = await findPageFile(`/${normalizedSlug}`)
	return found ? { exists: true, filePath: found } : { exists: false }
}

// --- Internal helpers ---

async function fileExists(fullPath: string): Promise<boolean> {
	try {
		await fs.access(fullPath)
		return true
	} catch {
		return false
	}
}

async function findPageFile(pagePath: string): Promise<string | null> {
	const normalized = pagePath.replace(/^\//, '').replace(/\/$/, '') || 'index'

	for (const ext of PAGE_EXTENSIONS) {
		const direct = `src/pages/${normalized}${ext}`
		if (await fileExists(resolveAndValidatePath(direct))) return direct
	}

	for (const ext of PAGE_EXTENSIONS) {
		const indexFile = `src/pages/${normalized}/index${ext}`
		if (await fileExists(resolveAndValidatePath(indexFile))) return indexFile
	}

	return null
}
