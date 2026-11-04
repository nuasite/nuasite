import { analyzeAstroScript, type AstroSourceAnalysis, parseFrontmatter as parseMarkdownFrontmatter } from '@nuasite/cms-core'
import path from 'node:path'

import { projectFiles } from '../project/context.ts'
import type { CollectionDefinition, ManifestEntry } from '../types.ts'
import { resolveSourcePath } from '../utils.ts'
import { getCachedParsedFile } from './ast-parser.ts'
import { projectRelativeSource } from './source-files.ts'
import type { CachedParsedFile } from './types.ts'
import { resolveImportPath } from './variable-extraction.ts'

/** Files whose imports and `astro:content` calls the walk reads. */
const MODULE_FILE = /\.(astro|[cm]?[jt]sx?)$/
/** Markdown pages: the walk follows their frontmatter `layout` and, in MDX, their ESM. */
const MARKDOWN_FILE = /\.mdx?$/

const NO_ANALYSIS: AstroSourceAnalysis = { imports: [], collectionCalls: [], collectionBindings: [] }

/** Analysis of a parsed script module, dropped together with its parse when the file changes. */
const scriptAnalyses = new WeakMap<CachedParsedFile, AstroSourceAnalysis>()

function analysisOf(filePath: string, parsed: CachedParsedFile): AstroSourceAnalysis {
	if (filePath.endsWith('.astro')) return parsed.frontmatterAnalysis ?? NO_ANALYSIS
	let analysis = scriptAnalyses.get(parsed)
	if (!analysis) {
		analysis = analyzeAstroScript(parsed.content)
		scriptAnalyses.set(parsed, analysis)
	}
	return analysis
}

/**
 * The collections read through `astro:content` in the static module graph of `files`, plus the
 * `seeds` and every collection they reference. All of them when no file of `files` is a module or
 * markdown page that exists (a dynamic route's page found by URL) or a `getCollection` name is not a literal.
 */
export async function collectionsReadBy(
	files: readonly string[],
	collections: Record<string, CollectionDefinition>,
	seeds: Iterable<string> = [],
): Promise<Set<string>> {
	const read = new Set<string>()
	const visited = new Set<string>()
	let readsAny = false

	function record(analysis: AstroSourceAnalysis): void {
		for (const call of analysis.collectionCalls) {
			if (call.collectionName !== null) read.add(call.collectionName)
			else if (call.accessor === 'getCollection') readsAny = true
		}
	}

	async function follow(sources: readonly string[], importer: string): Promise<void> {
		await Promise.all(sources.map(async source => {
			const imported = await resolveImportPath(source, importer)
			if (imported) await visit(path.normalize(imported))
		}))
	}

	/** Whether the file is a module or markdown page that was read. */
	async function visit(filePath: string): Promise<boolean> {
		if (visited.has(filePath)) return false
		if (MODULE_FILE.test(filePath)) {
			visited.add(filePath)
			const parsed = await getCachedParsedFile(filePath)
			if (!parsed) return false
			const analysis = analysisOf(filePath, parsed)
			record(analysis)
			await follow(analysis.imports.map(({ source }) => source), filePath)
			return true
		}
		if (MARKDOWN_FILE.test(filePath)) {
			visited.add(filePath)
			let content: string
			try {
				content = await projectFiles().readFile(filePath)
			} catch {
				return false
			}
			const { frontmatter, content: body } = parseMarkdownFrontmatter(content)
			const sources = typeof frontmatter.layout === 'string' ? [frontmatter.layout] : []
			if (filePath.endsWith('.mdx')) {
				const analysis = analyzeAstroScript(mdxEsm(body))
				record(analysis)
				sources.push(...analysis.imports.map(({ source }) => source))
			}
			await follow(sources, filePath)
			return true
		}
		return false
	}

	const roots = await Promise.all(files.map(file => visit(resolveSourcePath(file))))
	if (readsAny || !roots.some(Boolean)) return new Set(Object.keys(collections))

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
		// Annotations name templates; a collection data file an entry was attributed to is no root.
		if (entry.sourcePath && MODULE_FILE.test(entry.sourcePath)) rendered.add(projectRelativeSource(entry.sourcePath))
		if (entry.collectionName) shown.add(entry.collectionName)
	}
	return collectionsReadBy([...rendered], collections, shown)
}

/**
 * The ESM of an MDX body: blocks whose first line starts with `import` or `export`, up to a blank
 * line, as MDX reads them. Fenced code is skipped.
 */
function mdxEsm(body: string): string {
	const blocks: string[] = []
	let inFence = false
	let block: string[] | undefined
	for (const line of body.split('\n')) {
		if (/^(```|~~~)/.test(line)) inFence = !inFence
		if (inFence || line.trim() === '') {
			if (block) blocks.push(block.join('\n'))
			block = undefined
		} else if (block) block.push(line)
		else if (/^(import|export)\b/.test(line)) block = [line]
	}
	if (block) blocks.push(block.join('\n'))
	return blocks.join('\n')
}

/** The data files of the entries of `names`, as the indexes spell them (project-relative). */
export function entryFilesOf(names: ReadonlySet<string>, collections: Record<string, CollectionDefinition>): Set<string> {
	const files = new Set<string>()
	for (const name of names) {
		for (const entry of collections[name]?.entries ?? []) files.add(entry.sourcePath)
	}
	return files
}
