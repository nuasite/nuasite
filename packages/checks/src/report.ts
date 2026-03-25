import type { AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CheckReport, CheckResult } from './types'

export function logReport(report: CheckReport, logger: AstroIntegrationLogger): void {
	const { totalPages, totalChecks, errors, warnings, infos } = report

	if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
		logger.info(`Checked ${totalPages} pages (${totalChecks} rules) — all passed`)
		return
	}

	logger.info(`Checked ${totalPages} pages (${totalChecks} rules)`)

	if (errors.length > 0) {
		logger.error(`${errors.length} error(s):`)
		for (const r of errors) {
			logger.error(formatResult(r))
		}
	}

	if (warnings.length > 0) {
		logger.warn(`${warnings.length} warning(s):`)
		for (const r of warnings) {
			logger.warn(formatResult(r))
		}
	}

	if (infos.length > 0) {
		logger.info(`${infos.length} info(s):`)
		for (const r of infos) {
			logger.info(formatResult(r))
		}
	}

	const parts = [
		errors.length > 0 ? `${errors.length} error(s)` : null,
		warnings.length > 0 ? `${warnings.length} warning(s)` : null,
		infos.length > 0 ? `${infos.length} info(s)` : null,
	].filter(Boolean)

	logger.info(`Summary: ${parts.join(', ')}`)
}

export async function writeJsonReport(report: CheckReport, distDir: string, filename: string): Promise<string> {
	const filePath = path.join(distDir, filename)
	const json = {
		timestamp: new Date().toISOString(),
		totalPages: report.totalPages,
		totalChecks: report.totalChecks,
		passed: report.passed,
		summary: {
			errors: report.errors.length,
			warnings: report.warnings.length,
			infos: report.infos.length,
		},
		results: report.results.map(r => ({
			checkId: r.checkId,
			severity: r.severity,
			domain: r.domain,
			message: r.message,
			suggestion: r.suggestion,
			pagePath: r.pagePath,
			line: r.line,
			actual: r.actual,
			expected: r.expected,
		})),
	}
	await fs.writeFile(filePath, JSON.stringify(json, null, '\t'), 'utf8')
	return filePath
}

function formatResult(r: CheckResult): string {
	const location = r.line ? `${r.pagePath}:${r.line}` : r.pagePath
	const suggestion = r.suggestion ? ` → ${r.suggestion}` : ''
	return `  ${r.checkId.padEnd(30)} ${location.padEnd(30)} ${r.message}${suggestion}`
}
