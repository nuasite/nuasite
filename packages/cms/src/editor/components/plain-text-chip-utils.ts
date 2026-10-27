import type { ManifestEntry } from '../../types.ts'

export function describeSource(entry: ManifestEntry | undefined): string {
	if (!entry) return 'no formatting'
	if (entry.collectionName) {
		return `${entry.collectionName} collection field`
	}
	if (entry.variableName) {
		return `${entry.variableName} prop`
	}
	// Entry marked non-styleable but missing both collection and variable context —
	// visible fallback so the edge case surfaces instead of masquerading as a missing entry.
	return 'unknown source'
}
