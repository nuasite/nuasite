/**
 * Cache management utilities for integration tests.
 *
 * Provides helpers for clearing caches between tests to ensure
 * test isolation without manual cache management.
 */

import { beforeEach, describe } from 'bun:test'
import { clearSourceFinderCache } from '../../src/source-finder'
import { sharedGenerator } from './id-generator'
import { resetAllCounters } from './test-data'

/**
 * Clears all caches used in cms-marker.
 * Call this in beforeEach for complete test isolation.
 *
 * Clears:
 * - Source finder cache (file contents, AST parses)
 * - Shared ID generator
 * - Test data counters
 */
export function clearAllCaches(): void {
	clearSourceFinderCache()
	sharedGenerator.reset()
	resetAllCounters()
}

/**
 * Sets up automatic cache clearing before each test.
 * Call this at the top of a describe block.
 *
 * @example
 * describe('My Tests', () => {
 *   setupCacheReset()
 *
 *   test('test 1', () => { ... })
 *   test('test 2', () => { ... })
 * })
 */
export function setupCacheReset(): void {
	beforeEach(() => {
		clearAllCaches()
	})
}

/**
 * Creates a describe block with automatic cache reset.
 * Combines describe() with setupCacheReset() for convenience.
 *
 * @param name - Test suite name
 * @param fn - Test suite function
 *
 * @example
 * withCacheReset('Source Finder Tests', () => {
 *   test('finds text', async () => {
 *     // Caches are automatically cleared before this test
 *   })
 * })
 */
export function withCacheReset(
	name: string,
	fn: () => void,
): void {
	describe(name, () => {
		setupCacheReset()
		fn()
	})
}
