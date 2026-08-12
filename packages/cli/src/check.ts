import { checkContent, createNodeFs, formatCheckReport } from '@nuasite/cms-core'

export interface CheckOptions {
	cwd: string
	json: boolean
	/** Treat warnings as failures too. Off by default: a dangling reference builds fine. */
	strict: boolean
}

/** Validate the content collections and return the process exit code. */
export async function check(options: CheckOptions): Promise<number> {
	const report = await checkContent(createNodeFs(options.cwd))

	if (options.json) {
		console.log(JSON.stringify(report, null, 2))
	} else {
		const formatted = formatCheckReport(report)
		if (formatted) console.log(formatted + '\n')
	}

	const errors = report.findings.filter(finding => finding.severity === 'error').length
	const warnings = report.findings.length - errors

	if (!options.json) {
		const counts = `${report.collections} collection(s), ${report.entries} entries`
		console.log(errors === 0 && warnings === 0 ? `${counts} — no problems found` : `${counts} — ${errors} error(s), ${warnings} warning(s)`)
	}

	return errors > 0 || (options.strict && warnings > 0) ? 1 : 0
}
