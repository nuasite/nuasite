import { analyzeAstroScript, type AstroSourceAnalysis } from '@nuasite/cms-core'
import path from 'node:path'

import type { CollectionDefinition, ManifestEntry } from '../types.ts'
import { resolveSourcePath } from '../utils.ts'
import { getCachedParsedFile } from './ast-parser.ts'
import { projectRelativeSource } from './source-files.ts'
import type { CachedParsedFile } from './types.ts'
import { resolveImportPath } from './variable-extraction.ts'

/** Files whose imports and `astro:content` calls the walk reads. */
const MODULE_FILE = /\.(astro|[cm]?[jt]sx?)$/

/** Analysis of a parsed file, dropped together with its parse when the file changes. */
const analyses = new WeakMap<CachedParsedFile, AstroSourceAnalysis>()

function analysisOf(filePath: string, parsed: CachedParsedFile): AstroSourceAnalysis {
	let analysis = analyses.get(parsed)
	if (!analysis) {
		analysis = analyzeAstroScript(filePath.endsWith('.astro') ? parsed.frontmatterFile ?? '' : parsed.content)
		analyses.set(parsed, analysis)
	}
	return analysis
}

/**
 * The collections read through `astro:content` in the static module graph of `files`, plus the
 * `seeds` and every collection they reference; a non-literal `getCollection` name reads them all.
 * A value is attributed to a collection only within this set, which over-approximates what renders.
 */
export async function collectionsReadBy(
	files: readonly string[],
	collections: Record<string, CollectionDefinition>,
	seeds: Iterable<string> = [],
): Promise<Set<string>> {
	const read = new Set<string>()
	const visited = new Set<string>()
	let readsAny = false

	async function visit(filePath: string): Promise<void> {
		if (visited.has(filePath) || !MODULE_FILE.test(filePath)) return
		visited.add(filePath)
		const parsed = await getCachedParsedFile(filePath)
		if (!parsed) return

		const analysis = analysisOf(filePath, parsed)
		for (const call of analysis.collectionCalls) {
			if (call.collectionName !== null) read.add(call.collectionName)
			else if (call.accessor === 'getCollection') readsAny = true
		}
		await Promise.all(analysis.imports.map(async ({ source }) => {
			const imported = await resolveImportPath(source, filePath)
			if (imported) await visit(path.normalize(imported))
		}))
	}

	await Promise.all(files.map(file => visit(resolveSourcePath(file))))
	if (readsAny) return new Set(Object.keys(collections))

	for (const seed of seeds) read.add(seed)
	// A rendered entry can show the entries its reference fields point to.
	const queue = [...read]
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		for (const field of collections[name]?.fields ?? []) {
			const referenced = field.type === 'reference' || (field.type === 'array' && field.itemType === 'reference') ? field.collection : undefined
			if (referenced && !read.has(referenced)) {
				read.add(referenced)
				queue.push(referenced)
			}
		}
	}
	return new Set([...read].filter(name => collections[name]))
}

/**
 * The collections a page reads, walked from its own files, the files it is rendered from and every
 * file one of its elements is annotated with. The collections its entries are tagged with are seeds.
 */
export function collectionsReadByPage(
	entries: Record<string, ManifestEntry>,
	files: readonly string[],
	collections: Record<string, CollectionDefinition>,
): Promise<Set<string>> {
	const rendered = new Set(files.map(projectRelativeSource))
	const shown = new Set<string>()
	for (const entry of Object.values(entries)) {
		if (entry.sourcePath) rendered.add(projectRelativeSource(entry.sourcePath))
		if (entry.collectionName) shown.add(entry.collectionName)
	}
	return collectionsReadBy([...rendered], collections, shown)
}

/** The data files of the entries of `names`, as the indexes spell them (project-relative). */
export function entryFilesOf(names: ReadonlySet<string>, collections: Record<string, CollectionDefinition>): Set<string> {
	const files = new Set<string>()
	for (const name of names) {
		for (const entry of collections[name]?.entries ?? []) files.add(entry.sourcePath)
	}
	return files
}
