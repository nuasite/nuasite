/**
 * Config tests
 *
 * Tests for the global configuration module that manages
 * the project root directory override.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getProjectRoot, resetProjectRoot, setProjectRoot } from '../../src/config'

describe('config', () => {
	// Reset after each test to ensure clean state
	afterEach(() => {
		resetProjectRoot()
	})

	// --------------------------------------------------------------------------
	// getProjectRoot
	// --------------------------------------------------------------------------

	describe('getProjectRoot', () => {
		test('should return process.cwd() by default', () => {
			const result = getProjectRoot()

			expect(result).toBe(process.cwd())
		})

		test('should return override when set', () => {
			setProjectRoot('/custom/path')

			const result = getProjectRoot()

			expect(result).toBe('/custom/path')
		})

		test('should return process.cwd() after reset', () => {
			setProjectRoot('/custom/path')
			resetProjectRoot()

			const result = getProjectRoot()

			expect(result).toBe(process.cwd())
		})
	})

	// --------------------------------------------------------------------------
	// setProjectRoot
	// --------------------------------------------------------------------------

	describe('setProjectRoot', () => {
		test('should set the project root override', () => {
			setProjectRoot('/my/project')

			expect(getProjectRoot()).toBe('/my/project')
		})

		test('should override previous value', () => {
			setProjectRoot('/first/path')
			setProjectRoot('/second/path')

			expect(getProjectRoot()).toBe('/second/path')
		})

		test('should accept relative paths', () => {
			setProjectRoot('./relative/path')

			expect(getProjectRoot()).toBe('./relative/path')
		})

		test('should accept empty string', () => {
			setProjectRoot('')

			expect(getProjectRoot()).toBe('')
		})

		test('should handle paths with spaces', () => {
			setProjectRoot('/path/with spaces/project')

			expect(getProjectRoot()).toBe('/path/with spaces/project')
		})

		test('should handle Windows-style paths', () => {
			setProjectRoot('C:\\Users\\test\\project')

			expect(getProjectRoot()).toBe('C:\\Users\\test\\project')
		})
	})

	// --------------------------------------------------------------------------
	// resetProjectRoot
	// --------------------------------------------------------------------------

	describe('resetProjectRoot', () => {
		test('should clear the override', () => {
			setProjectRoot('/custom/path')
			resetProjectRoot()

			expect(getProjectRoot()).toBe(process.cwd())
		})

		test('should be safe to call multiple times', () => {
			resetProjectRoot()
			resetProjectRoot()
			resetProjectRoot()

			expect(getProjectRoot()).toBe(process.cwd())
		})

		test('should be safe to call when no override set', () => {
			// No setProjectRoot called
			resetProjectRoot()

			expect(getProjectRoot()).toBe(process.cwd())
		})
	})

	// --------------------------------------------------------------------------
	// Integration scenarios
	// --------------------------------------------------------------------------

	describe('integration scenarios', () => {
		test('should support test isolation pattern', () => {
			// Simulate test setup
			const testDir = '/tmp/test-project'
			setProjectRoot(testDir)

			// During test
			expect(getProjectRoot()).toBe(testDir)

			// Simulate test teardown
			resetProjectRoot()

			// Back to normal
			expect(getProjectRoot()).toBe(process.cwd())
		})

		test('should support nested test contexts', () => {
			const outerDir = '/outer/project'
			const innerDir = '/inner/project'

			setProjectRoot(outerDir)
			expect(getProjectRoot()).toBe(outerDir)

			// Inner context overrides
			setProjectRoot(innerDir)
			expect(getProjectRoot()).toBe(innerDir)

			// Reset goes back to cwd, not outer
			resetProjectRoot()
			expect(getProjectRoot()).toBe(process.cwd())
		})
	})
})
