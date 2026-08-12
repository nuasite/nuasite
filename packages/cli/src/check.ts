import { checkContent, type CheckReport, createNodeFs, formatCheckReport } from '@nuasite/cms-core'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export interface CheckOptions {
	cwd: string
	json: boolean
	/** Treat warnings as failures too. Off by default: a dangling reference builds fine. */
	strict: boolean
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

/** Validate the content collections and return the process exit code. */
export async function check(options: CheckOptions): Promise<number> {
	const roots = astroRoots(options.cwd)

	if (roots.length === 0) {
		console.error(`No astro.config.* found in ${options.cwd} or its packages/*. Run this in an Astro project.`)
		return 1
	}

	const reports = await Promise.all(
		roots.map(async root => prefixed(await checkContent(createNodeFs(path.join(options.cwd, root))), root)),
	)

	const report: CheckReport = {
		findings: reports.flatMap(one => one.findings),
		collections: reports.reduce((total, one) => total + one.collections, 0),
		entries: reports.reduce((total, one) => total + one.entries, 0),
	}

	const errors = report.findings.filter(finding => finding.severity === 'error').length
	const warnings = report.findings.length - errors

	if (options.json) {
		console.log(JSON.stringify({ ...report, roots }, null, 2))
	} else {
		const formatted = formatCheckReport(report)
		if (formatted) console.log(formatted + '\n')
		const where = roots.length === 1 && roots[0] === '.' ? '' : ` in ${roots.join(', ')}`
		const counts = `${report.collections} collection(s), ${report.entries} entries${where}`
		console.log(errors === 0 && warnings === 0 ? `${counts} — no problems found` : `${counts} — ${errors} error(s), ${warnings} warning(s)`)
	}

	return errors > 0 || (options.strict && warnings > 0) ? 1 : 0
}
