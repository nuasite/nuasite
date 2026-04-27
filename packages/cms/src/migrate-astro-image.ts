import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'
import { pickAstroImageTarget } from './astro-image-paths'
import { scanCollections } from './collection-scanner'
import { getProjectRoot } from './config'

export interface MigrationOptions {
	/** When true, report what would change without writing anything. */
	dryRun?: boolean
	/** Override the project root (mostly for tests). Defaults to getProjectRoot(). */
	projectRoot?: string
}

export interface FieldMigration {
	entrySourcePath: string
	fieldName: string
	originalValue: string
	newValue: string
	copiedFrom: string
	copiedTo: string
}

export interface MigrationResult {
	migrations: FieldMigration[]
	skipped: Array<{ entrySourcePath: string; fieldName: string; reason: string }>
}

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/

/** Idempotent — values that are already relative or that don't resolve to a public file are skipped. */
export async function migrateAstroImages(options: MigrationOptions = {}): Promise<MigrationResult> {
	const projectRoot = options.projectRoot ?? getProjectRoot()
	const dryRun = options.dryRun ?? false

	const collections = await scanCollections()
	const migrations: FieldMigration[] = []
	const skipped: MigrationResult['skipped'] = []

	for (const def of Object.values(collections)) {
		const astroFields = def.fields.filter(f => f.astroImage)
		if (astroFields.length === 0 || !def.entries) continue

		for (const entry of def.entries) {
			const entryAbs = path.isAbsolute(entry.sourcePath)
				? entry.sourcePath
				: path.join(projectRoot, entry.sourcePath)

			let raw: string
			try {
				raw = await fs.readFile(entryAbs, 'utf-8')
			} catch {
				skipped.push({ entrySourcePath: entry.sourcePath, fieldName: '*', reason: 'read failed' })
				continue
			}

			const fmMatch = raw.match(FRONTMATTER_RE)
			if (!fmMatch) {
				skipped.push({ entrySourcePath: entry.sourcePath, fieldName: '*', reason: 'no frontmatter' })
				continue
			}
			const [fullFm, fmStart, yamlBody, fmEnd] = fmMatch as unknown as [string, string, string, string]
			const doc = parseDocument(yamlBody)

			let mutated = false
			for (const field of astroFields) {
				const current = doc.get(field.name)
				if (typeof current !== 'string') {
					if (current != null) skipped.push({ entrySourcePath: entry.sourcePath, fieldName: field.name, reason: 'non-string value' })
					continue
				}
				if (!current.startsWith('/') || current.startsWith('//')) continue

				const sourceAbs = path.join(projectRoot, 'public', current.replace(/^\/+/, ''))
				let sourceBuf: Buffer
				try {
					sourceBuf = await fs.readFile(sourceAbs)
				} catch {
					skipped.push({ entrySourcePath: entry.sourcePath, fieldName: field.name, reason: `source missing: ${sourceAbs}` })
					continue
				}

				const target = await pickAstroImageTarget({
					entryAbsPath: entryAbs,
					slug: entry.slug,
					originalFilename: path.basename(current),
					compareBuffer: sourceBuf,
				})

				if (!dryRun) {
					await fs.mkdir(path.dirname(target.absPath), { recursive: true })
					await fs.writeFile(target.absPath, sourceBuf)
				}

				doc.set(field.name, target.relPath)
				mutated = true
				migrations.push({
					entrySourcePath: entry.sourcePath,
					fieldName: field.name,
					originalValue: current,
					newValue: target.relPath,
					copiedFrom: sourceAbs,
					copiedTo: target.absPath,
				})
			}

			if (mutated && !dryRun) {
				const newYaml = doc.toString().replace(/\n$/, '')
				const newRaw = raw.replace(fullFm, `${fmStart}${newYaml}${fmEnd}`)
				await fs.writeFile(entryAbs, newRaw, 'utf-8')
			}
		}
	}

	return { migrations, skipped }
}
