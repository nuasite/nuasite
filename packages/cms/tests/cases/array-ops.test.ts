import { describe, expect, test } from 'bun:test'
import {
	buildMapPattern,
	detectArrayPattern,
	extractArrayElementProps,
	findArrayDeclaration,
	generateObjectLiteral,
	parseInlineArrayName,
} from '../../src/handlers/array-ops'

describe('parseInlineArrayName', () => {
	test('returns null for non-array component name', () => {
		expect(parseInlineArrayName('Card')).toBeNull()
		expect(parseInlineArrayName('MyComponent')).toBeNull()
	})

	test('parses simple array name', () => {
		const result = parseInlineArrayName('__array:items')
		expect(result).toEqual({ arrayVarName: 'items', mapOccurrence: 0 })
	})

	test('parses array name with #N suffix', () => {
		const result = parseInlineArrayName('__array:packages#2')
		expect(result).toEqual({ arrayVarName: 'packages', mapOccurrence: 2 })
	})

	test('parses array name with #0 suffix', () => {
		const result = parseInlineArrayName('__array:items#0')
		expect(result).toEqual({ arrayVarName: 'items', mapOccurrence: 0 })
	})

	test('returns null for invalid #suffix like #abc', () => {
		expect(parseInlineArrayName('__array:items#abc')).toBeNull()
		expect(parseInlineArrayName('__array:items#foo2')).toBeNull()
	})
})

describe('buildMapPattern', () => {
	test('without varName uses capture group', () => {
		const re = new RegExp(buildMapPattern())
		const match = '{items.map('.match(re)
		expect(match).not.toBeNull()
		expect(match![1]).toBe('items')
	})

	test('with varName matches exact name', () => {
		const re = new RegExp(buildMapPattern('items'))
		expect(re.test('{items.map(')).toBe(true)
		expect(re.test('{other.map(')).toBe(false)
	})

	test('requires opening brace', () => {
		const re = new RegExp(buildMapPattern())
		expect(re.test('items.map(')).toBe(false)
	})

	test('supports optional chaining', () => {
		const re = new RegExp(buildMapPattern())
		const match = '{items?.map('.match(re)
		expect(match).not.toBeNull()
		expect(match![1]).toBe('items')
	})

	test('supports dotted property paths', () => {
		const re = new RegExp(buildMapPattern())
		const match = '{data.items.map('.match(re)
		expect(match).not.toBeNull()
		expect(match![1]).toBe('items')
	})

	test('supports deep dotted paths like Astro.props', () => {
		const re = new RegExp(buildMapPattern())
		const match = '{Astro.props.items.map('.match(re)
		expect(match).not.toBeNull()
		expect(match![1]).toBe('items')
	})

	test('with varName matches dotted path ending in varName', () => {
		const re = new RegExp(buildMapPattern('items'))
		expect(re.test('{data.items.map(')).toBe(true)
		expect(re.test('{Astro.props.items.map(')).toBe(true)
		expect(re.test('{data.other.map(')).toBe(false)
	})
})

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

describe('findArrayDeclaration', () => {
	test('returns empty bounds for empty array', () => {
		const frontmatter = `const items = []`
		const result = findArrayDeclaration(frontmatter, 1, 'items')
		expect(result).toEqual([])
	})

	test('skips spread elements and only returns concrete items', () => {
		const frontmatter = `const items = [
	...existing,
	{ name: 'new' },
]`
		const result = findArrayDeclaration(frontmatter, 1, 'items')
		expect(result).not.toBeNull()
		expect(result!.length).toBe(1) // Only the object, not the spread
	})
})

describe('generateObjectLiteral', () => {
	test('generates null for null values (not undefined)', () => {
		const result = generateObjectLiteral({ name: 'A', extra: null })
		expect(result).toContain('null')
		expect(result).not.toContain('undefined')
	})

	test('generates undefined for undefined values', () => {
		const result = generateObjectLiteral({ name: 'A', extra: undefined })
		expect(result).toContain('undefined')
	})

	test('generates empty object for no props', () => {
		expect(generateObjectLiteral({})).toBe('{}')
	})

	test('generates single-line for small objects', () => {
		const result = generateObjectLiteral({ name: 'hello', slug: 'hi' })
		expect(result).toBe("{ name: 'hello', slug: 'hi' }")
	})

	test('handles nested arrays', () => {
		const result = generateObjectLiteral({ tags: ['a', 'b'] })
		expect(result).toContain("['a', 'b']")
	})

	test('escapes backslashes in string values', () => {
		const result = generateObjectLiteral({ path: 'C:\\Users\\test' })
		expect(result).toContain("'C:\\\\Users\\\\test'")
	})

	test('escapes both backslashes and single quotes', () => {
		const result = generateObjectLiteral({ text: "it's a \\path" })
		expect(result).toContain("'it\\'s a \\\\path'")
	})
})
