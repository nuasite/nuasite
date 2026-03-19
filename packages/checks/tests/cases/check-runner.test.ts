import { describe, expect, test } from 'bun:test'
import { CheckRunner } from '../../src/check-runner'
import type { Check, PageCheckContext, ResolvedChecksOptions } from '../../src/types'

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
		...overrides,
	}
}

function makeCheck(id: string, essential: boolean, results: () => any[]): Check {
	return {
		kind: 'page',
		id,
		name: id,
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'test check',
		essential,
		run: () => results(),
	}
}

const dummyCtx = {} as PageCheckContext

describe('CheckRunner', () => {
	test('runs all checks in full mode', () => {
		const options = makeOptions({ mode: 'full' })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ checkId: 'a', severity: 'warning', message: 'a', pagePath: '/', domain: 'seo', ruleName: 'a' }]))
		runner.registerCheck(
			makeCheck('b', false, () => [{ checkId: 'b', severity: 'warning', message: 'b', pagePath: '/', domain: 'seo', ruleName: 'b' }]),
		)

		const results = runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(2)
	})

	test('skips non-essential checks in essential mode', () => {
		const options = makeOptions({ mode: 'essential' })
		const runner = new CheckRunner(options, false)

		runner.registerCheck(makeCheck('a', true, () => [{ checkId: 'a', severity: 'warning', message: 'a', pagePath: '/', domain: 'seo', ruleName: 'a' }]))
		runner.registerCheck(
			makeCheck('b', false, () => [{ checkId: 'b', severity: 'warning', message: 'b', pagePath: '/', domain: 'seo', ruleName: 'b' }]),
		)

		const results = runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(1)
		expect(results[0]?.checkId).toBe('a')
	})

	test('auto mode uses essential when not CI', () => {
		const options = makeOptions({ mode: 'auto' })
		const runner = new CheckRunner(options, false)

		runner.registerCheck(makeCheck('a', true, () => [{ checkId: 'a', severity: 'warning', message: 'a', pagePath: '/', domain: 'seo', ruleName: 'a' }]))
		runner.registerCheck(
			makeCheck('b', false, () => [{ checkId: 'b', severity: 'warning', message: 'b', pagePath: '/', domain: 'seo', ruleName: 'b' }]),
		)

		const results = runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(1)
	})

	test('auto mode uses full when CI', () => {
		const options = makeOptions({ mode: 'auto' })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ checkId: 'a', severity: 'warning', message: 'a', pagePath: '/', domain: 'seo', ruleName: 'a' }]))
		runner.registerCheck(
			makeCheck('b', false, () => [{ checkId: 'b', severity: 'warning', message: 'b', pagePath: '/', domain: 'seo', ruleName: 'b' }]),
		)

		const results = runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(2)
	})

	test('applies severity overrides', () => {
		const options = makeOptions({ overrides: { 'a': 'info' } })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ checkId: 'a', severity: 'error', message: 'a', pagePath: '/', domain: 'seo', ruleName: 'a' }]))

		const results = runner.runPageChecks(dummyCtx)
		expect(results[0]?.severity).toBe('info')
	})

	test('disables checks via overrides', () => {
		const options = makeOptions({ overrides: { 'a': false } })
		const runner = new CheckRunner(options, true)

		runner.registerCheck(makeCheck('a', true, () => [{ checkId: 'a', severity: 'error', message: 'a', pagePath: '/', domain: 'seo', ruleName: 'a' }]))

		const results = runner.runPageChecks(dummyCtx)
		expect(results).toHaveLength(0)
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
