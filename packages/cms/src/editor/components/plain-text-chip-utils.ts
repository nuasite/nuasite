import type { ManifestEntry } from '../../types'

export function describeSource(entry: ManifestEntry | undefined): string {
	if (!entry) return 'no formatting'
	if (entry.collectionName) {
		return `${entry.collectionName} collection field`
	}
	if (entry.variableName) {
		return `${entry.variableName} prop`
	}
	return 'no formatting'
}
