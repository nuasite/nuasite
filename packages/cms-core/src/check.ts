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

import path from 'node:path'
import yaml from 'yaml'
import { parseContentConfig, type ParsedCollection, type ParsedField } from './content-config-ast'
import type { CmsFileSystem } from './fs/types'

export type CheckSeverity = 'error' | 'warning'

export interface CheckFinding {
	severity: CheckSeverity
	/** Stable slug, e.g. `entry/field-type` — greppable and safe to match on in CI. */
	code: string
	/** Root-relative path of the file the finding is about. */
	file: string
	field?: string
	message: string
}

export interface CheckReport {
	findings: CheckFinding[]
	collections: number
	entries: number
}

const DATA_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])

/** `./content/articles` and `content/articles/` both mean the same directory. */
const normalizeBase = (base: string): string => path.normalize(base).replace(/^\.\//, '').replace(/\/+$/, '')

/** The id Astro's `glob()` loader derives from a file, and therefore what a `reference()` must hold. */
const entryStem = (file: string): string => path.basename(file).replace(/\.(md|mdx|json|ya?ml)$/, '')

const typeName = (value: unknown): string => {
	if (value === null) return 'null'
	if (Array.isArray(value)) return 'array'
	if (value instanceof Date) return 'date'
	return typeof value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
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

async function collectEntryFiles(fs: CmsFileSystem, collection: ParsedCollection, base: string): Promise<string[]> {
	const pattern = collection.loaderPattern ?? '**/*.{md,mdx,json,yaml,yml}'
	const files = await fs.glob(`${base}/${pattern}`)
	return files.filter(file => !path.basename(file).startsWith('_')).sort()
}

function parseEntry(file: string, raw: string): { frontmatter: Record<string, unknown> } | { error: string } {
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
 * Validate every declared collection against what is on disk.
 *
 * Errors are things that fail the build; warnings are things that pass it and then go wrong
 * at render time (a reference pointing at nothing is the documented example).
 */
export async function checkContent(fs: CmsFileSystem): Promise<CheckReport> {
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

	// Resolve every collection's files first: a reference can point at a collection checked later.
	const bases = new Map<string, string>()
	const files = new Map<string, string[]>()
	const stems = new Map<string, Set<string>>()

	for (const [name, collection] of config) {
		const base = normalizeBase(collection.loaderBase ?? `src/content/${name}`)
		bases.set(name, base)
		if (!(await fs.exists(base))) {
			findings.push({
				severity: 'error',
				code: 'config/missing-dir',
				file: 'src/content.config.ts',
				field: name,
				message: `Collection "${name}" loads from ${base}/, which does not exist.`,
			})
			files.set(name, [])
			stems.set(name, new Set())
			continue
		}
		const collectionFiles = await collectEntryFiles(fs, collection, base)
		files.set(name, collectionFiles)
		stems.set(name, new Set(collectionFiles.map(entryStem)))
		if (collectionFiles.length === 0) {
			findings.push({
				severity: 'warning',
				code: 'config/empty-collection',
				file: base,
				field: name,
				message: `Collection "${name}" matched no entries under ${base}/.`,
			})
		}
	}

	let entries = 0

	for (const [name, collection] of config) {
		// A bare `reference()` carries no field type, so it has to be kept explicitly.
		const typedFields = collection.fields.filter(field => field.type !== undefined || field.required || field.reference)

		for (const file of files.get(name) ?? []) {
			entries++
			const parsed = parseEntry(file, await fs.readFile(file))
			if ('error' in parsed) {
				findings.push({ severity: 'error', code: 'entry/syntax', file, message: `Frontmatter does not parse: ${parsed.error}` })
				continue
			}

			for (const field of typedFields) {
				const value = parsed.frontmatter[field.name]

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
			lines.push(`  ${finding.severity === 'error' ? 'error' : 'warn '}  ${finding.message}  [${finding.code}]`)
		}
	}
	return lines.join('\n')
}
