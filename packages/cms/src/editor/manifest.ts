import type { MediaUploadContext } from '../types'
import type { CmsManifest, ComponentDefinition, ComponentInstance, FieldDefinition, ManifestEntry } from './types'

type GetManifestEntry = (manifest: CmsManifest, id: string) => ManifestEntry | undefined
export const getManifestEntry: GetManifestEntry = (manifest, id) => manifest.entries[id]

type HasManifestEntry = (manifest: CmsManifest, id: string) => boolean
export const hasManifestEntry: HasManifestEntry = (manifest, id) => id in manifest.entries

type GetComponentInstances = (manifest: CmsManifest) => Record<string, ComponentInstance>
export const getComponentInstances: GetComponentInstances = manifest => manifest.components ?? {}

type GetComponentInstance = (manifest: CmsManifest, id: string) => ComponentInstance | undefined
export const getComponentInstance: GetComponentInstance = (manifest, id) => manifest.components?.[id]

type GetComponentDefinitions = (manifest: CmsManifest) => Record<string, ComponentDefinition>
export const getComponentDefinitions: GetComponentDefinitions = manifest => manifest.componentDefinitions ?? {}

type GetComponentDefinition = (manifest: CmsManifest, name: string) => ComponentDefinition | undefined
export const getComponentDefinition: GetComponentDefinition = (manifest, name) => getComponentDefinitions(manifest)[name]

type GetManifestEntryCount = (manifest: CmsManifest) => number
export const getManifestEntryCount: GetManifestEntryCount = (manifest: CmsManifest) => Object.keys(manifest.entries).length

type GetAvailableComponentNames = (manifest: CmsManifest) => string[]
export const getAvailableComponentNames: GetAvailableComponentNames = manifest => Object.keys(getComponentDefinitions(manifest))

export function getCollectionField(
	manifest: CmsManifest,
	collectionName: string | undefined,
	fieldName: string | undefined,
): FieldDefinition | undefined {
	if (!collectionName || !fieldName) return undefined
	return manifest.collectionDefinitions?.[collectionName]?.fields.find(f => f.name === fieldName)
}

/**
 * Build the upload context that routes a media upload to an Astro `image()`
 * field's entry-relative location. Returns undefined when the field isn't
 * astroImage or any piece of the (collection, slug, field) triple is missing.
 */
export function buildAstroUploadContext(
	field: FieldDefinition | undefined,
	collection: string | undefined,
	slug: string | undefined,
): MediaUploadContext | undefined {
	if (!field?.astroImage || !collection || !slug) return undefined
	return { collection, entry: slug, field: field.name }
}

/** Look up the upload context for a CMS-marked element via its manifest entry. */
export function getAstroUploadContextForCmsId(
	manifest: CmsManifest,
	cmsId: string | null,
): MediaUploadContext | undefined {
	if (!cmsId) return undefined
	const entry = getManifestEntry(manifest, cmsId)
	if (!entry) return undefined
	const field = getCollectionField(manifest, entry.collectionName, entry.collectionFieldName)
	return buildAstroUploadContext(field, entry.collectionName, entry.collectionSlug)
}

export function getCollectionEntryOptions(manifest: CmsManifest, collectionName?: string): Array<{ value: string; label: string }> {
	if (!collectionName) return []
	const def = manifest.collectionDefinitions?.[collectionName]
	if (!def?.entries) return []
	return def.entries.map(e => ({
		value: e.slug,
		label: e.title ?? e.slug,
	}))
}
