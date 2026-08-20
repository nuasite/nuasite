import type { CollectionEntryInfo, ComponentDefinition, MutationResult } from '@nuasite/cms-types'
import yaml from 'yaml'
import { assetBaseDir, resolveAssetCandidates } from '../asset-paths'
import { scanCollections } from '../collection-scanner'
import { type ParseCache, parseContentConfig, type ParsedField } from '../content-config-ast'
import { blankRequiredFields, isBlankFieldValue, newRepeaterItem, type RepeaterItemField, withoutBlankArrayItems } from '../editor-write-model'
import type { CmsFileSystem } from '../fs/types'
import { mimeFromExt } from '../media/local'
import { computeDerivedFieldUpdates, isPlainRecord, relativeImportPath, slugify } from '../shared'

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
 * Resolve the root-relative base directory that holds a collection's source files.
 *
 * Honors a glob loader's `base` from the content config — e.g.
 * `glob({ base: './content/blog' })` points outside `contentDir`, and the
 * collection name (`o-virivkach`) need not match the directory. Falls back to the
 * default `<contentDir>/<collection>` layout for collections without a custom
 * loader base. This mirrors the scanner's `getCollectionSourceBasePath`, so the
 * mutation/read path resolves entries in the very same place the listing scan does.
 */
async function resolveCollectionDir(deps: EntryOpsDeps, collection: string): Promise<string> {
	const parsed = await parseContentConfig(deps.fs, deps.parseCache)
	const loaderBase = parsed.get(collection)?.loaderBase
	if (loaderBase) {
		// Loader base is root-relative; strip a leading `./` and any trailing slash.
		const normalized = loaderBase.replace(/^\.\/+/, '').replace(/[/\\]+$/, '')
		if (normalized) return normalized
	}
	return `${deps.contentDir}/${collection}`
}

/**
 * Resolve a `{collection, slug}` pair to an existing entry's source path.
 *
 * Tries the flat layout first (`<collection>/<slug>.<ext>`) for every supported
 * extension, then the index layout (`<collection>/<slug>/index.{md,mdx}`).
 * Returns `null` when no matching file exists.
 */
async function resolveEntryPath(deps: EntryOpsDeps, collection: string, slug: string): Promise<string | null> {
	const base = await resolveCollectionDir(deps, collection)
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

/** First existing candidate read as bytes + content type, or `null` when none exist. */
async function readAsset(deps: EntryOpsDeps, candidates: string[]): Promise<EntryAsset | null> {
	for (const candidate of candidates) {
		if (await deps.fs.exists(candidate)) {
			return { bytes: await deps.fs.readBytes(candidate), contentType: mimeFromExt(extOf(candidate)) }
		}
	}
	return null
}

/** Lowercased file extension including the leading dot (e.g. `.webp`), or `''`. */
function extOf(filePath: string): string {
	const idx = filePath.lastIndexOf('.')
	return idx >= 0 ? filePath.slice(idx).toLowerCase() : ''
}

/** Raw bytes of an entry-relative asset plus a best-effort content type. */
export interface EntryAsset {
	bytes: Uint8Array
	contentType: string
}

/**
 * Read an asset referenced by an entry (an `image`/`file` field value). A
 * root-relative value (`/assets/x.jpeg`) resolves against the project root/`public/`
 * and needs no entry; a relative value (`../../src/assets/x.webp`) resolves against
 * the entry's source directory. Returns the raw bytes plus a content type inferred
 * from the extension, or `null` when the entry or asset does not exist (or the path
 * escapes the project root).
 */
export async function getEntryAsset(deps: EntryOpsDeps, collection: string, slug: string, assetPath: string): Promise<EntryAsset | null> {
	// Root-relative values don't need the entry — resolve directly so they also
	// preview before the entry exists (and survive a missing/renamed source).
	if (assetPath.startsWith('/')) return readAsset(deps, resolveAssetCandidates(undefined, assetPath))
	const sourcePath = await resolveEntryPath(deps, collection, slug)
	if (!sourcePath) return null
	return readAsset(deps, resolveAssetCandidates(assetBaseDir(sourcePath), assetPath))
}

/**
 * Read a project asset by its runtime path (`/assets/x.jpeg`, `/uploads/x.webp`)
 * with no owning entry — for previewing a root-relative value while creating an
 * entry (no slug yet). Only leading-`/` paths resolve; relative paths need an entry.
 */
export async function getProjectAsset(deps: EntryOpsDeps, assetPath: string): Promise<EntryAsset | null> {
	return readAsset(deps, resolveAssetCandidates(undefined, assetPath))
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
	const collectionPath = await resolveCollectionDir(deps, collection)

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
// Derived-field recompute
// ============================================================================

/**
 * Recompute the collection's **declared** derived fields from `frontmatter`, returning the
 * frontmatter that should actually be written.
 *
 * This lives here — under every write path — on purpose. The recompute used to exist only in
 * the preview editor's form state (`computeDerivedUpdates` in `@nuasite/cms`), so anything
 * writing through the sidecar, the dash or an agent left derived fields holding whatever the
 * previous value was. The editor keeps its copy for instant in-form feedback; this one is
 * authoritative.
 *
 * Rules, all shared with `missingRequiredFields` and enforced by running *before* it:
 *
 * - The input is the **merged** frontmatter (what lands on disk), never the incoming patch —
 *   so an update touching only the source field still refreshes the derived one.
 * - A missing, non-string or blank source leaves the derived value untouched; see
 *   `computeDerivedFieldUpdates`.
 * - Only `derivedFrom` **declared in the content config** is recomputed. The scanner's
 *   `detectDerivedHrefFields` guess deliberately stays out of the write path: it is a
 *   heuristic over at most three sampled values, and letting it overwrite files would turn a
 *   coincidence into data loss. Declaring the field opts into the recompute.
 * - Only **top-level** fields derive. A `derivedFrom` on a nested field is dropped at parse
 *   time (with a warning) — see `content-config-ast.ts` — so nothing here has to guess what
 *   a source name would mean inside an object.
 * - `patch` is the incoming update, and its absence means "this is a create". On an update
 *   only the fields `shouldRecomputeOnUpdate` accepts are touched; on a create everything
 *   declared is computed, because the file does not exist yet and has no authored value to
 *   preserve.
 *
 * Reads the config the same way `missingRequiredFields` does (`parseContentConfig` +
 * `deps.parseCache`), so no new dependency enters `EntryOpsDeps`.
 */
async function applyDerivedFields(
	deps: EntryOpsDeps,
	collection: string,
	frontmatter: Record<string, unknown>,
	patch?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const parsed = await parseContentConfig(deps.fs, deps.parseCache)
	const parsedCollection = parsed.get(collection)
	if (!parsedCollection) return frontmatter

	const updates = computeDerivedFieldUpdates(
		parsedCollection.fields
			.filter(field => patch === undefined || shouldRecomputeOnUpdate(field, frontmatter, patch))
			.map(field => ({
				name: field.name,
				derivedFrom: field.layout?.derivedFrom,
				derivedTransform: field.layout?.derivedTransform,
			})),
		frontmatter,
	)
	if (Object.keys(updates).length === 0) return frontmatter
	return { ...frontmatter, ...updates }
}

/**
 * Whether an **update** should recompute this derived field, given the patch it carries and
 * the merged frontmatter that would land on disk.
 *
 * Two cases, and nothing else:
 *
 * 1. The patch carries the source field. The derivation is what the source means, so a write
 *    that moves the source moves the derived value with it — even when the patch never names
 *    it. (`updateEntry({ frontmatter: { category } })` refreshing `categoryHref` is the whole
 *    point of the feature.)
 * 2. The entry holds no derived value yet. Filling a hole is not an edit anybody has to
 *    notice, and it is what a create would have written.
 *
 * Everything else is left alone. An update that touches only the body, or only an unrelated
 * field, must not rewrite a value the author put there by hand: `categoryHref:
 * /kategorie/lide` overridden into `/lide` is a diff nobody asked for, produced by a save
 * that had nothing to do with it. `createEntry` skips this check entirely — a new file has no
 * hand-authored value to protect.
 */
function shouldRecomputeOnUpdate(field: ParsedField, frontmatter: Record<string, unknown>, patch: Record<string, unknown>): boolean {
	const source = field.layout?.derivedFrom
	if (source === undefined) return false
	if (Object.hasOwn(patch, source)) return true
	return isBlankFieldValue(frontmatter[field.name])
}

// ============================================================================
// Required-field validation
// ============================================================================

/**
 * Names of the collection's **schema-declared** required fields left empty by `frontmatter`.
 *
 * The predicate itself lives in `editor-write-model.ts`, shared with the content check —
 * see there for which fields the guard deliberately does not cover.
 *
 * Note on where `required` comes from — this reads the content config, never the
 * scanner, and that is the whole point. `scanCollections` *infers* `required` as
 * "the field is present in every scanned entry" (`mergeFieldObservations` in
 * `collection-scanner.ts`), so a collection holding a single entry marks everything
 * that entry happens to carry as required. Enforcing that as a hard invariant would
 * make such a collection impossible to extend — a second entry with a different set
 * of fields could never be written. Schema `required` has no such problem:
 * `applyParsedConfig` filters the scanned fields down to the schema's names and
 * `applyParsedFieldOverrides` then assigns `field.required = pf.required`
 * unconditionally, so `.optional()` → `false` and everything else → `true`.
 *
 * A collection absent from `content.config.ts` therefore yields `[]` — nobody declared
 * anything required there, so there is nothing to enforce and the write goes through.
 *
 * The rule itself lives in `blankRequiredFields` (`@nuasite/cms-types`), shared with every
 * collections UI — including which fields are exempt, and why.
 */
async function missingRequiredFields(deps: EntryOpsDeps, collection: string, frontmatter: Record<string, unknown>): Promise<string[]> {
	const parsed = await parseContentConfig(deps.fs, deps.parseCache)
	const parsedCollection = parsed.get(collection)
	if (!parsedCollection) return []

	return blankRequiredFields(parsedCollection.fields, frontmatter)
}

/** Name the offending fields — the text reaches the UI verbatim, where "validation failed" would be useless. */
function missingRequiredMessage(missing: string[]): string {
	return missing.length === 1
		? `Field "${missing[0]}" is required`
		: `Required fields are empty: ${missing.join(', ')}`
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
	const { collection, slug, body = '' } = input
	// Before anything reads it: a list may not carry a blank item. See `withoutBlankArrayItems`
	// — an unfilled row appended by "+ Add" arrives as `null` and fails the whole site build.
	const frontmatter = withoutBlankArrayItems(input.frontmatter)

	const normalizedSlug = slugify(slug)
	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug from the provided slug' }
	}

	const allowedExtensions = ['md', 'mdx', 'json', 'yaml', 'yml']
	const ext = input.fileExtension ?? 'md'
	if (!allowedExtensions.includes(ext)) {
		return { success: false, error: `Invalid file extension "${ext}". Allowed: ${allowedExtensions.join(', ')}` }
	}
	// Derived fields first: a required-but-visible derived field must be judged on the value
	// it is about to be given, not on the hole the caller left. `resolved` is what both
	// branches below serialize, so the markdown and the data file agree by construction.
	const resolved = await applyDerivedFields(deps, collection, frontmatter)

	// Hard invariant, ahead of every path that could touch the disk — the markdown and
	// the data branch below both write exactly `{ ...resolved }`, so one check covers
	// `.md`/`.mdx` frontmatter and `.json`/`.yaml`/`.yml` data files alike.
	const missing = await missingRequiredFields(deps, collection, resolved)
	if (missing.length > 0) {
		return { success: false, error: missingRequiredMessage(missing) }
	}

	const isData = ext === 'json' || ext === 'yaml' || ext === 'yml'
	const layout = isData ? 'flat' : await detectCollectionMarkdownLayout(deps, collection)
	const collectionDir = await resolveCollectionDir(deps, collection)
	const sourcePath = layout === 'index'
		? `${collectionDir}/${normalizedSlug}/index.${ext}`
		: `${collectionDir}/${normalizedSlug}.${ext}`

	let fileContent: string
	if (isData) {
		fileContent = ext === 'json'
			? JSON.stringify({ ...resolved }, null, 2) + '\n'
			: yaml.stringify({ ...resolved })
	} else {
		fileContent = serializeFrontmatter({ ...resolved }, body)
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

	// The incoming patch only — never the merged record. Cleaning what is already on disk would
	// rewrite lists this edit never touched, and a save must change what the editor changed.
	const patch = input.frontmatter === undefined ? undefined : withoutBlankArrayItems(input.frontmatter)

	try {
		if (isDataFile(sourcePath)) {
			const raw = await deps.fs.readFile(sourcePath)
			const existing = sourcePath.endsWith('.json') ? JSON.parse(raw) : yaml.parse(raw)
			const merged: Record<string, unknown> = { ...(existing ?? {}), ...patch }

			// Recompute from the merged result, so a patch that carries only the source field
			// still refreshes the derived one. Ahead of the required check for the same reason
			// as in `createEntry`. The patch goes along so a write that never touches a source
			// leaves the value the author put there alone — see `shouldRecomputeOnUpdate`.
			const resolved = await applyDerivedFields(deps, input.collection, merged, patch ?? {})

			// Validate the merged result, not the incoming patch: a patch that omits a
			// required field is fine when the file already carries it, and a patch that
			// blanks one must be rejected even though the field itself is present.
			const missing = await missingRequiredFields(deps, input.collection, resolved)
			if (missing.length > 0) {
				return { success: false, error: missingRequiredMessage(missing) }
			}

			const output = sourcePath.endsWith('.json')
				? JSON.stringify(resolved, null, 2) + '\n'
				: yaml.stringify(resolved)
			await deps.fs.writeFile(sourcePath, output)
		} else {
			const raw = await deps.fs.readFile(sourcePath)
			const existing = parseFrontmatter(raw)

			const mergedFrontmatter: Record<string, unknown> = {
				...existing.frontmatter,
				...patch,
			}

			// Same rule as the data branch: recompute the derived fields off the merged
			// frontmatter — bounded by the patch, so a body-only save rewrites nothing — then
			// validate what is actually going to disk.
			const resolvedFrontmatter = await applyDerivedFields(deps, input.collection, mergedFrontmatter, patch ?? {})

			const missing = await missingRequiredFields(deps, input.collection, resolvedFrontmatter)
			if (missing.length > 0) {
				return { success: false, error: missingRequiredMessage(missing) }
			}

			let finalContent = input.body ?? existing.content

			if (sourcePath.endsWith('.mdx')) {
				// Resolve component definitions internally (no manifest needed): scan the
				// component directories so MDX imports can be injected for used components.
				const componentDefinitions = await deps.resolveComponentDefinitions()
				finalContent = ensureMdxImports(finalContent, sourcePath, componentDefinitions)
			}

			await deps.fs.writeFile(sourcePath, serializeFrontmatter(resolvedFrontmatter, finalContent))
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

/**
 * The item fields a repeater declares in `content.config.ts`, or `[]` when it declares none.
 *
 * Only top-level repeaters are resolved, which is the only shape `addArrayItem` is called for.
 */
async function repeaterItemFields(deps: EntryOpsDeps, collection: string, field: string): Promise<RepeaterItemField[]> {
	const parsed = await parseContentConfig(deps.fs, deps.parseCache)
	const declared = parsed.get(collection)?.fields.find(candidate => candidate.name === field)
	if (!declared || declared.type !== 'array' || declared.itemType !== 'object') return []
	return (declared.fields ?? []).map(item => ({
		name: item.name,
		type: item.type,
		required: item.required,
		hidden: item.layout?.hidden,
	}))
}

/**
 * Seed the required keys a client left out of an appended item.
 *
 * The backstop for the "+ Add" hole. Both first-party editors now send a seeded item, but this
 * path is reachable by any client — an older editor, a script, the HTTP API directly — and an
 * item missing a required key is frontmatter the next build refuses. Whatever the client did
 * send wins: this only adds keys, never rewrites a value someone chose.
 */
function seedItem(value: unknown, fields: RepeaterItemField[]): unknown {
	if (fields.length === 0 || typeof value !== 'object' || value === null || Array.isArray(value)) return value
	const item: Record<string, unknown> = { ...value }
	for (const [key, seeded] of Object.entries(newRepeaterItem(fields))) {
		if (!Object.hasOwn(item, key) || item[key] === undefined) item[key] = seeded
	}
	return item
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

	// A field may be absent; an item in a list may not, so a blank one is frontmatter the next
	// build refuses. Refused rather than dropped: a client that asked for an append should not
	// be told it happened when nothing was written.
	if (isBlankFieldValue(input.value)) {
		return { success: false, error: `Refusing to append an empty item to "${input.field}" — fill it in, or leave the list alone` }
	}

	const index = input.index ?? array.length
	const clamped = Math.max(0, Math.min(index, array.length))
	array.splice(clamped, 0, seedItem(input.value, await repeaterItemFields(deps, input.collection, input.field)))
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
