/**
 * Read every declared collection off disk once.
 *
 * Split out of `check.ts` because more than one checker needs the same material: the
 * type/reference rules there, and the live-schema rules that re-parse each entry against
 * the project's real Zod schema. Loading twice would double the I/O on a 1.5k-entry site
 * and let the two disagree about which files even belong to a collection.
 */

import path from 'node:path'
import yaml from 'yaml'
import type { ParsedCollection, ParsedConfig } from './content-config-ast'
import type { CollectionKind } from './editor-write-model'
import type { CmsFileSystem } from './fs/types'

export interface LoadedEntry {
	/** Root-relative path of the source file. */
	file: string
	/** The id Astro's `glob()` loader derives from the file, and therefore what a `reference()` must hold. */
	stem: string
	/** Parsed frontmatter, or `undefined` when it did not parse. */
	frontmatter?: Record<string, unknown>
	/** First line of the parse failure, set when `frontmatter` is absent. */
	parseError?: string
}

export interface LoadedCollection {
	name: string
	/** Normalized, root-relative loader base. */
	base: string
	/** False when the loader base directory is not there at all. */
	exists: boolean
	entries: LoadedEntry[]
}

export type LoadedCollections = Map<string, LoadedCollection>

const DATA_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])

/** `./content/articles` and `content/articles/` both mean the same directory. */
export const normalizeBase = (base: string): string => path.normalize(base).replace(/^\.\//, '').replace(/\/+$/, '')

/** The id Astro's `glob()` loader derives from a file, and therefore what a `reference()` must hold. */
export const entryStem = (file: string): string => path.basename(file).replace(/\.(md|mdx|json|ya?ml)$/, '')

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

async function collectEntryFiles(fs: CmsFileSystem, collection: ParsedCollection, base: string): Promise<string[]> {
	const pattern = collection.loaderPattern ?? '**/*.{md,mdx,json,yaml,yml}'
	const files = await fs.glob(`${base}/${pattern}`)
	return files.filter(file => !path.basename(file).startsWith('_')).sort()
}

export function parseEntry(file: string, raw: string): { frontmatter: Record<string, unknown> } | { error: string } {
	const extension = path.extname(file)
	if (DATA_EXTENSIONS.has(extension)) {
		try {
			const parsed: unknown = extension === '.json' ? JSON.parse(raw) : yaml.parse(raw)
			// A data collection file may legitimately hold an array of entries; nothing to field-check then.
			return { frontmatter: isPlainObject(parsed) ? parsed : {} }
		} catch (error) {
			return { error: error instanceof Error ? error.message.split('\n')[0]! : String(error) }
		}
	}

	const trimmed = raw.trimStart()
	if (!trimmed.startsWith('---')) return { frontmatter: {} }
	const lines = trimmed.split('\n')
	const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---')
	if (end === -1) return { error: 'frontmatter is never closed (missing the second `---`)' }

	try {
		const parsed: unknown = yaml.parse(lines.slice(1, end).join('\n').trim())
		return { frontmatter: isPlainObject(parsed) ? parsed : {} }
	} catch (error) {
		return { error: error instanceof Error ? error.message.split('\n')[0]! : String(error) }
	}
}

/**
 * Whether a collection holds markdown entries or plain data files.
 *
 * Decides what a create writes, so it reads the entries on disk first and only falls back to
 * the loader pattern for a collection that has none yet.
 */
export function collectionKind(collection: LoadedCollection, loaderPattern: string | undefined): CollectionKind {
	const extensions = collection.entries.map(entry => path.extname(entry.file))
	if (extensions.length > 0) return extensions.some(extension => extension === '.md' || extension === '.mdx') ? 'markdown' : 'data'
	return loaderPattern === undefined || /\bmdx?\b/.test(loaderPattern) ? 'markdown' : 'data'
}

/** Every declared collection's files, read and parsed. Reports nothing — the callers judge. */
export async function loadCollections(fs: CmsFileSystem, config: ParsedConfig): Promise<LoadedCollections> {
	const loaded: LoadedCollections = new Map()

	for (const [name, collection] of config) {
		const base = normalizeBase(collection.loaderBase ?? `src/content/${name}`)

		if (!(await fs.exists(base))) {
			loaded.set(name, { name, base, exists: false, entries: [] })
			continue
		}

		const entries: LoadedEntry[] = []
		for (const file of await collectEntryFiles(fs, collection, base)) {
			const parsed = parseEntry(file, await fs.readFile(file))
			entries.push({
				file,
				stem: entryStem(file),
				...('error' in parsed ? { parseError: parsed.error } : { frontmatter: parsed.frontmatter }),
			})
		}

		loaded.set(name, { name, base, exists: true, entries })
	}

	return loaded
}
