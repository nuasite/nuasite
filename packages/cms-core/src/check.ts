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

import { assetBaseDir, resolveAssetCandidates } from './asset-paths'
import { isPlainObject, loadCollections, type LoadedEntry } from './check-entries'
import { checkAgainstSchemas } from './check-live'
import { checkFieldShapes } from './check-shape'
import { checkEditorWrites } from './check-write'
import { parseContentConfig, type ParsedCollection, type ParsedField } from './content-config-ast'
import type { CmsFileSystem } from './fs/types'
import { type LiveSchemas, schemaFor } from './schema-port'
import { computePathnameFromSpec } from './shared'

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
	/**
	 * What to change to make the finding go away, when there is a specific answer.
	 *
	 * Separate from `message` because it is a different kind of claim: the message states
	 * what the checker observed, the hint proposes an edit it cannot verify. Rules add one
	 * only where the remedy follows from the evidence — never as a restatement.
	 */
	hint?: string
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

/**
 * The on-disk path an `image` value names, or `null` when it names none: the s3/contember
 * media adapters store absolute URLs, and a `~/…`/`@…` value is a Vite alias, which Astro
 * hands to Vite's resolver (see `astro/src/content/utils.ts`) and this cannot follow.
 * A cache-busting `?v=2`/`#frag` is trimmed off rather than discarding the whole value.
 */
function projectAssetPath(value: string): string | null {
	if (value === '' || value.startsWith('//')) return null
	// A scheme — `https:`, `data:`, `file:`.
	if (/^[a-z][a-z\d+\-.]*:/i.test(value)) return null
	// A Vite alias or a `#imports` subpath — an import specifier, not a path.
	if (/^[~@#]/.test(value)) return null
	const withoutQuery = value.split(/[?#]/)[0] ?? ''
	return withoutQuery === '' ? null : withoutQuery
}

/**
 * Report `image` values pointing at no file, walking nested objects and object-array items
 * the same way the field data is shaped. Resolution goes through `resolveAssetCandidates`
 * with the entry's own directory, which is what `getEntryAsset` serves a relative value
 * from — the check therefore looks exactly where serving the asset looks.
 */
async function checkAssets(
	fs: CmsFileSystem,
	fields: ParsedField[],
	data: Record<string, unknown>,
	file: string,
	prefix: string,
	findings: CheckFinding[],
): Promise<void> {
	for (const field of fields) {
		const value = data[field.name]
		if (value === undefined || value === null) continue
		const label = prefix === '' ? field.name : `${prefix}.${field.name}`

		if (field.type === 'object' && field.fields && isPlainObject(value)) {
			await checkAssets(fs, field.fields, value, file, label, findings)
			continue
		}

		if (field.type === 'array' && field.itemType === 'object' && field.fields && Array.isArray(value)) {
			for (const [index, item] of value.entries()) {
				if (isPlainObject(item)) await checkAssets(fs, field.fields, item, file, `${label}[${index}]`, findings)
			}
			continue
		}

		if (field.type !== 'image' || typeof value !== 'string') continue
		const assetPath = projectAssetPath(value)
		if (assetPath === null) continue

		const candidates = resolveAssetCandidates(assetBaseDir(file), assetPath)
		// No candidates left means the path climbs above the project root — outside what this can judge.
		if (candidates.length === 0) continue

		let found = false
		for (const candidate of candidates) {
			if (await fs.exists(candidate)) {
				found = true
				break
			}
		}
		if (found) continue

		findings.push({
			severity: 'warning',
			code: 'entry/missing-asset',
			file,
			field: label,
			message: `${label}: "${value}" points at no file (tried ${candidates.join(', ')}).`,
		})
	}
}

/**
 * Entries whose declarative `cms.pathname` rule resolves to a URL another entry already took —
 * the later ones render over the first, so only one of them is reachable. A warning, not an
 * error: this builds green and only goes wrong at render time.
 *
 * `collection-scanner.ts` warns about the same thing on the dev-server path; the duplication
 * is deliberate, because this check must stay scanner-free.
 */
function pathnameCollisions(collection: ParsedCollection, entries: LoadedEntry[]): CheckFinding[] {
	// `fragment` needs no guard here — parsing already drops the `pathname` of a fragment collection.
	if (!collection.pathname) return []

	const findings: CheckFinding[] = []
	const firstAt = new Map<string, LoadedEntry>()
	for (const entry of entries) {
		if (!entry.frontmatter) continue
		const pathname = computePathnameFromSpec(collection.pathname, entry.frontmatter)
		// An unresolved spec (a missing/uncoercible field) yields no URL, so there is nothing to collide.
		if (pathname === undefined) continue

		const first = firstAt.get(pathname)
		if (!first) {
			firstAt.set(pathname, entry)
			continue
		}
		findings.push({
			severity: 'warning',
			code: 'entry/pathname-collision',
			file: entry.file,
			field: collection.name,
			// The path, not the stem: bundle entries are all named `index`.
			message: `The pathname rule maps this entry and ${first.file} to ${pathname} — they collide on one page.`,
		})
	}
	return findings
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
		const declared = new Set(collection.fields.map(field => field.name))
		const loadedEntries = collections.get(name)?.entries ?? []
		// `required` is the parser's *default* — it means "no `.optional()` was visible", which is
		// not the same as "the schema insists". A field schema behind an import hides its wrapper
		// and turns that default into an error on content the build accepts. Where the real schema
		// is in hand it answers the question properly, via `entry/schema-rejected`, and the drift
		// itself is reported once against the config by `cms/required-drift`.
		const schemaOwnsRequired = options.schemas !== undefined && schemaFor(options.schemas, name) !== undefined

		for (const entry of loadedEntries) {
			entries++
			const file = entry.file
			if (entry.frontmatter === undefined) {
				findings.push({ severity: 'error', code: 'entry/syntax', file, message: `Frontmatter does not parse: ${entry.parseError}` })
				continue
			}

			for (const field of typedFields) {
				const value = entry.frontmatter[field.name]

				if (value === undefined || value === null) {
					if (field.required && !schemaOwnsRequired) {
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

			await checkAssets(fs, collection.fields, entry.frontmatter, file, '', findings)

			// Only a field list known to be complete can call a key unknown. It is short when the
			// schema never unwrapped at all (renamed import, an unsupported wrapper) and when a
			// spread or computed key was skipped — warning on every key of a valid project is the
			// false positive this check exists to avoid.
			if (declared.size > 0 && !collection.partialFields) {
				for (const key of Object.keys(entry.frontmatter)) {
					if (declared.has(key)) continue
					findings.push({
						severity: 'warning',
						code: 'entry/unknown-key',
						file,
						field: key,
						// Astro's schema strips what it does not declare, so the value is written and then never read.
						message: `"${key}" is not a field of "${name}" — nothing reads it.`,
					})
				}
			}
		}

		findings.push(...pathnameCollisions(collection, loadedEntries))
	}

	if (options.schemas) {
		const input = { config, collections, schemas: options.schemas }
		findings.push(...await checkAgainstSchemas(input), ...await checkEditorWrites(input), ...await checkFieldShapes(input))
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
		// One remedy usually covers a run of findings — five missing fields in one collection get the
		// same sentence. Printed once per run, and reset per file so a block never opens without it.
		let lastHint: string | undefined
		for (const finding of findings) {
			// eslint's shape: position, severity, message, rule. Familiar, and greppable by column.
			const at = finding.line === undefined ? '' : `${finding.line}:${finding.column ?? 0}`
			lines.push(`  ${at.padEnd(8)}${(finding.severity === 'error' ? 'error' : 'warn').padEnd(6)} ${finding.message}  [${finding.code}]`)
			// Indented under its finding, so the proposal never reads as another observation.
			if (finding.hint !== undefined && finding.hint !== lastHint) lines.push(`  ${' '.repeat(14)}→ ${finding.hint}`)
			lastHint = finding.hint
		}
	}
	return lines.join('\n')
}
