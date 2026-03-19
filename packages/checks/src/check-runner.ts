import type { Check, CheckReport, CheckResult, CheckSeverity, PageCheckContext, ResolvedChecksOptions, SiteCheck, SiteCheckContext } from './types'

export class CheckRunner {
	private pageChecks: Check[] = []
	private siteChecks: SiteCheck[] = []
	private overrides: Record<string, CheckSeverity | false>
	private isEssential: boolean

	constructor(options: ResolvedChecksOptions, isCI: boolean) {
		this.overrides = options.overrides
		this.isEssential = options.mode === 'essential' || (options.mode === 'auto' && !isCI)
	}

	registerCheck(check: Check): void {
		this.pageChecks.push(check)
	}

	registerSiteCheck(check: SiteCheck): void {
		this.siteChecks.push(check)
	}

	runPageChecks(context: PageCheckContext): CheckResult[] {
		const results: CheckResult[] = []
		for (const check of this.pageChecks) {
			if (this.isSkipped(check)) continue
			const checkResults = check.run(context)
			results.push(...this.applyOverrides(check, checkResults))
		}
		return results
	}

	runSiteChecks(context: SiteCheckContext): CheckResult[] {
		const results: CheckResult[] = []
		for (const check of this.siteChecks) {
			if (this.isSkipped(check)) continue
			const checkResults = check.run(context)
			results.push(...this.applyOverrides(check, checkResults))
		}
		return results
	}

	generateReport(results: CheckResult[], totalPages: number): CheckReport {
		const errors: CheckResult[] = []
		const warnings: CheckResult[] = []
		const infos: CheckResult[] = []
		for (const r of results) {
			if (r.severity === 'error') errors.push(r)
			else if (r.severity === 'warning') warnings.push(r)
			else infos.push(r)
		}

		return {
			totalPages,
			totalChecks: this.pageChecks.length + this.siteChecks.length,
			results,
			errors,
			warnings,
			infos,
			passed: errors.length === 0,
		}
	}

	private isSkipped(check: Check | SiteCheck): boolean {
		// Check if disabled via overrides
		if (this.overrides[check.id] === false) return true
		// In essential mode, skip non-essential checks
		if (this.isEssential && !check.essential) return true
		return false
	}

	private applyOverrides(check: Check | SiteCheck, results: CheckResult[]): CheckResult[] {
		const override = this.overrides[check.id]
		if (override) {
			return results.map(r => ({ ...r, severity: override }))
		}
		return results
	}
}
