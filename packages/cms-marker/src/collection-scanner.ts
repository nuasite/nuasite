import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getProjectRoot } from './config'
import type { CollectionDefinition, FieldDefinition, FieldType } from './types'

/** Regex patterns for type inference */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/
const URL_PATTERN = /^(https?:\/\/|\/)/
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i

/** Maximum unique values before treating as free-form text instead of select */
const MAX_SELECT_OPTIONS = 10

/** Minimum length for textarea detection */
const TEXTAREA_MIN_LENGTH = 200

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

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!match?.[1]) return null

	return parseYaml(match[1]) as Record<string, unknown> | null
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
		if (
			IMAGE_EXTENSIONS.test(value) || key.toLowerCase().includes('image') || key.toLowerCase().includes('thumbnail')
			|| key.toLowerCase().includes('cover')
		) {
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
			}
		}

		fields.push(field)
	}

	return fields
}

/**
 * Scan a single collection directory and infer its schema
 */
async function scanCollection(collectionPath: string, collectionName: string, contentDir: string): Promise<CollectionDefinition | null> {
	try {
		const entries = await fs.readdir(collectionPath, { withFileTypes: true })
		const markdownFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mdx')))

		if (markdownFiles.length === 0) return null

		// Determine file extension (prefer md, use mdx if that's all we have)
		const hasMd = markdownFiles.some(f => f.name.endsWith('.md'))
		const fileExtension: 'md' | 'mdx' = hasMd ? 'md' : 'mdx'

		// Collect field observations across all files
		const fieldMap = new Map<string, FieldObservation>()
		let hasDraft = false

		for (const file of markdownFiles) {
			const filePath = path.join(collectionPath, file.name)
			const content = await fs.readFile(filePath, 'utf-8')
			const frontmatter = parseFrontmatter(content)

			if (!frontmatter) continue

			for (const [key, value] of Object.entries(frontmatter)) {
				if (key === 'draft' && typeof value === 'boolean') {
					hasDraft = true
				}

				let obs = fieldMap.get(key)
				if (!obs) {
					obs = {
						name: key,
						values: [],
						presentCount: 0,
						totalEntries: markdownFiles.length,
					}
					fieldMap.set(key, obs)
				}

				obs.values.push(value)
				obs.presentCount++
			}
		}

		// Update totalEntries for all observations
		for (const obs of fieldMap.values()) {
			obs.totalEntries = markdownFiles.length
		}

		const fields = mergeFieldObservations(Array.from(fieldMap.values()))

		// Generate a human-readable label
		const label = collectionName
			.replace(/[-_]/g, ' ')
			.replace(/\b\w/g, c => c.toUpperCase())

		return {
			name: collectionName,
			label,
			path: path.join(contentDir, collectionName),
			entryCount: markdownFiles.length,
			fields,
			supportsDraft: hasDraft,
			fileExtension,
		}
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
				if (definition) {
					collections[entry.name] = definition
				}
			})

		await Promise.all(scanPromises)
	} catch {
		// Content directory doesn't exist or isn't readable
	}

	return collections
}
