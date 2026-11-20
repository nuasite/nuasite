import { describe, expect, test } from 'bun:test'
import {
	checkScriptSource,
	parseScriptWithBabel,
	type ScriptSyntaxError,
	type SourceCheckPorts,
	type SourceKind,
	sourceKind,
} from '../src/check-source'

// Generated line 3, column 0 comes from source line 4, column 0 (`;;AAGA`).
const MAP = JSON.stringify({ version: 3, sources: ['Header.astro'], names: [], mappings: ';;AAGA' })

function ports(parse: (code: string, loader: 'ts' | 'tsx') => ScriptSyntaxError | null, compiled = 'compiled'): SourceCheckPorts {
	return {
		compileAstro: async () => ({ code: compiled, map: MAP }),
		parseScript: async (code, loader) => parse(code, loader),
	}
}

describe('checkScriptSource', () => {
	test('a component is compiled first, and the emitted code is what gets parsed', async () => {
		const seen: { code: string; loader: string }[] = []
		const finding = await checkScriptSource(
			'src/Header.astro',
			'<header />',
			'astro',
			ports((code, loader) => {
				seen.push({ code, loader })
				return null
			}, 'emitted'),
		)
		expect(finding).toBeNull()
		expect(seen).toEqual([{ code: 'emitted', loader: 'ts' }])
	})

	test("an error in the emitted code is reported at the component's own line", async () => {
		const finding = await checkScriptSource('src/Header.astro', '', 'astro', ports(() => ({ message: 'Unexpected token', line: 3, column: 0 })))
		expect(finding).toEqual({ severity: 'error', code: 'code/syntax', file: 'src/Header.astro', line: 4, column: 1, message: 'Unexpected token' })
	})

	test('a position the map does not cover is left out rather than pointing into generated code', async () => {
		const finding = await checkScriptSource('src/Header.astro', '', 'astro', ports(() => ({ message: 'Unexpected token', line: 40, column: 2 })))
		expect(finding).toEqual({ severity: 'error', code: 'code/syntax', file: 'src/Header.astro', message: 'Unexpected token' })
	})

	test('a compiler that gives up is reported as such, by the first line of its message', async () => {
		const failing: SourceCheckPorts = {
			compileAstro: async () => {
				throw new Error('Unterminated frontmatter\nat line 1')
			},
			parseScript: async () => null,
		}
		expect(await checkScriptSource('src/Header.astro', '---', 'astro', failing)).toEqual({
			severity: 'error',
			code: 'code/astro-parse',
			file: 'src/Header.astro',
			message: 'Unterminated frontmatter',
		})
	})

	test('an error the parser gives no position for names the file without one', async () => {
		expect(await checkScriptSource('src/a.ts', 'x', 'ts', ports(() => ({ message: 'Syntax Error' })))).toEqual({
			severity: 'error',
			code: 'code/syntax',
			file: 'src/a.ts',
			message: 'Syntax Error',
		})
	})

	test('a compiler port that rejects with a plain object is reported by its message', async () => {
		const failing: SourceCheckPorts = {
			compileAstro: () => Promise.reject({ message: 'The compiler service failed' }),
			parseScript: async () => null,
		}
		expect(await checkScriptSource('src/A.astro', '', 'astro', failing)).toMatchObject({
			code: 'code/astro-parse',
			message: 'The compiler service failed',
		})
	})

	test('a script is parsed as it is, with its loader, and its column made 1-based', async () => {
		const loaders: string[] = []
		const parse = (_code: string, loader: 'ts' | 'tsx') => {
			loaders.push(loader)
			return { message: 'Expected ")"', line: 2, column: 4 }
		}
		expect(await checkScriptSource('src/menu.tsx', 'x', 'tsx', ports(parse))).toEqual({
			severity: 'error',
			code: 'code/syntax',
			file: 'src/menu.tsx',
			line: 2,
			column: 5,
			message: 'Expected ")"',
		})
		expect(loaders).toEqual(['tsx'])
	})

	test('the compiler is told the filename it is given, and the finding names the file', async () => {
		const filenames: string[] = []
		const named: SourceCheckPorts = {
			compileAstro: async (_source, filename) => {
				filenames.push(filename)
				return { code: '', map: MAP }
			},
			parseScript: async () => ({ message: 'x' }),
		}
		expect(await checkScriptSource('src/A.astro', '', 'astro', named, '/site/src/A.astro')).toMatchObject({ file: 'src/A.astro' })
		expect(filenames).toEqual(['/site/src/A.astro'])
	})
})

describe('sourceKind', () => {
	test.each<[string, SourceKind]>([
		['src/components/Header.astro', 'astro'],
		['src/lib/a.ts', 'ts'],
		['src/lib/a.mts', 'ts'],
		['src/lib/a.cts', 'ts'],
		['src/lib/a.tsx', 'tsx'],
		['src/styles/site.css', 'css'],
		['src\\styles\\site.css', 'css'],
	])('%s is read as %s', (file, kind) => {
		expect(sourceKind(file)).toBe(kind)
	})

	test.each([
		'src/env.d.ts',
		'src/types.d.mts',
		'node_modules/x/index.ts',
		'dist/page.astro',
		'.astro/types.ts',
		'public/vendor.css',
		'src/content/blog/post.md',
		'src/scripts/menu.js',
	])('%s is not read', file => {
		expect(sourceKind(file)).toBeNull()
	})
})

describe('parseScriptWithBabel', () => {
	test('names the position babel stopped at, without repeating it in the message', async () => {
		expect(await parseScriptWithBabel('export const list = [1, 2\n', 'ts')).toEqual({ message: 'Unexpected token, expected ","', line: 2, column: 0 })
	})

	test('reads JSX only with the tsx loader', async () => {
		expect(await parseScriptWithBabel('export const Menu = () => <nav />\n', 'tsx')).toBeNull()
		expect(await parseScriptWithBabel('export const Menu = () => <nav />\n', 'ts')).not.toBeNull()
		expect(await parseScriptWithBabel('export const Menu = () => <nav>\n', 'tsx')).toMatchObject({ line: 1 })
	})

	test('a generic arrow function in TypeScript parses', async () => {
		expect(await parseScriptWithBabel('export const id = <T,>(a: T) => a\n', 'ts')).toBeNull()
	})

	test('decorators and auto-accessors parse, as Bun builds them', async () => {
		expect(await parseScriptWithBabel('const d = (c: unknown) => c\n@d export class A { accessor x = 1 }\n', 'ts')).toBeNull()
		expect(await parseScriptWithBabel('const d = (c: unknown) => c\n@d export class A { accessor x = 1 }\n', 'tsx')).toBeNull()
	})
})
