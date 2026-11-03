import fs from 'node:fs/promises'

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

/**
 * Reads the manifest a previous build left in dist/. A missing file or one this
 * version cannot parse counts as no manifest; any other read error is thrown.
 */
export async function readExistingManifest(manifestPath: string): Promise<FragmentManifest | null> {
	let raw: string
	try {
		raw = await fs.readFile(manifestPath, 'utf8')
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
		throw error
	}
	try {
		return parseManifest(JSON.parse(raw))
	} catch {
		return null
	}
}

export function parseManifest(value: unknown): FragmentManifest | null {
	if (!isRecord(value) || value.version !== 1 || typeof value.outputDir !== 'string' || typeof value.generatedAt !== 'string') return null
	if (!isRecord(value.fragments)) return null
	const fragments: Record<string, FragmentManifestEntry> = {}
	for (const [id, entry] of Object.entries(value.fragments)) {
		const parsed = parseEntry(id, entry)
		if (!parsed) return null
		fragments[id] = parsed
	}
	return { version: 1, generatedAt: value.generatedAt, outputDir: value.outputDir, fragments }
}

function parseEntry(id: string, entry: unknown): FragmentManifestEntry | null {
	if (!isRecord(entry) || entry.id !== id) return null
	const { file, moduleId, props, usedBy, size } = entry
	if (typeof file !== 'string' || typeof moduleId !== 'string' || typeof size !== 'number' || !isRecord(props)) return null
	if (!Array.isArray(usedBy)) return null
	const pages: string[] = []
	for (const page of usedBy) {
		if (typeof page !== 'string') return null
		pages.push(page)
	}
	return { id, file, moduleId, props, usedBy: pages, size }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
