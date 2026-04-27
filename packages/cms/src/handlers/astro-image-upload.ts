import fs from 'node:fs/promises'
import path from 'node:path'
import { pickAstroImageTarget } from '../astro-image-paths'
import type { ManifestWriter } from '../manifest-writer'
import type { MediaUploadContext } from '../types'
import { resolveSourcePath } from '../utils'

export interface AstroImageUploadResult {
	success: true
	url: string
	filename: string
}

export interface AstroImageUploadError {
	success: false
	error: string
}

/**
 * Attempt to route an upload to an Astro `image()` field's entry-relative location.
 * Returns null when the context doesn't match an `astroImage` field — caller should
 * fall back to the regular media-adapter upload flow.
 */
export async function tryAstroImageUpload(args: {
	context: Partial<MediaUploadContext>
	manifestWriter: ManifestWriter
	fileBuffer: Buffer
	originalFilename: string
}): Promise<AstroImageUploadResult | AstroImageUploadError | null> {
	const { collection, entry, field } = args.context
	if (!collection || !entry || !field) return null

	const definitions = args.manifestWriter.getCollectionDefinitions()
	const def = definitions[collection]
	if (!def) return null

	const fieldDef = def.fields.find(f => f.name === field)
	if (!fieldDef?.astroImage) return null

	const entryInfo = def.entries?.find(e => e.slug === entry)
	if (!entryInfo) {
		return { success: false, error: `Entry not found: ${collection}/${entry}` }
	}

	const target = await pickAstroImageTarget({
		entryAbsPath: resolveSourcePath(entryInfo.sourcePath),
		slug: entryInfo.slug,
		originalFilename: args.originalFilename,
		compareBuffer: args.fileBuffer,
	})

	await fs.mkdir(path.dirname(target.absPath), { recursive: true })
	await fs.writeFile(target.absPath, args.fileBuffer)

	return {
		success: true,
		url: target.relPath,
		filename: path.basename(target.absPath),
	}
}
