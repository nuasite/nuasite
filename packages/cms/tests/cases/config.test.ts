/**
 * Config tests
 *
 * Tests for the global configuration module that manages
 * the project root directory override.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getProjectRoot, resetProjectRoot, setProjectRoot } from '../../src/config'
import { projectRelativeSource } from '../../src/source-finder/source-files'

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

		test('resolves a relative path against the working directory', () => {
			setProjectRoot('./relative/path')

			expect(getProjectRoot()).toBe(path.join(process.cwd(), 'relative/path'))
		})

		test('drops a trailing slash, as a root from `fileURLToPath(config.root)` has', () => {
			setProjectRoot(fileURLToPath(pathToFileURL('/my/project/')))

			expect(getProjectRoot()).toBe('/my/project')
		})

		test('a source under a root given with a trailing slash is relative to it', () => {
			setProjectRoot('/my/project/')

			expect(projectRelativeSource('/my/project/src/pages/index.astro')).toBe('src/pages/index.astro')
		})

		test('should handle paths with spaces', () => {
			setProjectRoot('/path/with spaces/project')

			expect(getProjectRoot()).toBe('/path/with spaces/project')
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
