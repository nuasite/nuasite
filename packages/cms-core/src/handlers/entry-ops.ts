import type { CollectionEntryInfo, ComponentDefinition, MutationResult } from '@nuasite/cms-types'
import yaml from 'yaml'
import { scanCollections } from '../collection-scanner'
import { type ParseCache, parseContentConfig } from '../content-config-ast'
import type { CmsFileSystem } from '../fs/types'
import { isPlainRecord, relativeImportPath, slugify } from '../shared'

/** Frontmatter file extensions that hold markdown content (vs. pure data files). */
const MARKDOWN_EXTENSIONS = ['md', 'mdx'] as const

export interface GetEntryResult {
	/** Markdown body (empty string for data collections). */
	content: string
	/** Parsed frontmatter / data object. */
	frontmatter: Record<string, unknown>
	/** Source file path, root-relative. */
	sourcePath: string
}

export interface EntryOpsDeps {
	fs: CmsFileSystem
	contentDir: string
	parseCache: ParseCache
	/** Directories to scan for Astro components when resolving MDX imports. */
	componentDirs: string[]
	/** Resolve component definitions internally (MDX import injection). */
	resolveComponentDefinitions: () => Promise<Record<string, ComponentDefinition>>
}

// ============================================================================
// Path / slug resolution
// ============================================================================

function fileExtension(filePath: string): string {
	const idx = filePath.lastIndexOf('.')
	return idx >= 0 ? filePath.slice(idx + 1).toLowerCase() : ''
}

function isDataFile(filePath: string): boolean {
	const ext = fileExtension(filePath)
	return ext === 'json' || ext === 'yaml' || ext === 'yml'
}

/**
 * Resolve a `{collection, slug}` pair to an existing entry's source path.
 *
 * Tries the flat layout first (`<collection>/<slug>.<ext>`) for every supported
 * extension, then the index layout (`<collection>/<slug>/index.{md,mdx}`).
 * Returns `null` when no matching file exists.
 */
async function resolveEntryPath(deps: EntryOpsDeps, collection: string, slug: string): Promise<string | null> {
	const base = `${deps.contentDir}/${collection}`
	const flatExts = ['md', 'mdx', 'json', 'yaml', 'yml']
	for (const ext of flatExts) {
		const candidate = `${base}/${slug}.${ext}`
		if (await deps.fs.exists(candidate)) return candidate
	}
	for (const ext of MARKDOWN_EXTENSIONS) {
		const candidate = `${base}/${slug}/index.${ext}`
		if (await deps.fs.exists(candidate)) return candidate
	}
	return null
}

// ============================================================================
// Frontmatter parse / serialize (ported from @nuasite/cms markdown-ops)
// ============================================================================

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
	const trimmed = raw.trimStart()
	if (!trimmed.startsWith('---')) {
		return { frontmatter: {}, content: raw }
	}

	const lines = trimmed.split('\n')
	let endLineIndex = -1
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]!.trimEnd() === '---') {
			endLineIndex = i
			break
		}
	}
	if (endLineIndex === -1) {
		return { frontmatter: {}, content: raw }
	}

	const yamlStr = lines.slice(1, endLineIndex).join('\n').trim()
	const content = lines.slice(endLineIndex + 1).join('\n').replace(/^\r?\n/, '')

	let frontmatter: Record<string, unknown> = {}
	try {
		const parsed: unknown = yaml.parse(yamlStr)
		if (isPlainRecord(parsed)) {
			frontmatter = parsed
		}
	} catch {
		// Invalid YAML, return empty frontmatter
	}

	return { frontmatter, content }
}

/** Pattern for strings that YAML auto-parses as Date objects */
const YAML_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/

export function serializeFrontmatter(frontmatter: Record<string, unknown>, content: string): string {
	const doc = new yaml.Document(frontmatter)
	yaml.visit(doc, {
		Scalar(_key, node) {
			if (typeof node.value === 'string' && YAML_DATE_PATTERN.test(node.value)) {
				node.type = yaml.Scalar.QUOTE_SINGLE
			}
		},
	})
	const yamlStr = doc.toString().trim()
	return `---\n${yamlStr}\n---\n${content}`
}

/**
 * Ensure MDX content has import statements for all components used in the body.
 * Scans for `<ComponentName` tags, checks for existing imports, and prepends missing ones.
 *
 * `filePath` and the component `def.file` are both root-relative, forward-slash paths.
 */
export function ensureMdxImports(
	content: string,
	filePath: string,
	componentDefinitions: Record<string, ComponentDefinition>,
): string {
	const usedComponents = new Set<string>()
	const tagRegex = /<([A-Z][A-Za-z0-9]*)\b/g
	let match
	while ((match = tagRegex.exec(content)) !== null) {
		if (match[1]) usedComponents.add(match[1])
	}
	if (usedComponents.size === 0) return content

	const importedNames = new Set<string>()
	const importLineRegex = /^import\s+(.+)\s+from\s+/gm
	let lastImportEnd = -1
	while ((match = importLineRegex.exec(content)) !== null) {
		lastImportEnd = match.index + match[0].length
		const fromRest = content.slice(lastImportEnd)
		const lineEnd = fromRest.indexOf('\n')
		if (lineEnd >= 0) lastImportEnd += lineEnd
		else lastImportEnd = content.length

		const clause = match[1]!
		const braceMatch = clause.match(/\{([^}]+)\}/)
		if (braceMatch?.[1]) {
			for (const name of braceMatch[1].split(',')) {
				const parts = name.trim().split(/\s+as\s+/)
				const imported = (parts[1] ?? parts[0])?.trim()
				if (imported) importedNames.add(imported)
			}
		}
		const withoutBraces = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
		for (const token of withoutBraces.split(/\s+/)) {
			if (token === '*' || token === 'as' || token === '') continue
			importedNames.add(token)
		}
	}

	const missingImports: string[] = []

	for (const name of usedComponents) {
		if (importedNames.has(name)) continue
		const def = componentDefinitions[name]
		if (!def) continue

		const rel = relativeImportPath(filePath, def.file)
		missingImports.push(`import ${name} from '${rel}'`)
	}

	if (missingImports.length === 0) return content

	const importBlock = missingImports.join('\n')

	if (lastImportEnd >= 0) {
		return content.slice(0, lastImportEnd) + '\n' + importBlock + content.slice(lastImportEnd)
	}

	return importBlock + '\n\n' + content
}

// ============================================================================
// Collection markdown layout detection (ported from markdown-ops)
// ============================================================================

type MarkdownCollectionLayout = 'flat' | 'index'

async function detectCollectionMarkdownLayout(deps: EntryOpsDeps, collection: string): Promise<MarkdownCollectionLayout> {
	const existingLayout = await inferLayoutFromExistingEntries(deps, collection)
	if (existingLayout) return existingLayout

	const configLayout = await inferLayoutFromContentConfig(deps, collection)
	if (configLayout) return configLayout

	return 'flat'
}

async function inferLayoutFromExistingEntries(deps: EntryOpsDeps, collection: string): Promise<MarkdownCollectionLayout | null> {
	const collectionPath = `${deps.contentDir}/${collection}`

	const dirEntries = await deps.fs.list(collectionPath)
	if (dirEntries.length === 0) return null

	let flatCount = 0
	const flatSlugs = new Set<string>()

	for (const entry of dirEntries) {
		if (entry.isDirectory) continue
		const match = entry.name.match(/^(.+)\.(md|mdx)$/)
		if (!match) continue
		flatCount++
		flatSlugs.add(match[1]!)
	}

	const subdirs = dirEntries.filter(entry => entry.isDirectory && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
	const indexLookups = await Promise.all(subdirs.map(async dir => {
		if (flatSlugs.has(dir.name)) return false
		for (const ext of MARKDOWN_EXTENSIONS) {
			if (await deps.fs.exists(`${collectionPath}/${dir.name}/index.${ext}`)) return true
		}
		return false
	}))
	const indexCount = indexLookups.filter(Boolean).length

	if (indexCount > flatCount) return 'index'
	if (flatCount > 0) return 'flat'
	return null
}

async function inferLayoutFromContentConfig(deps: EntryOpsDeps, collection: string): Promise<MarkdownCollectionLayout | null> {
	const parsed = await parseContentConfig(deps.fs, deps.parseCache)
	const pattern = parsed.get(collection)?.loaderPattern
	if (!pattern) return null
	return isIndexStyleGlobPattern(pattern) ? 'index' : 'flat'
}

function isIndexStyleGlobPattern(pattern: string): boolean {
	return pattern.includes('index.{') || pattern.includes('*/index') || pattern.includes('**/index')
}

// ============================================================================
// Entry CRUD
// ============================================================================

export interface CreateEntryInput {
	collection: string
	slug: string
	frontmatter: Record<string, unknown>
	body?: string
	/** File extension override for data collections (e.g. 'json', 'yaml'). Defaults to 'md'. */
	fileExtension?: string
}

export interface UpdateEntryInput {
	collection: string
	slug: string
	frontmatter?: Record<string, unknown>
	body?: string
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export async function getEntry(deps: EntryOpsDeps, collection: string, slug: string): Promise<GetEntryResult | null> {
	const sourcePath = await resolveEntryPath(deps, collection, slug)
	if (!sourcePath) return null

	const raw = await deps.fs.readFile(sourcePath)

	if (isDataFile(sourcePath)) {
		const data = sourcePath.endsWith('.json') ? JSON.parse(raw) : yaml.parse(raw)
		return {
			content: '',
			frontmatter: (data && typeof data === 'object') ? data : {},
			sourcePath,
		}
	}

	const { frontmatter, content } = parseFrontmatter(raw)
	return { content, frontmatter, sourcePath }
}

export async function createEntry(deps: EntryOpsDeps, input: CreateEntryInput): Promise<MutationResult> {
	const { collection, slug, frontmatter, body = '' } = input

	const normalizedSlug = slugify(slug)
	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug from the provided slug' }
	}

	const allowedExtensions = ['md', 'mdx', 'json', 'yaml', 'yml']
	const ext = input.fileExtension ?? 'md'
	if (!allowedExtensions.includes(ext)) {
		return { success: false, error: `Invalid file extension "${ext}". Allowed: ${allowedExtensions.join(', ')}` }
	}
	const isData = ext === 'json' || ext === 'yaml' || ext === 'yml'
	const layout = isData ? 'flat' : await detectCollectionMarkdownLayout(deps, collection)
	const sourcePath = layout === 'index'
		? `${deps.contentDir}/${collection}/${normalizedSlug}/index.${ext}`
		: `${deps.contentDir}/${collection}/${normalizedSlug}.${ext}`

	let fileContent: string
	if (isData) {
		fileContent = ext === 'json'
			? JSON.stringify({ ...frontmatter }, null, 2) + '\n'
			: yaml.stringify({ ...frontmatter })
	} else {
		fileContent = serializeFrontmatter({ ...frontmatter }, body)
	}

	if (await deps.fs.exists(sourcePath)) {
		return { success: false, error: `File already exists: ${sourcePath}` }
	}

	try {
		await deps.fs.writeFile(sourcePath, fileContent)
		return { success: true, sourcePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function updateEntry(deps: EntryOpsDeps, input: UpdateEntryInput): Promise<MutationResult> {
	const sourcePath = await resolveEntryPath(deps, input.collection, input.slug)
	if (!sourcePath) {
		return { success: false, error: `Entry not found: ${input.collection}/${input.slug}` }
	}

	try {
		if (isDataFile(sourcePath)) {
			const raw = await deps.fs.readFile(sourcePath)
			const existing = sourcePath.endsWith('.json') ? JSON.parse(raw) : yaml.parse(raw)
			const merged = { ...(existing ?? {}), ...input.frontmatter }

			const output = sourcePath.endsWith('.json')
				? JSON.stringify(merged, null, 2) + '\n'
				: yaml.stringify(merged)
			await deps.fs.writeFile(sourcePath, output)
		} else {
			const raw = await deps.fs.readFile(sourcePath)
			const existing = parseFrontmatter(raw)

			const mergedFrontmatter: Record<string, unknown> = {
				...existing.frontmatter,
				...input.frontmatter,
			}

			let finalContent = input.body ?? existing.content

			if (sourcePath.endsWith('.mdx')) {
				// Resolve component definitions internally (no manifest needed): scan the
				// component directories so MDX imports can be injected for used components.
				const componentDefinitions = await deps.resolveComponentDefinitions()
				finalContent = ensureMdxImports(finalContent, sourcePath, componentDefinitions)
			}

			await deps.fs.writeFile(sourcePath, serializeFrontmatter(mergedFrontmatter, finalContent))
		}

		return { success: true, sourcePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function deleteEntry(deps: EntryOpsDeps, collection: string, slug: string): Promise<MutationResult> {
	const sourcePath = await resolveEntryPath(deps, collection, slug)
	if (!sourcePath) {
		return { success: false, error: `Entry not found: ${collection}/${slug}` }
	}

	try {
		await deps.fs.remove(sourcePath)
		return { success: true, sourcePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function renameEntry(deps: EntryOpsDeps, collection: string, from: string, to: string): Promise<MutationResult> {
	const sourcePath = await resolveEntryPath(deps, collection, from)
	if (!sourcePath) {
		return { success: false, error: `Entry not found: ${collection}/${from}` }
	}

	const normalizedSlug = slugify(to)
	if (!normalizedSlug) {
		return { success: false, error: 'Invalid slug' }
	}

	const lastSlash = sourcePath.lastIndexOf('/')
	const dir = lastSlash >= 0 ? sourcePath.slice(0, lastSlash) : ''
	const fileName = lastSlash >= 0 ? sourcePath.slice(lastSlash + 1) : sourcePath
	const ext = fileExtension(fileName)
	const newSourcePath = dir ? `${dir}/${normalizedSlug}.${ext}` : `${normalizedSlug}.${ext}`

	if (sourcePath === newSourcePath) {
		return { success: true, sourcePath: newSourcePath }
	}

	if (await deps.fs.exists(newSourcePath)) {
		return { success: false, error: `File already exists: ${normalizedSlug}.${ext}` }
	}

	try {
		await deps.fs.rename(sourcePath, newSourcePath)
		return { success: true, sourcePath: newSourcePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

// ============================================================================
// Entry-frontmatter array ops
// ============================================================================

export interface AddArrayItemInput {
	collection: string
	slug: string
	field: string
	value: unknown
	index?: number
}

export interface RemoveArrayItemInput {
	collection: string
	slug: string
	field: string
	index: number
}

/**
 * Read the entry's frontmatter/data object as a plain object, plus the markdown
 * body (empty for data files). Returns the resolved source path so callers can
 * write back through the same representation.
 */
async function loadEntryFrontmatter(
	deps: EntryOpsDeps,
	collection: string,
	slug: string,
): Promise<{ sourcePath: string; frontmatter: Record<string, unknown>; body: string; data: boolean } | null> {
	const sourcePath = await resolveEntryPath(deps, collection, slug)
	if (!sourcePath) return null

	const raw = await deps.fs.readFile(sourcePath)
	if (isDataFile(sourcePath)) {
		const parsed = sourcePath.endsWith('.json') ? JSON.parse(raw) : yaml.parse(raw)
		return { sourcePath, frontmatter: (parsed && typeof parsed === 'object') ? parsed : {}, body: '', data: true }
	}
	const { frontmatter, content } = parseFrontmatter(raw)
	return { sourcePath, frontmatter, body: content, data: false }
}

async function writeEntryFrontmatter(
	deps: EntryOpsDeps,
	loaded: { sourcePath: string; frontmatter: Record<string, unknown>; body: string; data: boolean },
): Promise<void> {
	if (loaded.data) {
		const output = loaded.sourcePath.endsWith('.json')
			? JSON.stringify(loaded.frontmatter, null, 2) + '\n'
			: yaml.stringify(loaded.frontmatter)
		await deps.fs.writeFile(loaded.sourcePath, output)
		return
	}
	await deps.fs.writeFile(loaded.sourcePath, serializeFrontmatter(loaded.frontmatter, loaded.body))
}

export async function addArrayItem(deps: EntryOpsDeps, input: AddArrayItemInput): Promise<MutationResult> {
	const loaded = await loadEntryFrontmatter(deps, input.collection, input.slug)
	if (!loaded) {
		return { success: false, error: `Entry not found: ${input.collection}/${input.slug}` }
	}

	const current = loaded.frontmatter[input.field]
	const array = Array.isArray(current) ? current.slice() : current === undefined ? [] : null
	if (array === null) {
		return { success: false, error: `Field "${input.field}" is not an array` }
	}

	const index = input.index ?? array.length
	const clamped = Math.max(0, Math.min(index, array.length))
	array.splice(clamped, 0, input.value)
	loaded.frontmatter[input.field] = array

	try {
		await writeEntryFrontmatter(deps, loaded)
		return { success: true, sourcePath: loaded.sourcePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function removeArrayItem(deps: EntryOpsDeps, input: RemoveArrayItemInput): Promise<MutationResult> {
	const loaded = await loadEntryFrontmatter(deps, input.collection, input.slug)
	if (!loaded) {
		return { success: false, error: `Entry not found: ${input.collection}/${input.slug}` }
	}

	const current = loaded.frontmatter[input.field]
	if (!Array.isArray(current)) {
		return { success: false, error: `Field "${input.field}" is not an array` }
	}
	if (input.index < 0 || input.index >= current.length) {
		return { success: false, error: `Index out of bounds: ${input.index}` }
	}

	const array = current.slice()
	array.splice(input.index, 1)
	loaded.frontmatter[input.field] = array

	try {
		await writeEntryFrontmatter(deps, loaded)
		return { success: true, sourcePath: loaded.sourcePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

/** Re-export for tests / parity consumers needing the collection's entry list. */
export async function listCollectionEntries(deps: EntryOpsDeps, collection: string): Promise<CollectionEntryInfo[]> {
	const collections = await scanCollections(deps.fs, deps.contentDir, deps.parseCache)
	return collections[collection]?.entries ?? []
}
