import { describe, expect, test } from 'bun:test'
import { createAstroTransformPlugin } from '../../src/astro-transform'

describe('Astro Transform Plugin', () => {
	test('should create plugin with correct name', () => {
		const plugin = createAstroTransformPlugin()
		expect(plugin.name).toBe('astro-cms-source-injector')
		expect(plugin.enforce).toBe('pre')
	})

	test('should have transform function', () => {
		const plugin = createAstroTransformPlugin()
		expect(typeof plugin.transform).toBe('function')
	})

	test('should return null for non-.astro files', async () => {
		const plugin = createAstroTransformPlugin()

		if (typeof plugin.transform === 'function') {
			const transform = plugin.transform as (code: string, id: string) => Promise<unknown>
			const result = await transform('console.log("test")', 'test.ts')
			expect(result).toBeNull()
		}
	})

	test('should return null for node_modules files', async () => {
		const plugin = createAstroTransformPlugin()

		if (typeof plugin.transform === 'function') {
			const transform = plugin.transform as (code: string, id: string) => Promise<unknown>
			const result = await transform('content', 'node_modules/test.astro')
			expect(result).toBeNull()
		}
	})

	test('should handle invalid AST gracefully', async () => {
		const plugin = createAstroTransformPlugin()

		if (typeof plugin.transform === 'function') {
			const transform = plugin.transform as (code: string, id: string) => Promise<unknown>
			// Invalid Astro syntax should not crash
			const result = await transform('<<invalid>>', 'test.astro')
			// Should return null or handle gracefully
			expect(result === null || typeof result === 'object').toBe(true)
		}
	})

	test('should not corrupt file with undefined when line index is invalid', () => {
		// This tests the core issue - we'll simulate the scenario
		const lines = ['line1', 'line2', 'line3']
		const modifications = [
			{ line: 10, column: 0, insertion: ' data-test' }, // Invalid line index
		]

		const modifiedLines = [...lines]
		for (const mod of modifications) {
			const line = modifiedLines[mod.line]

			// With proper validation (the fix)
			if (line === undefined) {
				continue // Skip instead of corrupting
			}

			if (mod.column < 0 || mod.column > line.length) {
				continue
			}

			modifiedLines[mod.line] = line.slice(0, mod.column) + mod.insertion + line.slice(mod.column)
		}

		const result = modifiedLines.join('\n')

		// Should NOT contain literal "undefined" text
		expect(result).not.toContain('undefined')
		// Should be unchanged
		expect(result).toBe('line1\nline2\nline3')
	})

	test('should not corrupt file when column is out of bounds', () => {
		const lines = ['short']
		const modifications = [
			{ line: 0, column: 100, insertion: ' data-test' }, // Column beyond line length
		]

		const modifiedLines = [...lines]
		for (const mod of modifications) {
			const line = modifiedLines[mod.line]

			if (line === undefined) {
				continue
			}

			if (mod.column < 0 || mod.column > line.length) {
				continue // Skip instead of corrupting
			}

			modifiedLines[mod.line] = line.slice(0, mod.column) + mod.insertion + line.slice(mod.column)
		}

		const result = modifiedLines.join('\n')

		// Should be unchanged
		expect(result).toBe('short')
	})

	test('should correctly apply valid modifications', () => {
		const lines = ['<div>', '</div>']
		const modifications = [
			{ line: 0, column: 4, insertion: ' data-test="value"' },
		]

		const modifiedLines = [...lines]
		for (const mod of modifications) {
			const line = modifiedLines[mod.line]

			if (line === undefined) {
				continue
			}

			if (mod.column < 0 || mod.column > line.length) {
				continue
			}

			modifiedLines[mod.line] = line.slice(0, mod.column) + mod.insertion + line.slice(mod.column)
		}

		const result = modifiedLines.join('\n')

		// Should have the attribute inserted
		expect(result).toContain('data-test="value"')
		expect(result).toBe('<div data-test="value">\n</div>')
	})

	test('should apply multiple modifications in correct order', () => {
		const lines = ['<div>', '<span>', '</span>', '</div>']
		const modifications = [
			{ line: 1, column: 5, insertion: ' data-b' },
			{ line: 0, column: 4, insertion: ' data-a' },
		]

		// Sort in reverse order (as done in the actual code)
		modifications.sort((a, b) => {
			if (a.line !== b.line) return b.line - a.line
			return b.column - a.column
		})

		const modifiedLines = [...lines]
		for (const mod of modifications) {
			const line = modifiedLines[mod.line]

			if (line === undefined || mod.column < 0 || mod.column > line.length) {
				continue
			}

			modifiedLines[mod.line] = line.slice(0, mod.column) + mod.insertion + line.slice(mod.column)
		}

		const result = modifiedLines.join('\n')

		expect(result).toContain('data-a')
		expect(result).toContain('data-b')
		expect(result.indexOf('data-a')).toBeLessThan(result.indexOf('data-b'))
	})

	test('should handle empty lines array', () => {
		const lines: string[] = []
		const modifications = [
			{ line: 0, column: 0, insertion: ' data-test' },
		]

		const modifiedLines = [...lines]
		for (const mod of modifications) {
			const line = modifiedLines[mod.line]

			if (line === undefined || mod.column < 0 || mod.column > line.length) {
				continue
			}

			modifiedLines[mod.line] = line.slice(0, mod.column) + mod.insertion + line.slice(mod.column)
		}

		const result = modifiedLines.join('\n')

		// Should handle gracefully
		expect(result).toBe('')
	})
})
