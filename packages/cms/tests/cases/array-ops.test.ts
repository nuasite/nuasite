import { describe, expect, test } from 'bun:test'
import { detectArrayPattern, extractArrayElementProps } from '../../src/handlers/array-ops'

describe('detectArrayPattern', () => {
	test('detects .map() on the same line', () => {
		const lines = [
			'---',
			'const items = [{ name: "a" }]',
			'---',
			'{items.map((item) => <Card {...item} />)}',
		]
		const result = detectArrayPattern(lines, 3)
		expect(result).not.toBeNull()
		expect(result!.arrayVarName).toBe('items')
		expect(result!.mapLineIndex).toBe(3)
	})

	test('detects .map() a few lines above', () => {
		const lines = [
			'---',
			'const packages = [{ name: "a" }]',
			'---',
			'{packages.map((pkg) => (',
			'  <PackageCard',
			'    {...pkg}',
			'  />',
			'))}',
		]
		const result = detectArrayPattern(lines, 4)
		expect(result).not.toBeNull()
		expect(result!.arrayVarName).toBe('packages')
		expect(result!.mapLineIndex).toBe(3)
	})

	test('returns null when no .map() pattern', () => {
		const lines = [
			'<Card name="hello" />',
		]
		const result = detectArrayPattern(lines, 0)
		expect(result).toBeNull()
	})
})

describe('extractArrayElementProps', () => {
	test('extracts string props from array element', () => {
		const frontmatter = `const items = [
	{ name: 'Basic', slug: 'basic' },
	{ name: 'Pro', slug: 'pro' },
]`
		const result = extractArrayElementProps(frontmatter, 'items', 0)
		expect(result).toEqual({ name: 'Basic', slug: 'basic' })

		const result1 = extractArrayElementProps(frontmatter, 'items', 1)
		expect(result1).toEqual({ name: 'Pro', slug: 'pro' })
	})

	test('extracts mixed type props', () => {
		const frontmatter = `const packages = [
	{ name: 'Starter', price: 10, active: true },
	{ name: 'Pro', price: 29, active: false },
]`
		const result = extractArrayElementProps(frontmatter, 'packages', 0)
		expect(result).toEqual({ name: 'Starter', price: 10, active: true })

		const result1 = extractArrayElementProps(frontmatter, 'packages', 1)
		expect(result1).toEqual({ name: 'Pro', price: 29, active: false })
	})

	test('extracts nested object props', () => {
		const frontmatter = `const items = [
	{ name: 'A', meta: { author: 'Alice', year: 2024 } },
]`
		const result = extractArrayElementProps(frontmatter, 'items', 0)
		expect(result).toEqual({ name: 'A', meta: { author: 'Alice', year: 2024 } })
	})

	test('extracts array props within objects', () => {
		const frontmatter = `const items = [
	{ name: 'A', tags: ['fast', 'reliable'] },
]`
		const result = extractArrayElementProps(frontmatter, 'items', 0)
		expect(result).toEqual({ name: 'A', tags: ['fast', 'reliable'] })
	})

	test('handles export const', () => {
		const frontmatter = `export const services = [
	{ title: 'Web Dev', description: 'We build sites' },
]`
		const result = extractArrayElementProps(frontmatter, 'services', 0)
		expect(result).toEqual({ title: 'Web Dev', description: 'We build sites' })
	})

	test('returns null for out-of-bounds index', () => {
		const frontmatter = `const items = [
	{ name: 'Only one' },
]`
		const result = extractArrayElementProps(frontmatter, 'items', 5)
		expect(result).toBeNull()
	})

	test('returns null for non-existent variable', () => {
		const frontmatter = `const items = [{ name: 'A' }]`
		const result = extractArrayElementProps(frontmatter, 'nonExistent', 0)
		expect(result).toBeNull()
	})

	test('returns null for invalid code', () => {
		const result = extractArrayElementProps('this is not valid {{{{', 'items', 0)
		expect(result).toBeNull()
	})

	test('handles template literals without expressions', () => {
		const frontmatter = 'const items = [\n\t{ name: `hello world` },\n]'
		const result = extractArrayElementProps(frontmatter, 'items', 0)
		expect(result).toEqual({ name: 'hello world' })
	})

	test('handles null values', () => {
		const frontmatter = `const items = [
	{ name: 'A', extra: null },
]`
		const result = extractArrayElementProps(frontmatter, 'items', 0)
		expect(result).toEqual({ name: 'A', extra: null })
	})

	test('handles negative numbers', () => {
		const frontmatter = `const items = [
	{ name: 'A', offset: -5 },
]`
		const result = extractArrayElementProps(frontmatter, 'items', 0)
		expect(result).toEqual({ name: 'A', offset: -5 })
	})
})
