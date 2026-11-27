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
import type { DeclaredCollection, ParsedConfig } from './content-config-ast.ts'
import type { CollectionKind } from './editor-write-model.ts'
import { UnreadableDirectoryError } from './fs/glob.ts'
import type { CmsFileSystem } from './fs/types.ts'

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
	/** Why the collection's files could not be listed, when they could not: its `entries` are then no account of it. */
	unreadable?: string
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

/** The entry files a collection's loader reads when its config names no pattern. */
export const DEFAULT_ENTRY_PATTERN = '**/*.{md,mdx,json,yaml,yml}'

async function collectEntryFiles(fs: CmsFileSystem, loaderPattern: string | undefined, base: string): Promise<string[]> {
	const files = await fs.glob(`${base}/${loaderPattern ?? DEFAULT_ENTRY_PATTERN}`)
	return files.filter(file => !path.basename(file).startsWith('_')).sort()
}

/**
 * Every directory a declared collection reads entries from: its `base`, the static folders its patterns start
 * with, the folder of a `file()`, `<contentDir>/<name>` without a loader. `null` when that cannot be told, for a
 * loader whose source is not a literal (a Starlight `docsLoader()`, a computed `base`) or a config not read whole:
 * a neighbour it might own is then no evidence of anything.
 */
export function ownedDirectories(declared: DeclaredCollection[], partial: boolean, contentDir: string): Set<string> | null {
	if (partial) return null
	const owned = new Set<string>()
	for (const collection of declared) {
		if (collection.noLoader) {
			owned.add(`${contentDir}/${collection.name}`)
		} else if (collection.loaderFile !== undefined) {
			owned.add(normalizeBase(path.posix.dirname(collection.loaderFile)))
		} else if (collection.loaderBase !== undefined) {
			const base = normalizeBase(collection.loaderBase)
			owned.add(base)
			const patterns = collection.loaderPatterns ?? (collection.loaderPattern === undefined ? [] : [collection.loaderPattern])
			for (const pattern of patterns) {
				const folder = staticFolder(pattern)
				if (folder !== '') owned.add(normalizeBase(path.posix.join(base, folder)))
			}
		} else {
			return null
		}
	}
	return owned
}

/** The folders a pattern names before its first wildcard: `src/content/blog` of `src/content/blog/*.md`. */
function staticFolder(pattern: string): string {
	if (pattern.startsWith('!')) return ''
	const segments = pattern.split('/').slice(0, -1)
	const wildcard = segments.findIndex(segment => /[*?{}[\]!]/.test(segment))
	return (wildcard === -1 ? segments : segments.slice(0, wildcard)).join('/')
}

/**
 * The entry files of a likely misspelling of a collection's missing base: a directory next to it whose name is
 * one or two edits from the base's (`peple` for `people`, `News` for `news`), that no declared collection owns,
 * holding files the collection's loader would read there and no collection loads. A dissimilar neighbour is no
 * evidence: it is content the check does not track (a Starlight `docs`, `i18n` strings, routes).
 */
export async function misspelledBaseEntries(
	fs: CmsFileSystem,
	loaderPattern: string | undefined,
	base: string,
	collections: LoadedCollections,
	ownsDirectory: (dir: string) => boolean,
): Promise<{ dir: string; files: string[] }[]> {
	const parent = path.posix.dirname(base)
	// The port cannot list outside the root, and a base there is not this project's to misspell.
	if (parent === '..' || parent.startsWith('../')) return []
	const name = path.posix.basename(base)
	const loaded = new Set([...collections.values()].flatMap(one => one.entries.map(entry => entry.file)))
	const strays: { dir: string; files: string[] }[] = []
	for (const child of await fs.list(parent)) {
		if (!child.isDirectory || !isLikelyMisspelling(child.name, name)) continue
		const dir = parent === '.' ? child.name : `${parent}/${child.name}`
		if (ownsDirectory(dir)) continue
		let files: string[]
		try {
			files = await collectEntryFiles(fs, loaderPattern, dir)
		} catch (error) {
			if (!(error instanceof UnreadableDirectoryError)) throw error
			// What an unreadable directory holds is unknown, so it is no evidence either way.
			continue
		}
		const unloaded = files.filter(file => !loaded.has(file))
		if (unloaded.length > 0) strays.push({ dir, files: unloaded })
	}
	return strays
}

/**
 * Case aside, one edit (or two swapped neighbouring letters) for a name of up to five characters, two edits for a
 * longer one; a name under three only by case.
 */
function isLikelyMisspelling(candidate: string, name: string): boolean {
	const a = candidate.toLowerCase()
	const b = name.toLowerCase()
	if (a === b) return candidate !== name
	const shorter = Math.min(a.length, b.length)
	if (shorter < 3) return false
	return isAdjacentSwap(a, b) || editDistance(a, b) <= (shorter > 5 ? 2 : 1)
}

/** `blgo` for `blog`: Levenshtein counts the swap as two edits. */
function isAdjacentSwap(a: string, b: string): boolean {
	const left = Array.from(a)
	const right = Array.from(b)
	if (left.length !== right.length) return false
	const [first, second, ...rest] = left.flatMap((char, index) => char === right[index] ? [] : [index])
	if (first === undefined || second === undefined || rest.length > 0 || second !== first + 1) return false
	return left[first] === right[second] && left[second] === right[first]
}

/** Levenshtein distance, by code point. */
function editDistance(a: string, b: string): number {
	const target = Array.from(b)
	let previous = Array.from({ length: target.length + 1 }, (_, index) => index)
	let distance = target.length
	for (const [i, char] of Array.from(a).entries()) {
		let diagonal = i
		let left = i + 1
		const current = [left]
		for (const [j, above] of previous.slice(1).entries()) {
			left = Math.min(above + 1, left + 1, diagonal + (char === target[j] ? 0 : 1))
			current.push(left)
			diagonal = above
		}
		previous = current
		distance = left
	}
	return distance
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

/**
 * Every declared collection's files, read and parsed. Reports nothing — the callers judge.
 * `contentDir` is where a collection without a loader base is, `<srcDir>/content`.
 */
export async function loadCollections(fs: CmsFileSystem, config: ParsedConfig, contentDir: string): Promise<LoadedCollections> {
	const loaded: LoadedCollections = new Map()

	for (const [name, collection] of config) {
		const base = normalizeBase(collection.loaderBase ?? `${contentDir}/${name}`)

		if (!(await fs.exists(base))) {
			loaded.set(name, { name, base, exists: false, entries: [] })
			continue
		}

		let files: string[]
		try {
			files = await collectEntryFiles(fs, collection.loaderPattern, base)
		} catch (error) {
			// Anything else (a path traversal, a bug) is not a fact about the content: let it surface.
			if (!(error instanceof UnreadableDirectoryError)) throw error
			// A directory under the base that cannot be read. Which entries it holds is unknown,
			// so the collection is handed on as unreadable instead of as whatever was listed so far.
			loaded.set(name, { name, base, exists: true, unreadable: error.message, entries: [] })
			continue
		}

		const entries: LoadedEntry[] = []
		for (const file of files) {
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
