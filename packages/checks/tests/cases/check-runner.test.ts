import { describe, expect, test } from 'bun:test'
import { CheckRunner } from '../../src/check-runner'
import type { Check, CheckIssue, PageCheckContext, ResolvedChecksOptions, SiteCheck, SiteCheckContext, SiteCheckIssue } from '../../src/types'

function makeOptions(overrides: Partial<ResolvedChecksOptions> = {}): ResolvedChecksOptions {
	return {
		mode: 'full',
		seo: {},
		geo: {},
		performance: {},
		accessibility: {},
		ai: false,
		failOnError: true,
		failOnWarning: false,
		overrides: {},
		customChecks: [],
		reportJson: false,
		...overrides,
	}
}

function makeCheck(id: string, essential: boolean, issues: () => CheckIssue[]): Check {
	return {
		kind: 'page',
		id,
		name: id,
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'test check',
		essential,
		run: () => issues(),
	}
}

function makeSiteCheck(id: string, essential: boolean, issues: () => SiteCheckIssue[]): SiteCheck {
	return {
		kind: 'site',
		id,
		name: id,
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'test site check',
		essential,
		run: () => issues(),
	}
}

const dummyCtx = { pagePath: '/', filePath: '/dist/index.html', distDir: '/dist' } as PageCheckContext
const dummySiteCtx = { distDir: '/dist', projectRoot: '/project', pages: new Map() } as SiteCheckContext

describe('CheckRunner', () => {
	test('runs all checks in full mode', async () => {
		const options = makeOptions({ mode: 'full' })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ message: 'a' }]))
		runner.registerCheck(makeCheck('b', false, () => [{ message: 'b' }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(2)
	})

	test('enriches results with check metadata', async () => {
		const options = makeOptions({ mode: 'full' })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('test/check', true, () => [{ message: 'test message', suggestion: 'fix it', line: 42 }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(1)
		expect(results[0]!.checkId).toBe('test/check')
		expect(results[0]!.ruleName).toBe('test/check')
		expect(results[0]!.domain).toBe('seo')
		expect(results[0]!.severity).toBe('warning')
		expect(results[0]!.pagePath).toBe('/')
		expect(results[0]!.filePath).toBe('/dist/index.html')
		expect(results[0]!.message).toBe('test message')
		expect(results[0]!.suggestion).toBe('fix it')
		expect(results[0]!.line).toBe(42)
	})

	test('enriches site check results', async () => {
		const options = makeOptions({ mode: 'full' })
		const runner = new CheckRunner(options, true)

		runner.registerSiteCheck(makeSiteCheck('test/site', true, () => [{ message: 'site issue', pagePath: '/robots.txt' }]))

		const results = await runner.runSiteChecks(dummySiteCtx)
		expect(results).toHaveLength(1)
		expect(results[0]!.checkId).toBe('test/site')
		expect(results[0]!.pagePath).toBe('/robots.txt')
	})

	test('skips non-essential checks in essential mode', async () => {
		const options = makeOptions({ mode: 'essential' })
		const runner = new CheckRunner(options, false)

		runner.registerCheck(makeCheck('a', true, () => [{ message: 'a' }]))
		runner.registerCheck(makeCheck('b', false, () => [{ message: 'b' }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(1)
		expect(results[0]?.checkId).toBe('a')
	})

	test('auto mode uses essential when not CI', async () => {
		const options = makeOptions({ mode: 'auto' })
		const runner = new CheckRunner(options, false)

		runner.registerCheck(makeCheck('a', true, () => [{ message: 'a' }]))
		runner.registerCheck(makeCheck('b', false, () => [{ message: 'b' }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(1)
	})

	test('auto mode uses full when CI', async () => {
		const options = makeOptions({ mode: 'auto' })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ message: 'a' }]))
		runner.registerCheck(makeCheck('b', false, () => [{ message: 'b' }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(2)
	})

	test('applies severity overrides', async () => {
		const options = makeOptions({ overrides: { 'a': 'info' } })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ message: 'a' }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results[0]?.severity).toBe('info')
	})

	test('disables checks via overrides', async () => {
		const options = makeOptions({ overrides: { 'a': false } })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ message: 'a' }]))

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(0)
	})

	test('handles async check run methods', async () => {
		const options = makeOptions({ mode: 'full' })
		const runner = new CheckRunner(options, true)

		const asyncCheck: Check = {
			kind: 'page',
			id: 'async-check',
			name: 'Async Check',
			domain: 'seo',
			defaultSeverity: 'warning',
			description: 'async test',
			essential: true,
			async run() {
				return [{ message: 'async result' }]
			},
		}
		runner.registerCheck(asyncCheck)

		const results = await runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(1)
		expect(results[0]!.message).toBe('async result')
	})

	test('generates report with correct counts', () => {
		const options = makeOptions()
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => []))

		const results = [
			{ checkId: 'a', severity: 'error' as const, message: 'err', pagePath: '/', domain: 'seo' as const, ruleName: 'a' },
			{ checkId: 'b', severity: 'warning' as const, message: 'warn', pagePath: '/', domain: 'seo' as const, ruleName: 'b' },
			{ checkId: 'c', severity: 'info' as const, message: 'info', pagePath: '/', domain: 'seo' as const, ruleName: 'c' },
		]

		const report = runner.generateReport(results, 5)
		expect(report.totalPages).toBe(5)
		expect(report.errors).toHaveLength(1)
		expect(report.warnings).toHaveLength(1)
		expect(report.infos).toHaveLength(1)
		expect(report.passed).toBe(false)
	})

	test('report passes when no errors', () => {
		const options = makeOptions()
		const runner = new CheckRunner(options, true)
		const report = runner.generateReport([], 3)
		expect(report.passed).toBe(true)
	})
})
