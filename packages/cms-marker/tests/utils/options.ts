/**
 * Options utilities for CMS marker tests.
 *
 * Provides default options and factory functions for creating
 * ProcessHtmlOptions configurations.
 */

import type { ProcessHtmlOptions } from '../../src/html-processor'

/**
 * Default options for processHtml tests.
 * Use spread operator to override specific options.
 */
export const defaultProcessHtmlOptions: ProcessHtmlOptions = {
	attributeName: 'data-cms-id',
	includeTags: null,
	excludeTags: [],
	includeEmptyText: false,
	generateManifest: false,
}

/**
 * Creates processHtml options with overrides.
 *
 * @param overrides - Partial options to override defaults
 */
export function createOptions(overrides: Partial<ProcessHtmlOptions> = {}): ProcessHtmlOptions {
	return {
		...defaultProcessHtmlOptions,
		...overrides,
	}
}

/**
 * Pre-configured options for common test scenarios.
 *
 * @example
 * const result = await processHtml(html, 'test.html', options.withManifest())
 */
export const options = {
	/** Default options with manifest generation */
	withManifest: () => createOptions({ generateManifest: true }),

	/** Options for component detection tests */
	withComponents: (overrides: Partial<ProcessHtmlOptions> = {}) => createOptions({ markComponents: true, generateManifest: true, ...overrides }),

	/** Options for styled span tests */
	withStyledSpans: () => createOptions({ markStyledSpans: true }),

	/** Options for markdown/collection tests */
	withCollection: (collectionInfo: ProcessHtmlOptions['collectionInfo']) => createOptions({ generateManifest: true, collectionInfo }),
}
