import type {
	CollectionDefinition,
	CollectionEntryInfo,
	CollectionScanReport,
	FieldDefinition,
	FieldType,
	UnresolvedCollection,
} from '@nuasite/cms-types'
import path from 'node:path'
import { isMap, isPair, isScalar, parse as parseYaml, parseDocument } from 'yaml'
import {
	classifyEmptyContentConfig,
	configOptionMentions,
	CONTENT_CONFIG_PATHS,
	type ContentConfigRead,
	type DeclaredCollection,
	type ParseCache,
	type ParsedConfig,
	type ParsedField,
	readContentConfig,
	UNREAD_CONTENT_CONFIG_PATHS,
} from './content-config-ast'
import type { CmsFileSystem, GlobOptions } from './fs/types'
import { resolvePathnameFromSpec, slugifyHref } from './shared'

/** Regex patterns for type inference */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/
const URL_PATTERN = /^(https?:\/\/|\/)/
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i

/** Maximum unique values before treating as free-form text instead of select */
const MAX_SELECT_OPTIONS = 10

/** Minimum length for textarea detection */
const TEXTAREA_MIN_LENGTH = 200

/** Field names that default to sidebar position */
const SIDEBAR_FIELD_NAMES = new Set([
	'title',
	'date',
	'pubdate',
	'publishdate',
	'draft',
	'image',
	'featuredimage',
	'cover',
	'coverimage',
	'thumbnail',
	'author',
])

/** Matches `@position <value>` or `@group <value>` in YAML comment text (# already stripped by parser) */
const DIRECTIVE_PATTERN = /^\s*@(position|group)\s+(.+)$/

/** Field names that should never be inferred as select (always free-text) */
const FREE_TEXT_FIELD_NAMES = new Set([
	'title',
	'name',
	'description',
	'summary',
	'excerpt',
	'subtitle',
	'heading',
	'headline',
	'slug',
	'alt',
	'caption',
])

/** Normalized names (lowercased, underscores/hyphens stripped) that mark a field as the publish toggle. */
const PUBLISH_TOGGLE_NAMES = new Set(['draft', 'isdraft', 'published', 'ispublished', 'unpublished'])

/** Normalized names that mark a field as the publish/release date anchor. */
const PUBLISH_DATE_NAMES = new Set([
	'date',
	'pubdate',
	'publishdate',
	'publisheddate',
	'publishedate',
	'publishedat',
	'datepublished',
])

/** Normalize a field name for case- and separator-insensitive matching against the *_NAMES sets above. */
function normalizeFieldName(name: string): string {
	return name.toLowerCase().replace(/[_-]/g, '')
}

/** Fallback order for an entry's browse title when the collection declares no `titleField`. */
const TITLE_FALLBACK_FIELDS = ['title', 'name', 'label'] as const

/**
 * Derive the title an entry is listed under in the CMS browser and reference pickers.
 *
 * A declared `titleField` (`defineCmsCollection({ cms: { titleField } })`) wins outright —
 * including over a present `title` — so a collection can name its own headline field.
 * Otherwise the first non-empty string among `title` → `name` → `label` is used, and the
 * caller falls back to the slug when nothing matches.
 *
 * Both the markdown branch (frontmatter) and the data branch (JSON/YAML) go through here,
 * so the two can't drift apart again the way they had.
 */
function deriveEntryTitle(data: Record<string, unknown>, titleField?: string): string | undefined {
	if (titleField) {
		const declared = data[titleField]
		return typeof declared === 'string' && declared !== '' ? declared : undefined
	}
	for (const key of TITLE_FALLBACK_FIELDS) {
		const value = data[key]
		if (typeof value === 'string' && value !== '') return value
	}
	return undefined
}

/**
 * Observed values for a single field across multiple files
 */
interface FieldObservation {
	name: string
	values: unknown[]
	presentCount: number
	totalEntries: number
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/

function extractFrontmatterBlock(content: string): string | null {
	const match = content.match(FRONTMATTER_PATTERN)
	return match?.[1] ?? null
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
	const block = extractFrontmatterBlock(content)
	if (!block) return null
	return parseYaml(block) as Record<string, unknown> | null
}

/**
 * Parse @position and @group comment directives from raw YAML frontmatter.
 * Uses the YAML AST which preserves comments via `commentBefore` on nodes.
 */
function parseFieldDirectives(content: string): Record<string, { position?: 'sidebar' | 'header'; group?: string }> {
	const block = extractFrontmatterBlock(content)
	if (!block) return {}

	const doc = parseDocument(block)
	if (!isMap(doc.contents)) return {}

	const result: Record<string, { position?: 'sidebar' | 'header'; group?: string }> = {}

	for (const pair of doc.contents.items) {
		if (!isPair(pair) || !isScalar(pair.key)) continue
		const comment = pair.key.commentBefore
		if (!comment) continue

		const directives: { position?: 'sidebar' | 'header'; group?: string } = {}
		for (const line of comment.split('\n')) {
			const match = line.trim().match(DIRECTIVE_PATTERN)
			if (!match) continue
			const [, dirKey, dirValue] = match
			if (dirKey === 'position' && (dirValue === 'sidebar' || dirValue === 'header')) {
				directives.position = dirValue
			} else if (dirKey === 'group' && dirValue) {
				directives.group = dirValue.trim()
			}
		}

		if (directives.position || directives.group) {
			result[String(pair.key.value)] = directives
		}
	}

	return result
}

/**
 * Assign default positions to fields based on field name heuristics,
 * then overlay frontmatter comment directives.
 *
 * Only the sidebar default is written. A field the heuristic does not recognise is left with no
 * `position` at all, which is what "the editor decides" looks like on the wire — it used to be
 * stamped `'header'`, and that broke the one consumer that read it: an editor rendering
 * `position === 'header'` as a top strip put *every* unrecognised field in the strip and left the
 * main column empty, which in turn meant a collection's declared `cms.sections` had no fields to
 * order and never rendered. `'header'` now only ever comes from a `@position` directive or
 * `n.text({ position: 'header' })`, so an editor can trust it as an author's choice.
 *
 * The default written here deliberately leaves `positionDeclared` unset, and the directive
 * overlay deliberately sets it: on the wire the two produce the same `'sidebar'`, and a consumer
 * that cannot tell a guess from an instruction ends up overriding the instruction.
 */
function assignFieldMetadata(
	fields: FieldDefinition[],
	directives: Record<string, { position?: 'sidebar' | 'header'; group?: string }>,
): void {
	for (const field of fields) {
		// Scanner defaults: well-known fields go to sidebar
		if (SIDEBAR_FIELD_NAMES.has(normalizeFieldName(field.name)) || field.type === 'image' || field.type === 'boolean') {
			field.position = 'sidebar'
		}

		// Overlay frontmatter comment directives
		const directive = directives[field.name]
		if (directive) {
			if (directive.position) {
				field.position = directive.position
				field.positionDeclared = true
			}
			if (directive.group) field.group = directive.group
		}
	}
}

/**
 * Infer the field type from a value
 */
function inferFieldType(value: unknown, key: string): FieldType {
	if (value === null || value === undefined) {
		return 'text'
	}

	if (typeof value === 'boolean') {
		return 'boolean'
	}

	if (typeof value === 'number') {
		return 'number'
	}

	if (Array.isArray(value)) {
		return 'array'
	}

	if (typeof value === 'object') {
		return 'object'
	}

	if (typeof value === 'string') {
		// Check for date pattern
		if (DATE_PATTERN.test(value)) {
			return 'date'
		}

		// Check for image paths
		if (IMAGE_EXTENSIONS.test(value)) {
			return 'image'
		}

		// Check for image-specific field names (exact word boundaries, not substrings)
		const lowerKey = key.toLowerCase()
		if (/(?:^|[_-])(?:image|thumbnail|cover|avatar|logo|icon|banner|photo)(?:$|[_-])/.test(lowerKey)) {
			return 'image'
		}

		// Check for URLs
		if (URL_PATTERN.test(value)) {
			return 'url'
		}

		// Check for textarea (long text or contains newlines)
		if (value.includes('\n') || value.length > TEXTAREA_MIN_LENGTH) {
			return 'textarea'
		}

		return 'text'
	}

	return 'text'
}

/**
 * Merge field observations from multiple files to determine final field definition.
 * `depth` guards against pathological deeply-nested content blowing the stack —
 * real-world YAML/JSON rarely exceeds 5 levels, so the cap is well above realistic use.
 */
const MAX_NESTED_FIELD_DEPTH = 16

function mergeFieldObservations(observations: FieldObservation[], depth: number = 0): FieldDefinition[] {
	if (depth >= MAX_NESTED_FIELD_DEPTH) return []
	const fields: FieldDefinition[] = []

	for (const obs of observations) {
		const nonNullValues = obs.values.filter(v => v !== null && v !== undefined)
		if (nonNullValues.length === 0) continue

		// Determine type by consensus (most common inferred type)
		const typeCounts = new Map<FieldType, number>()
		for (const value of nonNullValues) {
			const type = inferFieldType(value, obs.name)
			typeCounts.set(type, (typeCounts.get(type) || 0) + 1)
		}

		// Get most common type
		let fieldType: FieldType = 'text'
		let maxCount = 0
		for (const [type, count] of typeCounts) {
			if (count > maxCount) {
				maxCount = count
				fieldType = type
			}
		}

		const field: FieldDefinition = {
			name: obs.name,
			type: fieldType,
			required: obs.presentCount === obs.totalEntries,
			examples: nonNullValues.slice(0, 3),
		}

		// For text fields, check if we should treat as select (limited unique values)
		if (fieldType === 'text' && !FREE_TEXT_FIELD_NAMES.has(normalizeFieldName(obs.name))) {
			const uniqueValues = [...new Set(nonNullValues.map(v => String(v)))]
			const uniqueRatio = uniqueValues.length / nonNullValues.length
			// Only treat as select if unique values are limited AND not nearly all unique
			// (a high unique ratio means entries have distinct values, indicating free-text)
			if (uniqueValues.length > 0 && uniqueValues.length <= MAX_SELECT_OPTIONS && nonNullValues.length >= 2 && uniqueRatio <= 0.8) {
				field.type = 'select'
				field.options = uniqueValues.sort()
			}
		}

		// For arrays, try to infer item type
		if (fieldType === 'array') {
			const allItems = nonNullValues.flatMap(v => (Array.isArray(v) ? v : []))
			if (allItems.length > 0) {
				const itemType = inferFieldType(allItems[0], obs.name)
				field.itemType = itemType

				// Check if array items should be select
				if (itemType === 'text') {
					const uniqueItems = [...new Set(allItems.map(v => String(v)))]
					if (uniqueItems.length <= MAX_SELECT_OPTIONS * 2) {
						field.options = uniqueItems.sort()
					}
				}

				// Infer sub-field definitions for array-of-objects
				if (itemType === 'object') {
					const objectItems = allItems.filter(
						(v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v),
					)
					if (objectItems.length > 0) {
						const subFieldMap = new Map<string, FieldObservation>()
						for (const item of objectItems) {
							collectFieldObservations(subFieldMap, item, objectItems.length)
						}
						field.fields = mergeFieldObservations(Array.from(subFieldMap.values()), depth + 1)
					}
				}
			}
		}

		// For plain object values, recurse into sub-fields so the editor can render them.
		if (fieldType === 'object') {
			const objectValues = nonNullValues.filter(
				(v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v),
			)
			if (objectValues.length > 0) {
				const subFieldMap = new Map<string, FieldObservation>()
				for (const item of objectValues) {
					collectFieldObservations(subFieldMap, item, objectValues.length)
				}
				field.fields = mergeFieldObservations(Array.from(subFieldMap.values()), depth + 1)
			}
		}

		fields.push(field)
	}

	return fields
}

function collectFieldObservations(
	fieldMap: Map<string, FieldObservation>,
	data: Record<string, unknown>,
	totalEntries: number,
): void {
	for (const [key, value] of Object.entries(data)) {
		let obs = fieldMap.get(key)
		if (!obs) {
			obs = { name: key, values: [], presentCount: 0, totalEntries }
			fieldMap.set(key, obs)
		}
		obs.values.push(value)
		obs.presentCount++
	}
}

function assembleCollectionDefinition(
	collectionName: string,
	contentDir: string,
	fieldMap: Map<string, FieldObservation>,
	entryInfos: CollectionEntryInfo[],
	entryCount: number,
	extra: Partial<CollectionDefinition>,
): CollectionDefinition {
	for (const obs of fieldMap.values()) {
		obs.totalEntries = entryCount
	}

	entryInfos.sort((a, b) => (a.title ?? a.slug).localeCompare(b.title ?? b.slug))

	const fields = mergeFieldObservations(Array.from(fieldMap.values()))
	const label = collectionName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

	return {
		name: collectionName,
		label,
		path: path.join(contentDir, collectionName),
		entryCount,
		fields,
		fileExtension: 'md',
		entries: entryInfos,
		...extra,
	}
}

/**
 * Compute the root-relative base path of a collection's source directory.
 * `basePath` is root-relative (e.g. `src/content/blog` for the default layout,
 * or a glob loader base as the config spells it, like `./src/content/jsem/`).
 * When it matches the default `<contentDir>/<name>` location, the canonical
 * default path is returned; otherwise the base path is returned normalized,
 * without the leading `./` and trailing slash, so it is a prefix of each entry's
 * `sourcePath`, except when the base is the project root, which is reported as `.`.
 */
function getCollectionSourceBasePath(basePath: string, collectionName: string, contentDir: string): string {
	const defaultCollectionPath = path.join(contentDir, collectionName)
	const normalizedBasePath = normalizeBasePath(basePath)
	if (normalizedBasePath === path.normalize(defaultCollectionPath)) {
		return path.join(contentDir, collectionName)
	}
	return normalizedBasePath
}

async function buildCollectionDefinition(
	fs: CmsFileSystem,
	basePath: string,
	sources: Array<{ slug: string; relPath: string }>,
	collectionName: string,
	contentDir: string,
): Promise<CollectionDefinition | null> {
	if (sources.length === 0) return null

	const sourceBasePath = getCollectionSourceBasePath(basePath, collectionName, contentDir)
	const hasMd = sources.some(s => s.relPath.endsWith('.md'))
	const fileExtension: 'md' | 'mdx' = hasMd ? 'md' : 'mdx'

	const fieldMap = new Map<string, FieldObservation>()
	const allDirectives: Record<string, { position?: 'sidebar' | 'header'; group?: string }> = {}
	const entryInfos: CollectionEntryInfo[] = []
	let hasDraft = false

	// Read tolerantly: a file removed/renamed between the directory listing and the
	// read (routine during dev on save/checkout) must skip that one entry, not reject
	// the whole Promise.all and abort the scan.
	const fileContents = await Promise.all(
		sources.map(s => fs.readFile(path.join(basePath, s.relPath)).catch(() => null)),
	)

	for (let i = 0; i < sources.length; i++) {
		const source = sources[i]!
		const content = fileContents[i]!
		if (content === null) continue
		const frontmatter = parseFrontmatter(content)

		const directives = parseFieldDirectives(content)
		for (const [key, value] of Object.entries(directives)) {
			if (!allDirectives[key]) {
				allDirectives[key] = value
			}
		}

		const entryInfo: CollectionEntryInfo = {
			slug: source.slug,
			sourcePath: path.join(sourceBasePath, source.relPath),
		}
		if (frontmatter) {
			// No `titleField` here: the content config isn't parsed yet at scan time,
			// so a declared field is applied later in `applyParsedConfig`.
			const title = deriveEntryTitle(frontmatter)
			if (title !== undefined) {
				entryInfo.title = title
			}
			if (typeof frontmatter.draft === 'boolean' && frontmatter.draft) {
				entryInfo.draft = true
			}
			entryInfo.data = frontmatter
		}
		entryInfos.push(entryInfo)

		if (!frontmatter) continue

		if (frontmatter.draft === true) hasDraft = true
		collectFieldObservations(fieldMap, frontmatter, sources.length)
	}

	const def = assembleCollectionDefinition(collectionName, contentDir, fieldMap, entryInfos, sources.length, {
		path: sourceBasePath,
		supportsDraft: hasDraft,
		fileExtension,
	})
	assignFieldMetadata(def.fields, allDirectives)
	return def
}

/**
 * Build a DATA collection definition (JSON/YAML) from an explicit source list,
 * relative to `basePath`. Mirrors {@link buildCollectionDefinition} but parses
 * data files instead of markdown frontmatter, so it backs both the directory
 * scan ({@link scanDataCollection}) and the glob-loader path
 * ({@link scanGlobCollection}) — the latter for data collections whose `base`
 * lives outside `contentDir`.
 */
async function buildDataCollectionDefinition(
	fs: CmsFileSystem,
	basePath: string,
	sources: Array<{ slug: string; relPath: string }>,
	collectionName: string,
	contentDir: string,
): Promise<CollectionDefinition | null> {
	if (sources.length === 0) return null

	const sourceBasePath = getCollectionSourceBasePath(basePath, collectionName, contentDir)
	const fieldMap = new Map<string, FieldObservation>()
	const entryInfos: CollectionEntryInfo[] = []
	const ext = sources.some(s => s.relPath.endsWith('.json'))
		? 'json' as const
		: sources.some(s => s.relPath.endsWith('.yaml'))
		? 'yaml' as const
		: 'yml' as const

	const fileContents = await Promise.all(
		sources.map(s => fs.readFile(path.join(basePath, s.relPath)).catch(() => null)),
	)

	for (let i = 0; i < sources.length; i++) {
		const source = sources[i]!
		const raw = fileContents[i]!
		if (raw === null) continue
		let data: Record<string, unknown> | null = null
		try {
			data = source.relPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw) as Record<string, unknown>
		} catch {
			continue
		}
		if (!data || typeof data !== 'object') continue

		// Shared with the markdown branch, so `title` wins over `name` here too — a
		// deliberate change from the old `name`-first order; declare `titleField` to
		// pin a different field.
		const title = deriveEntryTitle(data)
		entryInfos.push({
			slug: source.slug,
			title,
			sourcePath: path.join(sourceBasePath, source.relPath),
			data,
		})

		collectFieldObservations(fieldMap, data, sources.length)
	}

	return assembleCollectionDefinition(collectionName, contentDir, fieldMap, entryInfos, sources.length, {
		path: sourceBasePath,
		type: 'data',
		fileExtension: ext,
	})
}

/**
 * Scan a single collection directory and infer its schema
 */
async function scanCollection(
	fs: CmsFileSystem,
	collectionPath: string,
	collectionName: string,
	contentDir: string,
): Promise<CollectionDefinition | null> {
	const dirEntries = await fs.list(collectionPath)
	if (dirEntries.length === 0) return null

	const sources: Array<{ slug: string; relPath: string }> = []
	const takenSlugs = new Set<string>()

	for (const entry of dirEntries) {
		if (entry.isDirectory) continue
		if (!entry.name.endsWith('.md') && !entry.name.endsWith('.mdx')) continue
		const slug = entry.name.replace(/\.(md|mdx)$/, '')
		sources.push({ slug, relPath: entry.name })
		takenSlugs.add(slug)
	}

	// Hugo-style layout: <slug>/index.md(x). Flat files win on slug conflict.
	const subdirs = dirEntries.filter(e => e.isDirectory && !e.name.startsWith('_') && !e.name.startsWith('.'))
	const indexLookups = await Promise.all(subdirs.map(async dir => {
		if (takenSlugs.has(dir.name)) return null
		for (const ext of ['md', 'mdx'] as const) {
			const relPath = path.join(dir.name, `index.${ext}`)
			if (await fs.exists(path.join(collectionPath, relPath))) {
				return { slug: dir.name, relPath }
			}
		}
		return null
	}))
	for (const entry of indexLookups) {
		if (entry) sources.push(entry)
	}

	if (sources.length === 0) return null
	return await buildCollectionDefinition(fs, collectionPath, sources, collectionName, contentDir)
}

/**
 * The files a glob loader matches, relative to its base. The scan leaves symbolic links out;
 * the scan report follows them, as Astro does, to see what that left out.
 */
async function globLoaderFiles(
	fs: CmsFileSystem,
	baseRel: string,
	pattern: string,
	options?: GlobOptions,
): Promise<string[]> {
	// The port's glob walks the root; scope it to the loader base and re-relativize matches.
	// The scanner ignores files/dirs whose path segments start with `_` or `.` (private/hidden),
	// matching the directory-walk behavior of the original scanner — the glob pattern alone
	// would otherwise match them.
	const isPrivate = (relToBase: string) => relToBase.split('/').some(seg => seg.startsWith('_') || seg.startsWith('.'))
	// Such a directory is not walked either, so one that cannot be read does not cost the
	// collection: none of its files would be kept.
	const matches = await fs.glob(path.join(baseRel, pattern), { ...options, skipDirectory: dir => isPrivate(path.relative(baseRel, dir)) })
	return matches
		.map(rel => path.relative(baseRel, rel))
		.filter(relToBase => !isPrivate(relToBase))
}

/**
 * Scan a collection declared in content config via a glob loader (base + pattern),
 * which may share a base directory with another collection (nested layout).
 */
async function scanGlobCollection(
	fs: CmsFileSystem,
	collectionName: string,
	baseRel: string,
	pattern: string,
	contentDir: string,
): Promise<CollectionDefinition | null> {
	const rels = await globLoaderFiles(fs, baseRel, pattern)

	// Markdown collections win when both are present; otherwise build a data
	// collection (yaml/json) — the loader pattern dictates which, and a data
	// `base` may sit outside `contentDir` and nest entries in subdirectories.
	const mdSources = rels
		.filter(relToBase => relToBase.endsWith('.md') || relToBase.endsWith('.mdx'))
		.map(relToBase => ({ slug: relToBase.replace(/\.(md|mdx)$/, ''), relPath: relToBase }))
	if (mdSources.length > 0) {
		return await buildCollectionDefinition(fs, baseRel, mdSources, collectionName, contentDir)
	}

	const dataSources = rels
		.filter(relToBase => /\.(ya?ml|json)$/.test(relToBase))
		.map(relToBase => ({ slug: relToBase.replace(/\.(ya?ml|json)$/, ''), relPath: relToBase }))
	if (dataSources.length > 0) {
		return await buildDataCollectionDefinition(fs, baseRel, dataSources, collectionName, contentDir)
	}

	return null
}

/**
 * Filter scanned fields to schema-only and apply per-field overrides (type, hints, required)
 * in a single pass. Filtering must happen first since it can shrink `def.fields`.
 */
function applyParsedConfig(
	collections: Record<string, CollectionDefinition>,
	parsed: ParsedConfig,
): void {
	for (const [collectionName, parsedColl] of parsed) {
		const def = collections[collectionName]
		if (!def) continue

		if (parsedColl.fields.length > 0) {
			const schemaNames = new Set(parsedColl.fields.map(f => f.name))
			def.fields = def.fields.filter(f => schemaNames.has(f.name))
		}

		const fieldsByName = new Map(def.fields.map(f => [f.name, f]))
		for (const pf of parsedColl.fields) {
			const field = fieldsByName.get(pf.name)
			if (!field) continue
			applyParsedFieldOverrides(field, pf)
		}

		// Declarative form layout from `defineCmsCollection({ cms })`.
		if (parsedColl.layout) def.layout = parsedColl.layout
		// Declarative page-URL rule from `defineCmsCollection({ cms: { pathname } })`.
		if (parsedColl.pathname) def.pathname = parsedColl.pathname
		// `defineCmsCollection({ cms: { fragment, previewOf } })`: the collection is rendered
		// inside other pages and owns no URL. Consumers must not invent one for its entries.
		if (parsedColl.fragment) {
			def.fragment = parsedColl.fragment
			if (parsedColl.previewOf) def.previewOf = parsedColl.previewOf
		}
		// Declarative entry-title source from `defineCmsCollection({ cms: { titleField } })`.
		// The scan derived titles by fallback; re-derive them from the declared field.
		if (parsedColl.titleField) {
			def.titleField = parsedColl.titleField
			applyCollectionTitleField(def, parsedColl.titleField)
		}
	}
}

/**
 * Re-derive every entry's title from the collection's declared `titleField` and restore
 * the title ordering `assembleCollectionDefinition` established — the scan sorted on the
 * fallback titles, which the declared field just replaced. A later `orderBy` still wins.
 */
function applyCollectionTitleField(def: CollectionDefinition, titleField: string): void {
	if (!def.entries) return
	for (const entry of def.entries) {
		entry.title = entry.data ? deriveEntryTitle(entry.data, titleField) : undefined
	}
	def.entries.sort((a, b) => (a.title ?? a.slug).localeCompare(b.title ?? b.slug))
}

/** Map a parsed field's layout hints onto the field definition (sidebar/position → position). */
function applyParsedFieldLayout(field: FieldDefinition, pf: ParsedField): void {
	const layout = pf.layout
	if (!layout) return
	if (layout.label !== undefined) field.label = layout.label
	if (layout.help !== undefined) field.help = layout.help
	if (layout.group !== undefined) field.group = layout.group
	if (layout.width !== undefined) field.width = layout.width
	if (layout.order !== undefined) field.order = layout.order
	// Either spelling is the author's answer, so both carry `positionDeclared` — that is the flag
	// telling a layout apart from the scanner's name-and-type guess below, and the difference
	// decides whether a rule like the headline hoist may override the placement.
	if (layout.sidebar) {
		field.position = 'sidebar'
		field.positionDeclared = true
	}
	if (layout.position) {
		field.position = layout.position
		field.positionDeclared = true
	}
	if (layout.derivedFrom) {
		// A declared derivation beats `detectDerivedHrefFields`: that pass runs after this one
		// and skips any field already carrying `derivedFrom`, so the config wins by construction.
		field.derivedFrom = layout.derivedFrom
		// A derivation read out of the config is a statement, not the guess `detectDerivedHrefFields`
		// makes from three sampled values — and only a statement is recomputed on write. Mark it so
		// consumers reading the wire definition can tell the two apart; the guess never sets this.
		field.derivedDeclared = true
		if (layout.derivedTransform) field.derivedTransform = layout.derivedTransform
		// The value is computed on every write, so hand-editing it makes no sense — hide it
		// unless the author explicitly asked for the opposite.
		field.hidden = layout.hidden ?? true
		return
	}
	if (layout.hidden) field.hidden = true
}

/**
 * Apply parsed schema overrides to an inferred field, recursing into nested object/array fields.
 *
 * Note on schema-vs-inferred merging at nested levels: schema-declared sub-fields replace
 * the inferred list rather than merging. Inferred-only sub-fields are *not* lost — the
 * editor's `ObjectFields` recovers them via its `extraKeys` calculation (field value keys
 * minus schemaNames), routes them through `FrontmatterField` (value-based auto-detect),
 * and offers a remove button. Merging here would defeat that.
 */
function applyParsedFieldOverrides(field: FieldDefinition, pf: ParsedField): void {
	if (pf.type) {
		field.type = pf.type
		// Parsed options only ever come from a declared `(z|n).enum([…])`, so they are a
		// closed set — unlike the options `mergeFieldObservations` infers from the entries
		// it happened to see, which stay open to free text.
		if (pf.options) {
			field.options = pf.options
			field.optionsClosed = true
		}
	}
	if (pf.itemType) field.itemType = pf.itemType
	if (pf.hints) field.hints = pf.hints
	if (pf.astroImage) field.astroImage = true
	field.required = pf.required
	applyParsedFieldLayout(field, pf)

	if (pf.fields) {
		const existingByName = new Map((field.fields ?? []).map(f => [f.name, f]))
		field.fields = pf.fields.map((subPf) => {
			const existing = existingByName.get(subPf.name)
			if (existing) {
				applyParsedFieldOverrides(existing, subPf)
				return existing
			}
			return parsedFieldToFieldDefinition(subPf)
		})
	}
}

/**
 * Build a FieldDefinition from a parsed schema field when no inferred counterpart exists.
 * Falls back to `'text'` when the parser couldn't pin a type — keeps the field visible
 * and editable. Schema-declared-but-data-absent fields would otherwise vanish.
 */
function parsedFieldToFieldDefinition(pf: ParsedField): FieldDefinition {
	const fd: FieldDefinition = {
		name: pf.name,
		// A parsed field with nested children but no explicit type is necessarily an object.
		// Otherwise default to 'text' so users can still fill in schema-declared fields
		// whose helper the parser didn't recognize.
		type: pf.type ?? (pf.fields ? 'object' : 'text'),
		required: pf.required,
	}
	if (pf.options) {
		fd.options = pf.options
		fd.optionsClosed = true
	}
	if (pf.itemType) fd.itemType = pf.itemType
	if (pf.hints) fd.hints = pf.hints
	if (pf.astroImage) fd.astroImage = true
	if (pf.fields) fd.fields = pf.fields.map(parsedFieldToFieldDefinition)
	applyParsedFieldLayout(fd, pf)
	return fd
}

/** Apply orderBy configuration: set the field name and direction on the definition, then re-sort entries. */
function applyCollectionOrderBy(
	collections: Record<string, CollectionDefinition>,
	parsed: ParsedConfig,
): void {
	for (const [collectionName, parsedColl] of parsed) {
		const orderField = parsedColl.fields.find(f => f.orderBy)
		if (!orderField?.orderBy) continue
		const def = collections[collectionName]
		if (!def) continue

		const fieldName = orderField.name
		const direction = orderField.orderBy.direction
		def.orderBy = fieldName
		def.orderDirection = direction
		if (def.entries && def.entries.length > 1) {
			const dir = direction === 'desc' ? -1 : 1
			def.entries.sort((a, b) => {
				const aVal = a.data?.[fieldName]
				const bVal = b.data?.[fieldName]
				if (aVal == null && bVal == null) return 0
				if (aVal == null) return 1
				if (bVal == null) return -1
				if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir
				if (aVal instanceof Date && bVal instanceof Date) return (aVal.getTime() - bVal.getTime()) * dir
				return String(aVal).localeCompare(String(bVal)) * dir
			})
		}
	}
}

/**
 * Detect reference fields. Prefers explicit `reference()` declarations from the content
 * config; if none are found anywhere, falls back to heuristic slug matching.
 */
function detectReferenceFields(
	collections: Record<string, CollectionDefinition>,
	parsed: ParsedConfig,
): void {
	let appliedAny = false
	for (const [collectionName, parsedColl] of parsed) {
		const def = collections[collectionName]
		if (!def) continue
		for (const pf of parsedColl.fields) {
			if (!pf.reference) continue
			const field = def.fields.find(f => f.name === pf.name)
			if (!field) continue
			appliedAny = true
			if (pf.reference.isArray) {
				field.type = 'array'
				field.itemType = 'reference'
			} else {
				field.type = 'reference'
			}
			field.collection = pf.reference.target
			field.options = undefined
		}
	}

	if (!appliedAny) detectReferenceFieldsBySlugMatch(collections)
}

function detectReferenceFieldsBySlugMatch(collections: Record<string, CollectionDefinition>): void {
	const collectionSlugs = new Map<string, Set<string>>()
	for (const [name, def] of Object.entries(collections)) {
		if (def.entries && def.entries.length > 0) {
			collectionSlugs.set(name, new Set(def.entries.map(e => e.slug)))
		}
	}

	for (const [collectionName, def] of Object.entries(collections)) {
		for (const field of def.fields) {
			if ((field.type === 'text' || field.type === 'select') && field.examples) {
				const stringExamples = field.examples.filter((v): v is string => typeof v === 'string')
				if (stringExamples.length === 0) continue

				// Find all candidate collections where all examples match slugs
				const candidates: Array<{ name: string; slugs: Set<string> }> = []
				for (const [targetName, slugs] of collectionSlugs) {
					if (targetName === collectionName) continue
					const matchCount = stringExamples.filter(v => slugs.has(v)).length
					if (matchCount > 0 && matchCount === stringExamples.length) {
						candidates.push({ name: targetName, slugs })
					}
				}

				let bestTarget: string | undefined
				if (candidates.length === 1) {
					bestTarget = candidates[0]!.name
				} else if (candidates.length > 1) {
					// Multiple matches — disambiguate using all field values
					const allValues = def.entries?.flatMap(e => {
						const v = e.data?.[field.name]
						return typeof v === 'string' ? [v] : []
					}) ?? stringExamples
					let bestOverlap = 0
					for (const c of candidates) {
						const overlap = allValues.filter(v => c.slugs.has(v)).length
						if (overlap > bestOverlap) {
							bestOverlap = overlap
							bestTarget = c.name
						}
					}
				}
				if (bestTarget) {
					field.type = 'reference'
					field.collection = bestTarget
					field.options = undefined
				}
			}

			if (field.type === 'array' && field.itemType === 'text' && field.options) {
				let bestTarget: string | undefined
				let bestOverlap = 0
				for (const [targetName, slugs] of collectionSlugs) {
					if (targetName === collectionName) continue
					const matchCount = field.options.filter(v => slugs.has(v)).length
					if (matchCount > 0 && matchCount >= field.options.length * 0.5) {
						if (matchCount > bestOverlap) {
							bestOverlap = matchCount
							bestTarget = targetName
						}
					}
				}
				if (bestTarget) {
					field.type = 'array'
					field.itemType = 'reference'
					field.collection = bestTarget
					field.options = undefined
				}
			}
		}
	}
}

/**
 * Tag fields with semantic roles so the editor UI can position them without
 * matching on Astro-specific field names. Detection lives here — the layer
 * that already knows it's parsing Astro content collections.
 */
function assignSemanticRoles(collections: Record<string, CollectionDefinition>): void {
	for (const def of Object.values(collections)) {
		let toggle: FieldDefinition | undefined
		let dateByName: FieldDefinition | undefined
		let dateByType: FieldDefinition | undefined
		for (const field of def.fields) {
			if (field.hidden || field.role) continue
			const normalized = normalizeFieldName(field.name)
			if (!toggle && field.type === 'boolean' && PUBLISH_TOGGLE_NAMES.has(normalized)) {
				toggle = field
			} else if (!dateByName && PUBLISH_DATE_NAMES.has(normalized)) {
				dateByName = field
			} else if (!dateByType && (field.type === 'date' || field.type === 'datetime')) {
				dateByType = field
			}
		}
		if (toggle) toggle.role = 'publish-toggle'
		const date = dateByName ?? dateByType
		if (date) date.role = 'publish-date'
	}
}

/** Suffixes that indicate a field is a derived href/url/slug companion */
const HREF_SUFFIXES = ['href', 'url', 'link', 'slug', 'path'] as const

/**
 * Detect fields like `categoryHref` that are derived from a source field (`category`).
 * When every value is a slugified href of the source, mark it hidden with derivedFrom.
 */
function detectDerivedHrefFields(collections: Record<string, CollectionDefinition>): void {
	for (const def of Object.values(collections)) {
		const fieldsByName = new Map(def.fields.map(f => [f.name, f]))

		for (const field of def.fields) {
			if (field.hidden || field.derivedFrom) continue

			const lowerName = field.name.toLowerCase()
			for (const suffix of HREF_SUFFIXES) {
				if (!lowerName.endsWith(suffix)) continue
				const baseName = field.name.slice(0, -suffix.length)
				if (!baseName) continue

				// Case-insensitive lookup: exact match first, then scan by lowercased name
				let sourceField = fieldsByName.get(baseName)
				if (!sourceField) {
					const lowerBase = baseName.toLowerCase()
					for (const f of fieldsByName.values()) {
						if (f.name.toLowerCase() === lowerBase) {
							sourceField = f
							break
						}
					}
				}
				if (!sourceField || !sourceField.examples || !field.examples) continue

				const sourceExamples = sourceField.examples.filter((v): v is string => typeof v === 'string')
				const derivedExamples = field.examples.filter((v): v is string => typeof v === 'string')
				if (sourceExamples.length === 0 || derivedExamples.length === 0) continue

				// Order-independent: check that every derived value matches some source value's href
				const expectedHrefs = new Set(sourceExamples.map(slugifyHref))
				const allMatch = derivedExamples.every(v => expectedHrefs.has(v))
				if (allMatch) {
					field.hidden = true
					field.derivedFrom = sourceField.name
					break
				}
			}
		}
	}
}

/**
 * Scan a data collection (JSON/YAML files) and infer its schema
 */
async function scanDataCollection(
	fs: CmsFileSystem,
	collectionPath: string,
	collectionName: string,
	contentDir: string,
): Promise<CollectionDefinition | null> {
	const dirEntries = await fs.list(collectionPath)
	if (dirEntries.length === 0) return null

	const sources: Array<{ slug: string; relPath: string }> = []
	const takenSlugs = new Set<string>()

	for (const entry of dirEntries) {
		if (entry.isDirectory) continue
		if (!entry.name.endsWith('.json') && !entry.name.endsWith('.yaml') && !entry.name.endsWith('.yml')) continue
		const slug = entry.name.replace(/\.(json|ya?ml)$/, '')
		sources.push({ slug, relPath: entry.name })
		takenSlugs.add(slug)
	}

	// Hugo-style layout: <slug>/index.{json,yaml,yml}. Flat files win on slug conflict.
	const subdirs = dirEntries.filter(e => e.isDirectory && !e.name.startsWith('_') && !e.name.startsWith('.'))
	const indexLookups = await Promise.all(subdirs.map(async dir => {
		if (takenSlugs.has(dir.name)) return null
		for (const indexExt of ['json', 'yaml', 'yml'] as const) {
			const relPath = path.join(dir.name, `index.${indexExt}`)
			if (await fs.exists(path.join(collectionPath, relPath))) {
				return { slug: dir.name, relPath }
			}
		}
		return null
	}))
	for (const entry of indexLookups) {
		if (entry) sources.push(entry)
	}

	return await buildDataCollectionDefinition(fs, collectionPath, sources, collectionName, contentDir)
}

/**
 * Normalize a glob loader `base` (`./src/content/x`, `src/content/x/`) into a
 * root-relative path comparable with a collection definition's `path`. The project
 * root comes out as `.`. Entry reads and writes resolve their directory with this too,
 * so they land where the scan reports a collection.
 */
export function normalizeBasePath(basePath: string): string {
	return path.normalize(basePath.replace(/^\.[/\\]+/, '')).replace(/[/\\]+$/, '')
}

/**
 * A loader pattern that selects the whole base directory rather than a slice of it:
 * no subdirectory or filename prefix. `*`, `*.md`, `*.{md,mdx}` and `**\/*.md` qualify;
 * `otazky/*.md` and `otazky-*.md` do not, because they pick a subset.
 */
const WHOLE_DIRECTORY_PATTERN = /^(?:\*\*[/\\])*\*(?:\.(?:\{([^{}/\\]*)\}|([A-Za-z0-9]+)))?$/

/**
 * Does a config-declared glob loader cover everything the directory scan already found?
 * Beyond the pattern shape, the extensions have to line up too — `*.mdx` over a directory
 * of `.md` files is a narrower selection, so it stays its own (child) collection.
 */
function patternCoversWholeCollection(pattern: string, definition: CollectionDefinition): boolean {
	const match = pattern.trim().replace(/^\.[/\\]+/, '').match(WHOLE_DIRECTORY_PATTERN)
	if (!match) return false

	const [, braceGroup, singleExtension] = match
	// A bare `*` / `**/*` takes whatever the directory holds.
	if (braceGroup === undefined && singleExtension === undefined) return true

	const patternExtensions = new Set(
		(braceGroup !== undefined ? braceGroup.split(',') : [singleExtension!])
			.map(ext => ext.trim().replace(/^\./, '').toLowerCase())
			.filter(Boolean),
	)
	const scannedExtensions = new Set(
		(definition.entries ?? []).map(entry => path.extname(entry.sourcePath).slice(1).toLowerCase()).filter(Boolean),
	)
	if (scannedExtensions.size === 0) return false
	for (const ext of scannedExtensions) {
		if (!patternExtensions.has(ext)) return false
	}
	return true
}

/**
 * Scan all collections in the content directory.
 *
 * `contentDir` is a root-relative directory (default `src/content`); all I/O is
 * resolved against the injected `CmsFileSystem`'s root. `parseCache` keeps the
 * mtime-keyed content-config parse result across calls within one core instance.
 */
export async function scanCollections(
	fs: CmsFileSystem,
	contentDir: string = 'src/content',
	parseCache: ParseCache = new Map(),
	options: { report?: boolean } = {},
): Promise<Record<string, CollectionDefinition>> {
	const collections: Record<string, CollectionDefinition> = {}
	/** Collections whose scan threw, by name, as they go into the scan report. */
	const failedScans = new Map<string, UnresolvedCollection>()

	const entries = await fs.list(contentDir)

	// Each collection scans independently: a single unreadable/racing collection is
	// skipped (logged) rather than rejecting Promise.all and aborting every collection.
	const scanPromises = entries
		.filter(entry => entry.isDirectory && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
		.map(async entry => {
			try {
				const collectionPath = path.join(contentDir, entry.name)
				const definition = await scanCollection(fs, collectionPath, entry.name, contentDir)
					?? await scanDataCollection(fs, collectionPath, entry.name, contentDir)
				if (definition) {
					collections[entry.name] = definition
				}
			} catch (error) {
				console.warn(`[cms] Skipping collection "${entry.name}" — scan failed:`, error)
				failedScans.set(entry.name, { name: entry.name, reason: 'scan-failed', base: path.join(contentDir, entry.name) })
			}
		})

	await Promise.all(scanPromises)

	// Post-scan: apply schema-driven field config, detect references, derived fields, and ordering
	const config = await readContentConfig(fs, parseCache)
	const { parsed } = config

	// Where the directory scan put each collection, so a config-declared loader base can be
	// matched back to the definition that already covers that directory.
	const scannedNameByBasePath = new Map<string, string>()
	for (const [name, definition] of Object.entries(collections)) {
		scannedNameByBasePath.set(normalizeBasePath(definition.path), name)
	}
	/** Scanned collections re-keyed under their config name: scanned key -> config key. */
	const rekeyedScannedNames = new Map<string, string>()

	for (const [collectionName, parsedCollection] of parsed) {
		if (collections[collectionName]) continue
		if (!parsedCollection.loaderBase || !parsedCollection.loaderPattern) continue

		// Same collection, different key (`heroSlides` over `content/hero-slides`): the loader
		// base is a directory the scan already covered and the pattern selects all of it. Re-key
		// the scanned definition instead of adding a second copy — entries and inferred fields
		// survive, and the config key wins because `applyParsedConfig`, references and
		// `defineCmsCollection` all key by it.
		const scannedName = scannedNameByBasePath.get(normalizeBasePath(parsedCollection.loaderBase))
		const scannedDefinition = scannedName ? collections[scannedName] : undefined
		if (scannedName && scannedDefinition && patternCoversWholeCollection(parsedCollection.loaderPattern, scannedDefinition)) {
			delete collections[scannedName]
			scannedDefinition.name = collectionName
			for (const other of Object.values(collections)) {
				if (other.parentCollection === scannedName) other.parentCollection = collectionName
			}
			collections[collectionName] = scannedDefinition
			rekeyedScannedNames.set(scannedName, collectionName)
			continue
		}

		let definition: CollectionDefinition | null
		try {
			definition = await scanGlobCollection(fs, collectionName, parsedCollection.loaderBase, parsedCollection.loaderPattern, contentDir)
		} catch (error) {
			console.warn(`[cms] Skipping glob collection "${collectionName}" — scan failed:`, error)
			failedScans.set(collectionName, {
				name: collectionName,
				reason: 'scan-failed',
				base: normalizeBasePath(parsedCollection.loaderBase),
				pattern: parsedCollection.loaderPattern,
			})
			continue
		}
		if (!definition) continue
		// Nest under the collection that owns the shared base directory (e.g. jsem-otazky -> jsem),
		// so the CMS browser can group it under its parent page instead of listing it flat.
		const baseName = parsedCollection.loaderBase.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
		const parentName = !baseName ? undefined : collections[baseName] ? baseName : rekeyedScannedNames.get(baseName)
		if (parentName && parentName !== collectionName) {
			definition.parentCollection = parentName
		}
		collections[collectionName] = definition
	}

	applyParsedConfig(collections, parsed)
	detectReferenceFields(collections, parsed)
	detectDerivedHrefFields(collections)
	assignSemanticRoles(collections)
	applyCollectionOrderBy(collections, parsed)
	warnOnPathnameCollisions(collections)

	// The report has to describe the disk as this scan found it, so it is built here and not
	// when someone asks for it later; a caller that will not ask does not pay for it. And it
	// is an extra: failing to build it must not fail a scan that succeeded.
	if (options.report) {
		try {
			const contentDirectories = entries
				.filter(entry => entry.isDirectory && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
				.map(entry => entry.name)
			scanReports.set(collections, await buildScanReport(fs, contentDir, collections, config, failedScans, contentDirectories))
		} catch (error) {
			console.warn('[cms] Collection scan report unavailable:', error)
		}
	}

	return collections
}

/** The report of each scan, by the record that scan returned — see {@link collectionScanReport}. */
const scanReports = new WeakMap<Record<string, CollectionDefinition>, CollectionScanReport>()

/**
 * What the scan that returned `collections` could not vouch for.
 *
 * Looked up by the record itself instead of being returned next to it: `scanCollections`
 * keeps its return type for the callers that only want the definitions, and a report cannot
 * be paired with another scan's collections. `undefined` for a scan that was not asked for a
 * report (`options.report`), for one whose report could not be built, and for any other
 * object (a copy, a hand-built record) — read that as "not reported", never as "nothing
 * unresolved".
 */
export function collectionScanReport(collections: Record<string, CollectionDefinition>): CollectionScanReport | undefined {
	return scanReports.get(collections)
}

/**
 * Patterns the `CmsFileSystem` port does not run the way Astro's glob does. Syntax it reads
 * literally or wrongly: a character class, an extglob, an escape, a `|` (alternation to
 * Astro), a `+` behind a brace (a quantifier), a brace without a comma (the name `{a}` to
 * Astro), and inside a brace another brace, a range (`{x,1..3}`) or a wildcard. And
 * shapes Astro's glob reads wider than the port: a `..` segment, also one a brace completes
 * (`..{/drafts,x}`), a trailing slash (also one an empty brace alternative leaves behind), a
 * negation behind `./`, and a final `/**`, which to Astro also matches a file named by what
 * stands before it. What such a pattern matches here says nothing about what the loader loads.
 * A lone leading `!` is not among them: it matches nothing in Astro, and nothing here.
 */
const UNSUPPORTED_GLOB_SYNTAX = /[[\]()\\|]|\}\+|\{[^}]*(?:\{|\.\.|[*?]|,,)|\{,|,\}|\{[^,}]*\}|(?:^|[/{},])\.\.(?:[/{},]|$)|\/$|^(?:\.\/)+!|.\/\*\*$/

/**
 * A `..` segment in a pattern leads out of the base, so the files under the base do not bound
 * it. A brace next to the dots may be what makes them a segment.
 */
const LEAVES_THE_BASE = /(?:^|[/{},])\.\.(?:[/{},]|$)/

/**
 * How many directories behind symbolic links the report reads for one collection before it
 * gives up on it. Links can lead into a tree of any size, and into each other.
 */
const REPORT_LINKED_DIRECTORY_LIMIT = 20_000

/**
 * Files that may be entries. Astro's glob loads md, mdx (with the integration), json, yaml,
 * yml and toml; the other markdown spellings and mdoc are loaded only where an integration
 * adds them, and are counted anyway: a file too many is a report, a file too few a miss.
 * A loader's pattern may match more (a cover image next to an entry), and that is not content.
 */
const ENTRY_FILE = /\.(?:md|mdx|mdoc|markdown|mdown|mkdn|mkd|mdwn|json|ya?ml|toml)$/i

/** The markdown half of {@link ENTRY_FILE}: what Astro takes from a content directory nothing declares. */
const MARKDOWN_FILE = /\.(?:md|mdx|mdoc|markdown|mdown|mkdn|mkd|mdwn)$/i

/**
 * Whether Astro reads `base` as the relative directory the scan takes it for. Astro resolves
 * it as a URL against the project root: an absolute path or a scheme is somewhere else, an
 * escape, a query or a fragment is not part of the directory name, a backslash becomes a
 * slash, whitespace at the edges and tabs or line breaks anywhere are dropped, and a `..`
 * that leaves the root is resolved against it. And the port would read a glob character in
 * the base as part of the pattern.
 */
function readsAsRelativeDirectory(base: string): boolean {
	if (/[*?{}]/.test(base)) return false
	try {
		const asUrl = decodeURIComponent(new URL(base, 'file:///project-root/').pathname).replace(/\/{2,}/g, '/').replace(/\/+$/, '')
		const asPath = normalizeBasePath(base).split(path.sep).join('/')
		return asUrl === (asPath === '.' ? '/project-root' : `/project-root/${asPath}`)
	} catch {
		return false
	}
}

/** Where a declaration says its files are, in the shape the report carries. */
function declaredLocation(declaration: DeclaredCollection, contentDir: string): Pick<UnresolvedCollection, 'base' | 'pattern' | 'file'> {
	const location: Pick<UnresolvedCollection, 'base' | 'pattern' | 'file'> = {}
	if (declaration.noLoader) location.base = path.join(contentDir, declaration.name)
	if (declaration.loaderBase !== undefined) location.base = normalizeBasePath(declaration.loaderBase)
	if (declaration.loaderPattern !== undefined) location.pattern = declaration.loaderPattern
	if (declaration.loaderFile !== undefined) location.file = normalizeBasePath(declaration.loaderFile)
	return location
}

/**
 * The entry files of a content directory read without a loader, root-relative: all of them at
 * any depth, `_` and `.` paths aside. This is what Astro loads for a declaration without a
 * loader and for a content directory nothing declares, under the
 * `legacy.collectionsBackwardsCompat` flag that nua sets.
 */
async function contentDirectoryFiles(fs: CmsFileSystem, directory: string, entryFile: RegExp): Promise<string[]> {
	const files = await globLoaderFiles(fs, directory, '**/*', { followSymlinks: true, maxLinkedDirectories: REPORT_LINKED_DIRECTORY_LIMIT })
	return files.filter(file => entryFile.test(file)).map(file => path.join(directory, file))
}

/**
 * The entry files a declared collection loads, root-relative, as far as that can be told
 * without running its loader. `exact` when the scan can evaluate the loader; otherwise the
 * files are every entry file the loader could match. `null` when not even that is known.
 */
async function declaredEntryFiles(
	fs: CmsFileSystem,
	contentDir: string,
	declaration: DeclaredCollection,
): Promise<{ files: string[]; exact: boolean } | null> {
	if (declaration.noLoader) {
		// Astro resolves the name as a URL against the content directory, like a base.
		if (!readsAsRelativeDirectory(declaration.name)) return null
		return { exact: true, files: await contentDirectoryFiles(fs, path.join(contentDir, declaration.name), ENTRY_FILE) }
	}

	// Without a literal base there is nothing to look under, and one Astro reads as something
	// other than a relative path is no better.
	const declaredBase = declaration.loaderBase
	if (declaredBase === undefined || !readsAsRelativeDirectory(declaredBase)) return null
	const base = normalizeBasePath(declaredBase)
	const pattern = declaration.loaderPattern
	// A list of patterns is not run here either, but it can be read for where it leads.
	const patterns = pattern !== undefined ? [pattern] : declaration.loaderPatterns
	// A pattern that cannot be read may lead anywhere.
	if (patterns === undefined) return null
	// As spelled and as the port joins it to the base, which drops `.` segments and doubled slashes.
	const exact = pattern !== undefined && !UNSUPPORTED_GLOB_SYNTAX.test(pattern) && !UNSUPPORTED_GLOB_SYNTAX.test(path.posix.normalize(pattern))
	// Patterns the scan cannot evaluate select among the files under the base: all of them
	// are candidates. Unless one leads out of the base, and the whole project is not walked
	// on that off chance either.
	if (!exact && (base === '.' || patterns.some(one => LEAVES_THE_BASE.test(one)))) return null
	const matches = await fs.glob(path.join(base, exact ? pattern : '**/*'), {
		followSymlinks: true,
		maxLinkedDirectories: REPORT_LINKED_DIRECTORY_LIMIT,
	})
	// Astro's glob leaves dot paths out unless the pattern asks for them. It does load `_`
	// files, which the scan skips, so those stay in.
	const files = matches.filter(file => ENTRY_FILE.test(file) && patterns.some(one => mayTakeDotPath(one, path.relative(base, file))))
	return { exact, files }
}

/**
 * Whether a loader pattern can match `file` (relative to the base) as far as leading dots go.
 * Astro's glob keeps `*` and `**` from matching one, so a dotfile or a file in a dot directory
 * is loaded only when the pattern asks for it. It does by naming a dot at the start of a
 * segment or of an alternative. And by a wildcard at the start of an alternative, right
 * behind a brace or behind a `|`: Astro's glob guards `*` and `?` against a leading dot only
 * at the start of the pattern and behind a slash, so `{guide/,notes/}*.md` takes
 * `guide/.wip.md`. In both cases nothing is ruled out here. And by a character class or an
 * extglob (in patterns the scan does not run), which take a leading dot like any other
 * character: in the last segment a dotfile, in an earlier one a dot directory. Where a brace
 * or an extglob spans a slash the segments cannot be told apart, and either takes both.
 */
function mayTakeDotPath(pattern: string, file: string): boolean {
	const segments = file.split(/[/\\]/)
	const dotFile = segments.pop()!.startsWith('.')
	const dotDirectory = segments.some(segment => segment.startsWith('.'))
	if (!dotFile && !dotDirectory) return true
	if (/(?:^|[/{},|!\\])\.[^./]|[{,}|][*?]/.test(pattern)) return true
	const cut = pattern.lastIndexOf('/')
	const blurred = /[{(][^})]*\//.test(pattern)
	const takesDot = (part: string): boolean => /[[(]/.test(blurred ? pattern : part)
	return (!dotFile || takesDot(pattern.slice(cut + 1))) && (!dotDirectory || takesDot(pattern.slice(0, Math.max(cut, 0))))
}

/** Where Astro looks for its own config. It takes the first one there is. */
const ASTRO_CONFIG_PATHS = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts']

/**
 * The project's source directory when the Astro config moves it from `src`: the directory,
 * `undefined` for the default, or `null` when where Astro loads content from cannot be told.
 *
 * Read off the code of the one config file Astro uses. Two of its options decide the place:
 * `srcDir`, where the content config and the content directory are, and `root`, which every
 * loader's `base` is resolved against. Which mention of either name is Astro's option cannot
 * be told without evaluating the file (it may name another plugin's option, a variable, a
 * member), so every one of them has to be a property given a plain string: all `srcDir`s the
 * same directory inside the project, every `root` the project root itself, which the scan
 * takes it to be. Either name given an object literal is not Astro's option, which is a string.
 */
async function customSrcDir(fs: CmsFileSystem): Promise<string | null | undefined> {
	for (const configPath of ASTRO_CONFIG_PATHS) {
		const source = await fs.readFile(configPath).catch(() => null)
		if (source === null) continue
		const roots = configOptionMentions(source, 'root')
		const srcDirs = configOptionMentions(source, 'srcDir')
		if (roots === null || srcDirs === null) return null
		if (roots.some(root => root === null || normalizeBasePath(root) !== '.')) return null
		if (srcDirs.length === 0) return undefined
		const [srcDir, ...others] = srcDirs.map(literal => (literal === null ? null : normalizeBasePath(literal)))
		if (srcDir === null || srcDir === undefined || others.some(other => other !== srcDir)) return null
		if (srcDir === 'src') return undefined
		return path.isAbsolute(srcDir) || srcDir.startsWith('..') ? null : srcDir
	}
	return undefined
}

/**
 * How much of the content config was read, for the report. Astro takes the config from more
 * file names than the reader looks at, and from another directory when `srcDir` says so, so
 * which files exist is part of the answer.
 */
async function contentConfigStatus(fs: CmsFileSystem, config: ContentConfigRead): Promise<CollectionScanReport['contentConfig']> {
	const configPaths = [...CONTENT_CONFIG_PATHS, ...UNREAD_CONTENT_CONFIG_PATHS]
	const srcDir = await customSrcDir(fs)
	// Where Astro loads from cannot be told, so neither can whether a config is there, nor
	// whether what the scan found under the project root is what Astro loads.
	if (srcDir === null) return 'unreadable'
	if (srcDir !== undefined) {
		// The reader only looks under `src`, so a config found here was not read. Nothing here
		// settles nothing: the mention may not have been Astro's option, and then `src` is
		// where the config is, so `src` is judged as usual.
		for (const configPath of configPaths) {
			if (await fs.exists(path.join(srcDir, path.relative('src', configPath)))) return 'unreadable'
		}
	}

	let configFiles = 0
	for (const configPath of configPaths) {
		if (await fs.exists(configPath)) configFiles++
	}
	if (configFiles === 0) return 'missing'
	// With two config files, the one the reader took need not be the one Astro uses.
	if (config.partial || configFiles > 1) return 'partial'
	if (config.declared.length > 0) return 'ok'
	// Nothing declared: a site without collections, or a config that was not read at all
	// (it does not parse, or it is one of the names the reader does not look at).
	return await classifyEmptyContentConfig(fs) === 'no-collections' ? 'ok' : 'unreadable'
}

/**
 * Account for every collection the scan knows of and cannot vouch for.
 *
 * "Knows of" is every name the content config declares plus every content directory the
 * walk tried. A declared collection is vouched for when every entry file its loader loads is
 * an entry of the scan — which makes one that loads no files an empty collection, not an
 * unresolved one, and lets a site the scan reads whole report nothing. Being in `collections`
 * is not enough: a content directory of the declared name is read whatever the loader says.
 */
async function buildScanReport(
	fs: CmsFileSystem,
	contentDir: string,
	collections: Record<string, CollectionDefinition>,
	config: ContentConfigRead,
	failedScans: Map<string, UnresolvedCollection>,
	contentDirectories: string[],
): Promise<CollectionScanReport> {
	const contentConfig = await contentConfigStatus(fs, config)
	const unresolved = new Map<string, UnresolvedCollection>()
	const declaredByName = new Map(config.declared.map(declaration => [declaration.name, declaration]))

	/** Every file that is an entry of some collection. */
	const listed = new Set<string>()
	for (const definition of Object.values(collections)) {
		for (const entry of definition.entries ?? []) listed.add(path.normalize(entry.sourcePath))
		// `entryCount` is the source files found, `entries` the ones that could be read and parsed.
		if ((definition.entries?.length ?? 0) >= definition.entryCount) continue
		const declaration = declaredByName.get(definition.name)
		unresolved.set(definition.name, {
			name: definition.name,
			reason: 'unlisted-entries',
			base: normalizeBasePath(definition.path),
			...(declaration ? declaredLocation(declaration, contentDir) : {}),
		})
	}

	for (const declaration of config.declared) {
		const { name } = declaration
		if (unresolved.has(name)) continue
		const location = declaredLocation(declaration, contentDir)

		const failed = collections[name] ? undefined : failedScans.get(name)
		if (failed) {
			unresolved.set(name, failed)
			continue
		}

		let loads: Awaited<ReturnType<typeof declaredEntryFiles>>
		try {
			loads = await declaredEntryFiles(fs, contentDir, declaration)
		} catch {
			// Looking where the loader loads from threw: a base outside the root, a directory that cannot be read.
			unresolved.set(name, { name, reason: 'scan-failed', ...location })
			continue
		}
		if (loads === null) {
			unresolved.set(name, { name, reason: 'unsupported-loader', ...location })
		} else if (!loads.files.every(file => listed.has(path.normalize(file)))) {
			// A file the loader is known to load is missing from the entries — or, where the loader
			// cannot be evaluated, one it may load is.
			unresolved.set(name, { name, reason: loads.exact ? 'unlisted-entries' : 'unsupported-loader', ...location })
		}
	}

	// A content directory nothing declares. As nua configures Astro
	// (`legacy.collectionsBackwardsCompat`), each one is a collection of its markdown files at
	// any depth, unless some declared collection has a loader — then Astro leaves them alone.
	// Whether the flag is set cannot be read reliably, so it is taken to be: that way a
	// directory Astro does not load can be reported, and one it does load cannot be missed.
	// A declaration whose loader is unknown may have none, so only a loader that was seen counts.
	// A config that does not export `collections` gives Astro nothing to add to.
	const loadsUndeclared = config.exportsCollections && (contentConfig === 'ok' || contentConfig === 'partial')
		&& !config.declared.some(declaration => declaration.hasLoader)
	if (loadsUndeclared) {
		for (const name of contentDirectories) {
			if (declaredByName.has(name) || unresolved.has(name) || failedScans.has(name)) continue
			const directory = path.join(contentDir, name)
			const files = await contentDirectoryFiles(fs, directory, MARKDOWN_FILE).catch(() => null)
			if (files === null) unresolved.set(name, { name, reason: 'scan-failed', base: directory })
			else if (!files.every(file => listed.has(path.normalize(file)))) unresolved.set(name, { name, reason: 'unlisted-entries', base: directory })
		}
	}

	// What is left are content directories the config does not declare under that name. One a
	// declared collection loads from under another key (`heroSlides` over `hero-slides`) has
	// failed there already, and one whose declared loader did read it has not failed at all.
	for (const failed of failedScans.values()) {
		if (collections[failed.name] || unresolved.has(failed.name)) continue
		if ([...unresolved.values()].some(other => other.reason === 'scan-failed' && other.base === failed.base)) continue
		unresolved.set(failed.name, failed)
	}

	return {
		contentConfig,
		unresolved: [...unresolved.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
	}
}

/**
 * Warn when a collection's declarative `cms.pathname` rule maps two distinct
 * entries to the same URL — e.g. an all-literal spec, or a spec whose `field`
 * segments are constant across entries. Such a rule silently collapses entries
 * onto one page, so surface it at scan time (once per scan) rather than letting
 * the manifest ship colliding pathnames with no signal. Runs after
 * `applyParsedConfig`, which is where `def.pathname` gets populated.
 */
function warnOnPathnameCollisions(collections: Record<string, CollectionDefinition>): void {
	for (const def of Object.values(collections)) {
		if (!def.pathname || !def.entries) continue
		const bySlug = new Map<string, string>()
		for (const entry of def.entries) {
			const pathname = resolvePathnameFromSpec(def, entry.data)
			if (!pathname) continue
			const prev = bySlug.get(pathname)
			if (prev) {
				console.warn(
					`[cms] collection "${def.name}": pathname rule maps both "${prev}" and "${entry.slug}" to "${pathname}" — these entries will collide on one URL`,
				)
			} else {
				bySlug.set(pathname, entry.slug)
			}
		}
	}
}
