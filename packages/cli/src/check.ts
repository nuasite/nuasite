import { checkContent, type CheckReport, createNodeFs, formatCheckReport, type LiveSchemas } from '@nuasite/cms-core'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { checkCode } from './check-code'
import { loadLiveSchemas } from './live-schema'

export interface CheckOptions {
	cwd: string
	json: boolean
	/** Treat warnings as failures too. Off by default: a dangling reference builds fine. */
	strict: boolean
	/** Skip the code syntax pass — content only. */
	contentOnly: boolean
	/** Validate against the project's real schemas, which means importing and running its content config. */
	live: boolean
}

/**
 * `nua check`'s argv, as options.
 *
 * Pure and exported so the flag combinations are testable: `index.ts` is a top-level-await
 * script that reads `process.argv` and calls `process.exit`, so a test cannot import it.
 */
export function parseCheckArgs(args: string[], cwd: string): CheckOptions {
	const contentOnly = args.includes('--content-only')
	return {
		cwd,
		json: args.includes('--json'),
		strict: args.includes('--strict'),
		contentOnly,
		// Loading the real schemas executes the project's content config — the least content-only thing this command does.
		live: !contentOnly && !args.includes('--no-live'),
	}
}

const ASTRO_CONFIG_NAMES = ['astro.config.ts', 'astro.config.mts', 'astro.config.mjs', 'astro.config.js']

const hasAstroConfig = (dir: string): boolean => ASTRO_CONFIG_NAMES.some(name => existsSync(path.join(dir, name)))

/**
 * The Astro apps to check, relative to `cwd`.
 *
 * Running this at a monorepo root has to work: that is where an agent's workspace and a
 * developer's shell both start, and `bun run build` there builds something else entirely
 * (admin, api, worker). Every `packages/*` app is checked, not just the first — a repo with
 * two sites must not have one of them silently skipped.
 */
export function astroRoots(cwd: string): string[] {
	if (hasAstroConfig(cwd)) return ['.']

	const packagesDir = path.join(cwd, 'packages')
	if (!existsSync(packagesDir)) return []

	return readdirSync(packagesDir, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.sort()
		.filter(name => hasAstroConfig(path.join(packagesDir, name)))
		.map(name => path.join('packages', name))
}

/** Re-root a sub-project's findings on the directory the command was run from. */
function prefixed(report: CheckReport, root: string): CheckReport {
	if (root === '.') return report
	return {
		...report,
		findings: report.findings.map(finding => ({ ...finding, file: path.join(root, finding.file) })),
	}
}

/** The project's real schemas, or the sentence saying why the rules needing them did not run. */
type LiveResult = { schemas: LiveSchemas } | { skipped: string }

async function liveSchemasFor(options: CheckOptions, roots: string[]): Promise<LiveResult> {
	if (options.contentOnly) {
		return { skipped: "--content-only was passed, and reading the real schemas means executing the project's content config." }
	}
	if (!options.live) return { skipped: '--no-live was passed.' }

	const first = roots[0]
	// The `astro:content` stub is process-global and re-exports one project's zod, so a second
	// project would be judged by the first project's schemas — quietly wrong is worse than skipped.
	if (roots.length !== 1 || first === undefined) {
		const where = roots.join(', ')
		return { skipped: `They need exactly one Astro project; this run covers ${roots.length} (${where}). Check each one from its own directory.` }
	}
	return loadLiveSchemas(path.join(options.cwd, first))
}

/** Validate the content collections and return the process exit code. */
export async function check(options: CheckOptions): Promise<number> {
	const roots = astroRoots(options.cwd)

	if (roots.length === 0) {
		console.error(`No astro.config.* found in ${options.cwd} or its packages/*. Run this in an Astro project.`)
		return 1
	}

	const live = await liveSchemasFor(options, roots)
	const schemas = 'schemas' in live ? live.schemas : undefined

	const reports = await Promise.all(roots.map(async root => {
		const absolute = path.join(options.cwd, root)
		const content = prefixed(await checkContent(createNodeFs(absolute), schemas ? { schemas } : {}), root)
		if (options.contentOnly) return { ...content, files: 0 }
		const code = await checkCode(absolute)
		return {
			...content,
			findings: [...content.findings, ...code.findings.map(finding => ({ ...finding, file: path.join(root, finding.file) }))],
			files: code.files,
		}
	}))

	const report: CheckReport = {
		findings: reports.flatMap(one => one.findings),
		collections: reports.reduce((total, one) => total + one.collections, 0),
		entries: reports.reduce((total, one) => total + one.entries, 0),
	}
	const sourceFiles = reports.reduce((total, one) => total + one.files, 0)

	const errors = report.findings.filter(finding => finding.severity === 'error').length
	const warnings = report.findings.length - errors

	if (options.json) {
		// The reason belongs inside the payload: a stray line would break anything parsing this.
		console.log(JSON.stringify({ ...report, roots, liveSchemas: 'schemas' in live ? 'ran' : live.skipped }, null, 2))
	} else {
		const formatted = formatCheckReport(report)
		if (formatted) console.log(formatted + '\n')
		const where = roots.length === 1 && roots[0] === '.' ? '' : ` in ${roots.join(', ')}`
		const code = options.contentOnly ? '' : `, ${sourceFiles} source file(s)`
		const counts = `${report.collections} collection(s), ${report.entries} entries${code}${where}`
		console.log(errors === 0 && warnings === 0 ? `${counts} — no problems found` : `${counts} — ${errors} error(s), ${warnings} warning(s)`)
		// A check that did not run must not read as a pass.
		if ('skipped' in live) console.log(`Live schema rules did not run: ${live.skipped}`)
	}

	return errors > 0 || (options.strict && warnings > 0) ? 1 : 0
}
