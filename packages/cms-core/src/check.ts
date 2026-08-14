/**
 * Content check — validates collections without building the site.
 *
 * `astro sync` is the ground truth, but it costs a cold content-layer parse (20 s on a
 * 1.5k-entry site) and it aborts on the FIRST bad entry. This walks the declared
 * collections directly: it reports every problem in one pass, in about a second, which is
 * what makes it usable as the check an agent runs after an edit instead of a full build.
 *
 * Only fields the content config types explicitly (`n.number()`, `n.select()`, …) are
 * type-checked. A plain zod field parses to `type: undefined` here, and guessing at those
 * would trade the one thing this has to get right — no false positives — for coverage that
 * `astro sync` already provides.
 */

import { isPlainObject, loadCollections } from './check-entries'
import { checkAgainstSchemas } from './check-live'
import { checkEditorWrites } from './check-write'
import { parseContentConfig, type ParsedField } from './content-config-ast'
import type { CmsFileSystem } from './fs/types'
import type { LiveSchemas } from './schema-port'

export type CheckSeverity = 'error' | 'warning'

export interface CheckFinding {
	severity: CheckSeverity
	/** Stable slug, e.g. `entry/field-type` — greppable and safe to match on in CI. */
	code: string
	/** Root-relative path of the file the finding is about. */
	file: string
	/** 1-based position in that file, when the underlying parser reports one. */
	line?: number
	column?: number
	field?: string
	message: string
}

export interface CheckReport {
	findings: CheckFinding[]
	collections: number
	entries: number
}

const typeName = (value: unknown): string => {
	if (value === null) return 'null'
	if (Array.isArray(value)) return 'array'
	if (value instanceof Date) return 'date'
	return typeof value
}

/** Whether a value satisfies a field's declared type. `null` means "no opinion". */
function typeMismatch(field: ParsedField, value: unknown): string | null {
	switch (field.type) {
		case 'number':
		case 'year':
		case 'month':
			return typeof value === 'number' ? null : `expected a number, found ${typeName(value)}`
		case 'boolean':
			return typeof value === 'boolean' ? null : `expected true/false, found ${typeName(value)}`
		case 'select': {
			if (typeof value !== 'string') return `expected one of the allowed values, found ${typeName(value)}`
			const options = field.options ?? []
			if (options.length === 0 || options.includes(value)) return null
			return `"${value}" is not one of: ${options.join(', ')}`
		}
		case 'date':
		case 'datetime':
			if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'is not a valid date' : null
			if (typeof value !== 'string') return `expected a date, found ${typeName(value)}`
			return Number.isNaN(Date.parse(value)) ? `"${value}" is not a valid date` : null
		case 'array':
			return Array.isArray(value) ? null : `expected a list, found ${typeName(value)}`
		case 'object':
			return isPlainObject(value) ? null : `expected an object, found ${typeName(value)}`
		case 'text':
		case 'textarea':
		case 'markdown':
		case 'url':
		case 'email':
		case 'tel':
		case 'color':
		case 'time':
		case 'reference':
			return typeof value === 'string' ? null : `expected text, found ${typeName(value)}`
		// `image`/`file` resolve through astro:assets and may hold an object once processed.
		default:
			return null
	}
}

export interface CheckContentOptions {
	/**
	 * The project's real collection schemas. Given these, the check also reports what the
	 * build would reject and what the editor's next write would break — see `check-live.ts`
	 * and `check-write.ts`. Absent, only the AST/data rules below run.
	 */
	schemas?: LiveSchemas
}

/**
 * Validate every declared collection against what is on disk.
 *
 * Errors are things that fail the build; warnings are things that pass it and then go wrong
 * at render time (a reference pointing at nothing is the documented example).
 */
export async function checkContent(fs: CmsFileSystem, options: CheckContentOptions = {}): Promise<CheckReport> {
	const findings: CheckFinding[] = []
	const config = await parseContentConfig(fs, new Map())

	if (config.size === 0) {
		findings.push({
			severity: 'error',
			code: 'config/no-collections',
			file: 'src/content.config.ts',
			message: 'No collections found — the content config is missing, unreadable, or declares nothing.',
		})
		return { findings, collections: 0, entries: 0 }
	}

	// Read everything first: a reference can point at a collection checked later.
	const collections = await loadCollections(fs, config)
	const stems = new Map<string, Set<string>>()

	for (const [name, loaded] of collections) {
		stems.set(name, new Set(loaded.entries.map(entry => entry.stem)))
		if (!loaded.exists) {
			findings.push({
				severity: 'error',
				code: 'config/missing-dir',
				file: 'src/content.config.ts',
				field: name,
				message: `Collection "${name}" loads from ${loaded.base}/, which does not exist.`,
			})
			continue
		}
		if (loaded.entries.length === 0) {
			findings.push({
				severity: 'warning',
				code: 'config/empty-collection',
				file: loaded.base,
				field: name,
				message: `Collection "${name}" matched no entries under ${loaded.base}/.`,
			})
		}
	}

	let entries = 0

	for (const [name, collection] of config) {
		// A bare `reference()` carries no field type, so it has to be kept explicitly.
		const typedFields = collection.fields.filter(field => field.type !== undefined || field.required || field.reference)

		for (const entry of collections.get(name)?.entries ?? []) {
			entries++
			const file = entry.file
			if (entry.frontmatter === undefined) {
				findings.push({ severity: 'error', code: 'entry/syntax', file, message: `Frontmatter does not parse: ${entry.parseError}` })
				continue
			}

			for (const field of typedFields) {
				const value = entry.frontmatter[field.name]

				if (value === undefined || value === null) {
					if (field.required) {
						findings.push({
							severity: 'error',
							code: 'entry/missing-required',
							file,
							field: field.name,
							message: `Required field "${field.name}" is missing.`,
						})
					}
					continue
				}

				const mismatch = field.type === undefined ? null : typeMismatch(field, value)
				if (mismatch) {
					findings.push({ severity: 'error', code: 'entry/field-type', file, field: field.name, message: `${field.name}: ${mismatch}` })
					continue
				}

				const reference = field.reference
				if (!reference) continue
				const targets = stems.get(reference.target)
				// An unresolvable target collection is already reported once by config/missing-dir.
				if (!targets || targets.size === 0) continue
				const values = reference.isArray ? (Array.isArray(value) ? value : [value]) : [value]
				for (const item of values) {
					if (typeof item !== 'string' || targets.has(item)) continue
					findings.push({
						severity: 'warning',
						code: 'entry/dangling-reference',
						file,
						field: field.name,
						// reference() validates the shape, not the target — a wrong id builds green and renders nothing.
						message: `${field.name}: "${item}" is not an entry of "${reference.target}".`,
					})
				}
			}
		}
	}

	if (options.schemas) {
		const input = { config, collections, schemas: options.schemas }
		findings.push(...await checkAgainstSchemas(input), ...await checkEditorWrites(input))
	}

	return { findings, collections: config.size, entries }
}

/** Human-readable report. Returns '' when there is nothing to say. */
export function formatCheckReport(report: CheckReport): string {
	if (report.findings.length === 0) return ''

	const byFile = new Map<string, CheckFinding[]>()
	for (const finding of report.findings) {
		const bucket = byFile.get(finding.file)
		if (bucket) bucket.push(finding)
		else byFile.set(finding.file, [finding])
	}

	const lines: string[] = []
	for (const [file, findings] of byFile) {
		lines.push(file)
		for (const finding of findings) {
			// eslint's shape: position, severity, message, rule. Familiar, and greppable by column.
			const at = finding.line === undefined ? '' : `${finding.line}:${finding.column ?? 0}`
			lines.push(`  ${at.padEnd(8)}${(finding.severity === 'error' ? 'error' : 'warn').padEnd(6)} ${finding.message}  [${finding.code}]`)
		}
	}
	return lines.join('\n')
}
