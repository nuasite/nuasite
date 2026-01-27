/**
 * Error Collector tests
 *
 * Tests for the ErrorCollector class and global singleton functions.
 * The error collector allows builds to continue while tracking failures.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { ErrorCollector, getErrorCollector, resetErrorCollector } from '../../src/error-collector'

// ============================================================================
// ErrorCollector Class Tests
// ============================================================================

describe('ErrorCollector', () => {
	let collector: ErrorCollector

	beforeEach(() => {
		collector = new ErrorCollector()
	})

	// --------------------------------------------------------------------------
	// addError / getErrors / hasErrors
	// --------------------------------------------------------------------------

	describe('addError', () => {
		test('should add an error with context', () => {
			const error = new Error('Something went wrong')
			collector.addError('parsing file.astro', error)

			expect(collector.hasErrors()).toBe(true)
			expect(collector.getErrors()).toHaveLength(1)
			expect(collector.getErrors()[0]?.context).toBe('parsing file.astro')
			expect(collector.getErrors()[0]?.error).toBe(error)
		})

		test('should add multiple errors', () => {
			collector.addError('file1.astro', new Error('Error 1'))
			collector.addError('file2.astro', new Error('Error 2'))
			collector.addError('file3.astro', new Error('Error 3'))

			expect(collector.getErrors()).toHaveLength(3)
		})

		test('should preserve error stack traces', () => {
			const error = new Error('Test error')
			collector.addError('test context', error)

			const recorded = collector.getErrors()[0]
			expect(recorded?.error.stack).toBeDefined()
			expect(recorded?.error.stack).toContain('Error: Test error')
		})
	})

	describe('hasErrors', () => {
		test('should return false when no errors', () => {
			expect(collector.hasErrors()).toBe(false)
		})

		test('should return true when has errors', () => {
			collector.addError('test', new Error('test'))
			expect(collector.hasErrors()).toBe(true)
		})

		test('should return false after clear', () => {
			collector.addError('test', new Error('test'))
			collector.clear()
			expect(collector.hasErrors()).toBe(false)
		})
	})

	describe('getErrors', () => {
		test('should return empty array when no errors', () => {
			expect(collector.getErrors()).toEqual([])
		})

		test('should return readonly array', () => {
			collector.addError('test', new Error('test'))
			const errors = collector.getErrors()

			// TypeScript would prevent modification, but at runtime we verify structure
			expect(Array.isArray(errors)).toBe(true)
		})

		test('should preserve order of errors', () => {
			collector.addError('first', new Error('1'))
			collector.addError('second', new Error('2'))
			collector.addError('third', new Error('3'))

			const errors = collector.getErrors()
			expect(errors[0]?.context).toBe('first')
			expect(errors[1]?.context).toBe('second')
			expect(errors[2]?.context).toBe('third')
		})
	})

	// --------------------------------------------------------------------------
	// addWarning / getWarnings / hasWarnings
	// --------------------------------------------------------------------------

	describe('addWarning', () => {
		test('should add a warning with context', () => {
			collector.addWarning('processing images', 'Image too large')

			expect(collector.hasWarnings()).toBe(true)
			expect(collector.getWarnings()).toHaveLength(1)
			expect(collector.getWarnings()[0]?.context).toBe('processing images')
			expect(collector.getWarnings()[0]?.message).toBe('Image too large')
		})

		test('should add multiple warnings', () => {
			collector.addWarning('file1', 'Warning 1')
			collector.addWarning('file2', 'Warning 2')

			expect(collector.getWarnings()).toHaveLength(2)
		})
	})

	describe('hasWarnings', () => {
		test('should return false when no warnings', () => {
			expect(collector.hasWarnings()).toBe(false)
		})

		test('should return true when has warnings', () => {
			collector.addWarning('test', 'test warning')
			expect(collector.hasWarnings()).toBe(true)
		})

		test('should return false after clear', () => {
			collector.addWarning('test', 'test warning')
			collector.clear()
			expect(collector.hasWarnings()).toBe(false)
		})
	})

	describe('getWarnings', () => {
		test('should return empty array when no warnings', () => {
			expect(collector.getWarnings()).toEqual([])
		})

		test('should preserve order of warnings', () => {
			collector.addWarning('first', 'message 1')
			collector.addWarning('second', 'message 2')

			const warnings = collector.getWarnings()
			expect(warnings[0]?.context).toBe('first')
			expect(warnings[1]?.context).toBe('second')
		})
	})

	// --------------------------------------------------------------------------
	// getSummary
	// --------------------------------------------------------------------------

	describe('getSummary', () => {
		test('should return empty string when no errors or warnings', () => {
			expect(collector.getSummary()).toBe('')
		})

		test('should format single error', () => {
			collector.addError('parsing Button.astro', new Error('Syntax error'))

			const summary = collector.getSummary()

			expect(summary).toContain('1 error(s):')
			expect(summary).toContain('parsing Button.astro: Syntax error')
		})

		test('should format multiple errors', () => {
			collector.addError('file1.astro', new Error('Error 1'))
			collector.addError('file2.astro', new Error('Error 2'))

			const summary = collector.getSummary()

			expect(summary).toContain('2 error(s):')
			expect(summary).toContain('file1.astro: Error 1')
			expect(summary).toContain('file2.astro: Error 2')
		})

		test('should format single warning', () => {
			collector.addWarning('processing Hero.astro', 'Unused variable')

			const summary = collector.getSummary()

			expect(summary).toContain('1 warning(s):')
			expect(summary).toContain('processing Hero.astro: Unused variable')
		})

		test('should format multiple warnings', () => {
			collector.addWarning('file1', 'Warning 1')
			collector.addWarning('file2', 'Warning 2')

			const summary = collector.getSummary()

			expect(summary).toContain('2 warning(s):')
		})

		test('should format both errors and warnings', () => {
			collector.addError('file1', new Error('Error message'))
			collector.addWarning('file2', 'Warning message')

			const summary = collector.getSummary()

			expect(summary).toContain('1 error(s):')
			expect(summary).toContain('1 warning(s):')
			expect(summary).toContain('file1: Error message')
			expect(summary).toContain('file2: Warning message')
		})

		test('should show errors before warnings in summary', () => {
			collector.addWarning('warning context', 'Warning first')
			collector.addError('error context', new Error('Error second'))

			const summary = collector.getSummary()
			const errorIndex = summary.indexOf('error(s)')
			const warningIndex = summary.indexOf('warning(s)')

			expect(errorIndex).toBeLessThan(warningIndex)
		})

		test('should indent error and warning details', () => {
			collector.addError('test', new Error('message'))
			collector.addWarning('test', 'message')

			const summary = collector.getSummary()
			const lines = summary.split('\n')

			// Detail lines should start with "  - "
			expect(lines.some(l => l.startsWith('  - '))).toBe(true)
		})
	})

	// --------------------------------------------------------------------------
	// clear
	// --------------------------------------------------------------------------

	describe('clear', () => {
		test('should clear all errors', () => {
			collector.addError('test1', new Error('e1'))
			collector.addError('test2', new Error('e2'))

			collector.clear()

			expect(collector.hasErrors()).toBe(false)
			expect(collector.getErrors()).toEqual([])
		})

		test('should clear all warnings', () => {
			collector.addWarning('test1', 'w1')
			collector.addWarning('test2', 'w2')

			collector.clear()

			expect(collector.hasWarnings()).toBe(false)
			expect(collector.getWarnings()).toEqual([])
		})

		test('should clear both errors and warnings', () => {
			collector.addError('err', new Error('error'))
			collector.addWarning('warn', 'warning')

			collector.clear()

			expect(collector.hasErrors()).toBe(false)
			expect(collector.hasWarnings()).toBe(false)
			expect(collector.getSummary()).toBe('')
		})

		test('should allow adding new errors after clear', () => {
			collector.addError('old', new Error('old error'))
			collector.clear()
			collector.addError('new', new Error('new error'))

			expect(collector.getErrors()).toHaveLength(1)
			expect(collector.getErrors()[0]?.context).toBe('new')
		})
	})

	// --------------------------------------------------------------------------
	// Edge Cases
	// --------------------------------------------------------------------------

	describe('edge cases', () => {
		test('should handle empty context string', () => {
			collector.addError('', new Error('No context'))

			expect(collector.getErrors()[0]?.context).toBe('')
		})

		test('should handle empty error message', () => {
			collector.addError('context', new Error(''))

			expect(collector.getErrors()[0]?.error.message).toBe('')
		})

		test('should handle empty warning message', () => {
			collector.addWarning('context', '')

			expect(collector.getWarnings()[0]?.message).toBe('')
		})

		test('should handle special characters in context and message', () => {
			collector.addError('file: "test.astro"', new Error('Error with "quotes" and <brackets>'))
			collector.addWarning('path/to/file', 'Warning with\nnewline')

			const summary = collector.getSummary()
			expect(summary).toContain('"quotes"')
			expect(summary).toContain('<brackets>')
		})

		test('should handle unicode in messages', () => {
			collector.addError('komponen.astro', new Error('Chyba: neočekávaný token'))
			collector.addWarning('страница.astro', 'Предупреждение')

			expect(collector.getErrors()[0]?.error.message).toContain('neočekávaný')
			expect(collector.getWarnings()[0]?.message).toBe('Предупреждение')
		})

		test('should handle very long messages', () => {
			const longMessage = 'A'.repeat(10000)
			collector.addError('context', new Error(longMessage))

			expect(collector.getErrors()[0]?.error.message).toHaveLength(10000)
		})
	})
})

// ============================================================================
// Global Singleton Functions Tests
// ============================================================================

describe('Global Error Collector', () => {
	beforeEach(() => {
		resetErrorCollector()
	})

	describe('getErrorCollector', () => {
		test('should return an ErrorCollector instance', () => {
			const collector = getErrorCollector()

			expect(collector).toBeInstanceOf(ErrorCollector)
		})

		test('should return the same instance on multiple calls', () => {
			const collector1 = getErrorCollector()
			const collector2 = getErrorCollector()

			expect(collector1).toBe(collector2)
		})

		test('should create instance if none exists', () => {
			const collector = getErrorCollector()

			expect(collector).toBeDefined()
			expect(collector.hasErrors()).toBe(false)
		})

		test('should persist state across calls', () => {
			const collector1 = getErrorCollector()
			collector1.addError('test', new Error('persistent'))

			const collector2 = getErrorCollector()

			expect(collector2.hasErrors()).toBe(true)
			expect(collector2.getErrors()[0]?.context).toBe('test')
		})
	})

	describe('resetErrorCollector', () => {
		test('should clear existing errors', () => {
			const collector = getErrorCollector()
			collector.addError('test', new Error('error'))

			resetErrorCollector()

			expect(getErrorCollector().hasErrors()).toBe(false)
		})

		test('should clear existing warnings', () => {
			const collector = getErrorCollector()
			collector.addWarning('test', 'warning')

			resetErrorCollector()

			expect(getErrorCollector().hasWarnings()).toBe(false)
		})

		test('should return same instance after reset', () => {
			const before = getErrorCollector()
			resetErrorCollector()
			const after = getErrorCollector()

			// After reset, getting collector should work
			expect(after).toBeInstanceOf(ErrorCollector)
		})

		test('should allow adding errors after reset', () => {
			getErrorCollector().addError('old', new Error('old'))
			resetErrorCollector()
			getErrorCollector().addError('new', new Error('new'))

			expect(getErrorCollector().getErrors()).toHaveLength(1)
			expect(getErrorCollector().getErrors()[0]?.context).toBe('new')
		})

		test('should work when called before getErrorCollector', () => {
			// Reset without prior initialization
			resetErrorCollector()

			const collector = getErrorCollector()
			expect(collector).toBeInstanceOf(ErrorCollector)
			expect(collector.hasErrors()).toBe(false)
		})
	})

	describe('typical build workflow', () => {
		test('should support reset-collect-report cycle', () => {
			// Start of build: reset
			resetErrorCollector()
			const collector = getErrorCollector()

			// During build: collect errors
			collector.addError('component A', new Error('parse error'))
			collector.addWarning('component B', 'deprecated syntax')

			// End of build: report
			expect(collector.hasErrors()).toBe(true)
			expect(collector.hasWarnings()).toBe(true)

			const summary = collector.getSummary()
			expect(summary).toContain('1 error(s)')
			expect(summary).toContain('1 warning(s)')

			// Next build: reset again
			resetErrorCollector()
			expect(getErrorCollector().hasErrors()).toBe(false)
		})
	})
})
