export interface FragmentManifestEntry {
	id: string
	file: string
	moduleId: string
	props: Record<string, unknown>
	usedBy: string[]
	size: number
}

export interface FragmentManifest {
	version: 1
	generatedAt: string
	outputDir: string
	fragments: Record<string, FragmentManifestEntry>
}

export interface BuildManifestParams {
	outputDir: string
	entries: Array<{
		hash: string
		moduleId: string
		props: Record<string, unknown>
		usedBy: string[]
		size: number
	}>
}

export function buildManifest({ outputDir, entries }: BuildManifestParams): FragmentManifest {
	const fragments: Record<string, FragmentManifestEntry> = {}
	for (const entry of entries.sort((a, b) => a.hash.localeCompare(b.hash))) {
		fragments[entry.hash] = {
			id: entry.hash,
			file: `${outputDir}/${entry.hash}.html`,
			moduleId: entry.moduleId,
			props: entry.props,
			usedBy: entry.usedBy.sort(),
			size: entry.size,
		}
	}
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		outputDir,
		fragments,
	}
}
