import fs from 'node:fs/promises'
import path from 'node:path'
import { isMap, isPair, isScalar, parse as parseYaml, parseDocument } from 'yaml'
import { getProjectRoot } from './config'
import { slugifyHref } from './shared'
import type { CollectionDefinition, CollectionEntryInfo, FieldDefinition, FieldType } from './types'

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

/** Directive pattern: # @position <value> or # @group <value> */
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
		const comment = (pair.key as any).commentBefore as string | undefined
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
 */
function assignFieldMetadata(
	fields: FieldDefinition[],
	directives: Record<string, { position?: 'sidebar' | 'header'; group?: string }>,
): void {
	for (const field of fields) {
		// Scanner defaults: well-known fields go to sidebar
		if (SIDEBAR_FIELD_NAMES.has(field.name.toLowerCase()) || field.type === 'image' || field.type === 'boolean') {
			field.position = 'sidebar'
		} else {
			field.position = 'header'
		}

		// Overlay frontmatter comment directives
		const directive = directives[field.name]
		if (directive) {
			if (directive.position) field.position = directive.position
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
 * Merge field observations from multiple files to determine final field definition
 */
function mergeFieldObservations(observations: FieldObservation[]): FieldDefinition[] {
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
		if (fieldType === 'text' && !FREE_TEXT_FIELD_NAMES.has(obs.name.toLowerCase())) {
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
						field.fields = mergeFieldObservations(Array.from(subFieldMap.values()))
					}
				}
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

function buildCollectionDefinition(
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
 * Scan a single collection directory and infer its schema
 */
async function scanCollection(collectionPath: string, collectionName: string, contentDir: string): Promise<CollectionDefinition | null> {
	try {
		const entries = await fs.readdir(collectionPath, { withFileTypes: true })
		const markdownFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mdx')))

		if (markdownFiles.length === 0) return null

		const hasMd = markdownFiles.some(f => f.name.endsWith('.md'))
		const fileExtension: 'md' | 'mdx' = hasMd ? 'md' : 'mdx'

		const fieldMap = new Map<string, FieldObservation>()
		const allDirectives: Record<string, { position?: 'sidebar' | 'header'; group?: string }> = {}
		const entryInfos: CollectionEntryInfo[] = []
		let hasDraft = false

		const fileContents = await Promise.all(
			markdownFiles.map(file => fs.readFile(path.join(collectionPath, file.name), 'utf-8')),
		)

		for (let i = 0; i < markdownFiles.length; i++) {
			const file = markdownFiles[i]!
			const content = fileContents[i]!
			const frontmatter = parseFrontmatter(content)

			const directives = parseFieldDirectives(content)
			for (const [key, value] of Object.entries(directives)) {
				if (!allDirectives[key]) {
					allDirectives[key] = value
				}
			}

			const slug = file.name.replace(/\.(md|mdx)$/, '')
			const entryInfo: CollectionEntryInfo = {
				slug,
				sourcePath: path.join(contentDir, collectionName, file.name),
			}
			if (frontmatter) {
				if (typeof frontmatter.title === 'string') {
					entryInfo.title = frontmatter.title
				}
				if (typeof frontmatter.draft === 'boolean' && frontmatter.draft) {
					entryInfo.draft = true
				}
				entryInfo.data = frontmatter
			}
			entryInfos.push(entryInfo)

			if (!frontmatter) continue

			if (frontmatter.draft === true) hasDraft = true
			collectFieldObservations(fieldMap, frontmatter, markdownFiles.length)
		}

		const def = buildCollectionDefinition(collectionName, contentDir, fieldMap, entryInfos, markdownFiles.length, {
			supportsDraft: hasDraft,
			fileExtension,
		})
		assignFieldMetadata(def.fields, allDirectives)
		return def
	} catch {
		return null
	}
}

/**
 * Read and parse the Astro content config file, extracting schema blocks for each collection.
 * Returns parsed blocks with collection names and their raw schema bodies.
 */
async function parseContentConfigSchemaBlocks(): Promise<Array<{ collectionName: string; schemaBody: string }>> {
	const projectRoot = getProjectRoot()

	for (const configPath of ['src/content/config.ts', 'src/content.config.ts']) {
		try {
			const fullPath = path.join(projectRoot, configPath)
			const content = await fs.readFile(fullPath, 'utf-8')

			const collectionBlocks = content.matchAll(
				/(?:const\s+(\w+)\s*=\s*)?defineCollection\s*\(\s*\{[\s\S]*?schema\s*:\s*z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/g,
			)

			// Map variable names to collection names from exports
			const varToName = new Map<string, string>()
			const exportMatch = content.match(/export\s+const\s+collections\s*=\s*\{([\s\S]*?)\}/)
			if (exportMatch) {
				const pairs = exportMatch[1]!.matchAll(/(\w+)\s*:\s*(\w+)/g)
				for (const m of pairs) {
					varToName.set(m[2]!, m[1]!)
				}
			}

			const blocks: Array<{ collectionName: string; schemaBody: string }> = []
			for (const block of collectionBlocks) {
				const varName = block[1]
				const schemaBody = block[2]!
				const collectionName = varName ? varToName.get(varName) : undefined
				if (!collectionName) continue
				blocks.push({ collectionName, schemaBody })
			}

			if (blocks.length > 0) return blocks
		} catch {
			// File doesn't exist, try next
		}
	}
	return []
}

/**
 * Parse the Astro content config file to extract explicit reference() declarations.
 * Returns a map: collectionName → { fieldName → { target, isArray } }
 */
function parseContentConfigReferences(
	schemaBlocks: Array<{ collectionName: string; schemaBody: string }>,
): Map<string, Map<string, { target: string; isArray: boolean }>> {
	const result = new Map<string, Map<string, { target: string; isArray: boolean }>>()

	for (const { collectionName, schemaBody } of schemaBlocks) {
		const fields = new Map<string, { target: string; isArray: boolean }>()
		const fieldRefs = schemaBody.matchAll(/(\w+)\s*:\s*(z\.array\s*\(\s*)?reference\s*\(\s*['"](\w+)['"]\s*\)/g)
		for (const m of fieldRefs) {
			fields.set(m[1]!, { target: m[3]!, isArray: !!m[2] })
		}

		if (fields.size > 0) {
			result.set(collectionName, fields)
		}
	}
	return result
}

/** Valid field type names exported by `n` helper from @nuasite/cms */
const FIELD_HELPER_TYPES = new Set(['image', 'url', 'email', 'color', 'date', 'datetime', 'time', 'textarea'])

/**
 * Parse the content config file to extract explicit field type hints:
 * - `n.image()`, `n.url()`, etc. from @nuasite/cms
 * - `z.enum([...])` for select options
 *
 * Returns a map: collectionName → fieldName → { type, options? }
 */
function parseContentConfigFieldTypes(
	schemaBlocks: Array<{ collectionName: string; schemaBody: string }>,
): Map<string, Map<string, { type: FieldType; options?: string[] }>> {
	const result = new Map<string, Map<string, { type: FieldType; options?: string[] }>>()

	for (const { collectionName, schemaBody } of schemaBlocks) {
		const fields = new Map<string, { type: FieldType; options?: string[] }>()

		// Detect n.image(), n.url(), etc.
		const fieldHelpers = schemaBody.matchAll(/(\w+)\s*:\s*n\.(\w+)/g)
		for (const m of fieldHelpers) {
			const fieldName = m[1]!
			const helperName = m[2]!
			if (FIELD_HELPER_TYPES.has(helperName)) {
				fields.set(fieldName, { type: helperName as FieldType })
			}
		}

		// Detect z.enum(['a', 'b', 'c'])
		const enumFields = schemaBody.matchAll(/(\w+)\s*:\s*z\.enum\s*\(\s*\[([\s\S]*?)\]\s*\)/g)
		for (const m of enumFields) {
			const fieldName = m[1]!
			const enumBody = m[2]!
			const options = [...enumBody.matchAll(/['"]([^'"]+)['"]/g)].map(o => o[1]!)
			if (options.length > 0) {
				fields.set(fieldName, { type: 'select', options })
			}
		}

		if (fields.size > 0) {
			result.set(collectionName, fields)
		}
	}
	return result
}

/**
 * Extract all top-level field names from a schema body string.
 * Matches `fieldName:` patterns at the start of lines within z.object({...}).
 */
function extractSchemaFieldNames(schemaBody: string): Set<string> {
	const names = new Set<string>()
	for (const m of schemaBody.matchAll(/^\s*(\w+)\s*:/gm)) {
		names.add(m[1]!)
	}
	return names
}

/**
 * When a content config schema exists, filter scanned fields to only include
 * those defined in the schema. This prevents stale or extra frontmatter fields
 * from appearing in the CMS editor.
 */
function filterFieldsBySchema(
	collections: Record<string, CollectionDefinition>,
	schemaBlocks: Array<{ collectionName: string; schemaBody: string }>,
): void {
	for (const { collectionName, schemaBody } of schemaBlocks) {
		const def = collections[collectionName]
		if (!def) continue
		const schemaNames = extractSchemaFieldNames(schemaBody)
		if (schemaNames.size === 0) continue
		def.fields = def.fields.filter(f => schemaNames.has(f.name))
	}
}

/**
 * Apply field type overrides from config parsing to scanned collections.
 */
function applyConfigFieldTypes(
	collections: Record<string, CollectionDefinition>,
	schemaBlocks: Array<{ collectionName: string; schemaBody: string }>,
): void {
	const configTypes = parseContentConfigFieldTypes(schemaBlocks)
	for (const [collectionName, fieldTypes] of configTypes) {
		const def = collections[collectionName]
		if (!def) continue
		for (const [fieldName, override] of fieldTypes) {
			const field = def.fields.find(f => f.name === fieldName)
			if (!field) continue
			field.type = override.type
			if (override.options) {
				field.options = override.options
			}
		}
	}
}

/**
 * After all collections are scanned, detect reference fields.
 * Prefers explicit reference() declarations from the content config file.
 * Falls back to heuristic slug matching when no config is available.
 */
async function detectReferenceFields(
	collections: Record<string, CollectionDefinition>,
	schemaBlocks: Array<{ collectionName: string; schemaBody: string }>,
): Promise<void> {
	// Try parsing the content config first — this is the source of truth
	const configRefs = parseContentConfigReferences(schemaBlocks)
	if (configRefs.size > 0) {
		for (const [collectionName, fieldRefs] of configRefs) {
			const def = collections[collectionName]
			if (!def) continue
			for (const [fieldName, ref] of fieldRefs) {
				const field = def.fields.find(f => f.name === fieldName)
				if (!field) continue
				if (ref.isArray) {
					field.type = 'array'
					field.itemType = 'reference'
				} else {
					field.type = 'reference'
				}
				field.collection = ref.target
				field.options = undefined
			}
		}
		return
	}

	// Fallback: heuristic detection by matching field values against collection slugs
	detectReferenceFieldsBySlugMatch(collections)
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
async function scanDataCollection(collectionPath: string, collectionName: string, contentDir: string): Promise<CollectionDefinition | null> {
	try {
		const entries = await fs.readdir(collectionPath, { withFileTypes: true })
		const dataFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.json') || e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
		if (dataFiles.length === 0) return null

		const fieldMap = new Map<string, FieldObservation>()
		const entryInfos: CollectionEntryInfo[] = []
		const ext = dataFiles.some(file => file.name.endsWith('.json'))
			? 'json' as const
			: dataFiles.some(file => file.name.endsWith('.yaml'))
			? 'yaml' as const
			: 'yml' as const

		const fileContents = await Promise.all(
			dataFiles.map(file => fs.readFile(path.join(collectionPath, file.name), 'utf-8').catch(() => null)),
		)

		for (let i = 0; i < dataFiles.length; i++) {
			const file = dataFiles[i]!
			const raw = fileContents[i]!
			if (raw === null) continue
			let data: Record<string, unknown> | null = null
			try {
				data = file.name.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw) as Record<string, unknown>
			} catch {
				continue
			}
			if (!data || typeof data !== 'object') continue

			const slug = file.name.replace(/\.(json|ya?ml)$/, '')
			const title = typeof data.name === 'string' ? data.name : typeof data.title === 'string' ? data.title : undefined
			entryInfos.push({ slug, title, sourcePath: path.join(contentDir, collectionName, file.name), data })

			collectFieldObservations(fieldMap, data, dataFiles.length)
		}

		return buildCollectionDefinition(collectionName, contentDir, fieldMap, entryInfos, dataFiles.length, {
			type: 'data',
			fileExtension: ext,
		})
	} catch {
		return null
	}
}

/**
 * Scan all collections in the content directory
 */
export async function scanCollections(contentDir: string = 'src/content'): Promise<Record<string, CollectionDefinition>> {
	const projectRoot = getProjectRoot()
	const fullContentDir = path.isAbsolute(contentDir) ? contentDir : path.join(projectRoot, contentDir)

	const collections: Record<string, CollectionDefinition> = {}

	try {
		const entries = await fs.readdir(fullContentDir, { withFileTypes: true })

		const scanPromises = entries
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
			.map(async entry => {
				const collectionPath = path.join(fullContentDir, entry.name)
				const definition = await scanCollection(collectionPath, entry.name, contentDir)
					?? await scanDataCollection(collectionPath, entry.name, contentDir)
				if (definition) {
					collections[entry.name] = definition
				}
			})

		await Promise.all(scanPromises)
	} catch {
		// Content directory doesn't exist or isn't readable
	}

	// Post-scan: apply explicit type hints, detect references, and derived fields
	const schemaBlocks = await parseContentConfigSchemaBlocks()
	filterFieldsBySchema(collections, schemaBlocks)
	applyConfigFieldTypes(collections, schemaBlocks)
	await detectReferenceFields(collections, schemaBlocks)
	detectDerivedHrefFields(collections)

	return collections
}
