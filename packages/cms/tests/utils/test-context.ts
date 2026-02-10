/**
 * Test context and suite creation utilities.
 *
 * Provides helpers for creating test suites with automatic ID reset
 * and convenient process helpers.
 */

import { beforeEach, describe } from 'bun:test'
import type { ProcessHtmlOptions, ProcessHtmlResult } from '../../src/html-processor'
import { processHtml } from '../../src/html-processor'
import { sharedGenerator } from './id-generator'
import { createOptions } from './options'

/**
 * Test context interface providing helpers for CMS tests.
 */
export interface TestContext {
	/** Get next CMS ID (auto-resets before each test) */
	getNextId: () => string
	/** Process HTML with default test options */
	process: (html: string, opts?: Partial<ProcessHtmlOptions>) => Promise<ProcessHtmlResult>
	/** Get current ID count */
	getIdCount: () => number
}

/**
 * Creates a test suite with automatic ID reset before each test.
 * Returns helpers for processing HTML and generating IDs.
 *
 * @param suiteOptions - Default options for all tests in the suite
 *
 * @example
 * const { ctx, setupBeforeEach } = createTestSuite({ generateManifest: true })
 * setupBeforeEach()
 *
 * test('my test', async () => {
 *   const result = await ctx.process('<h1>Hello</h1>')
 * })
 */
export function createTestSuite(suiteOptions: Partial<ProcessHtmlOptions> = {}): {
	ctx: TestContext
	setupBeforeEach: () => void
} {
	const ctx: TestContext = {
		getNextId: sharedGenerator.getNextId,
		getIdCount: sharedGenerator.getCount,
		process: async (html: string, opts: Partial<ProcessHtmlOptions> = {}) => {
			return processHtml(html, 'test.html', createOptions({ ...suiteOptions, ...opts }), sharedGenerator.getNextId)
		},
	}

	return {
		ctx,
		setupBeforeEach: () => {
			beforeEach(() => {
				sharedGenerator.reset()
			})
		},
	}
}

/**
 * Shorthand for creating a describe block with auto-reset.
 *
 * @param name - Test suite name
 * @param suiteOptions - Default options for all tests in the suite
 * @param fn - Test suite function receiving the test context
 *
 * @example
 * cmsDescribe('My Tests', { generateManifest: true }, (ctx) => {
 *   test('my test', async () => {
 *     const result = await ctx.process('<h1>Hello</h1>')
 *     expectMarked(result, 'h1')
 *   })
 * })
 */
export function cmsDescribe(
	name: string,
	suiteOptions: Partial<ProcessHtmlOptions>,
	fn: (ctx: TestContext) => void,
): void {
	describe(name, () => {
		const { ctx, setupBeforeEach } = createTestSuite(suiteOptions)
		setupBeforeEach()
		fn(ctx)
	})
}
