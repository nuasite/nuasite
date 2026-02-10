import type { CmsManifest, ComponentDefinition, ComponentInstance, ManifestEntry } from './types'

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
