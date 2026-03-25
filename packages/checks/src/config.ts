import type { ChecksOptions, ResolvedChecksOptions } from './types'

function resolveOption<T extends object>(value: boolean | T | undefined, defaultOptions: T = {} as T): T | false {
	if (value === false) return false
	if (value === true || value === undefined) return defaultOptions
	return value
}

export function resolveChecksOptions(options: ChecksOptions = {}): ResolvedChecksOptions {
	return {
		mode: options.mode ?? 'auto',
		seo: resolveOption(options.seo),
		geo: resolveOption(options.geo),
		performance: resolveOption(options.performance),
		accessibility: resolveOption(options.accessibility),
		ai: options.ai || false,
		failOnError: options.failOnError ?? true,
		failOnWarning: options.failOnWarning ?? false,
		overrides: options.overrides ?? {},
		customChecks: options.customChecks ?? [],
		reportJson: options.reportJson === true
			? 'checks-report.json'
			: typeof options.reportJson === 'string'
			? options.reportJson
			: false,
	}
}
