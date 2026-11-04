/**
 * Syntax check for the project's own code.
 *
 * A full build catches these, but it renders every page to get there. What actually fails is the
 * parse: Astro compiles a `.astro` file to TypeScript and the bundler parses that, so compiling
 * and parsing — without rendering anything — reproduces the same class of error in about a second.
 *
 * This is a *syntax* check, not a type check. A wrong prop type or a missing export still needs
 * `astro check` or a build. What it does catch is the error that stops a build dead before a single
 * page renders — an unescaped quote inside a Czech string being the one that prompted it.
 *
 * Stylesheets are parsed the way the build parses them. A Nua site builds with Tailwind's Vite
 * plugin, which runs every stylesheet through Tailwind's CSS parser, Tailwind or not, and that
 * parser refuses what a browser quietly repairs: a rule cut off before its closing brace failed a
 * whole site's build while the editor preview, which concatenates the files, only lost its styles.
 */

import { transform } from '@astrojs/compiler'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import type { CheckFinding } from '@nuasite/cms-core'
import { Glob } from 'bun'
import { createRequire } from 'node:module'
import path from 'node:path'
import { compile as bundledCompile } from 'tailwindcss'

type Compile = typeof bundledCompile

/** Directories that are never the project's own source. */
const IGNORED = ['node_modules', 'dist', '.astro', '.git', '.output', '.vercel', '.netlify']

/** Copied to the output as they are: nothing parses them, so nothing in them can fail a build. */
const UNPROCESSED_STYLESHEETS = ['public']

const isIgnored = (relative: string): boolean =>
	// Declaration files are types only — nothing compiles them, and the TS loader rejects them.
	/\.d\.[mc]?ts$/.test(relative) || relative.split(path.sep).some(segment => IGNORED.includes(segment))

/** Bun's parser reports a `BuildMessage` carrying the offending position in the code it was given. */
interface BuildPosition {
	line?: number
	column?: number
	lineText?: string
}

function buildPosition(error: unknown): BuildPosition | null {
	if (typeof error !== 'object' || error === null || !('position' in error)) return null
	const position = (error as { position: unknown }).position
	return typeof position === 'object' && position !== null ? position as BuildPosition : null
}

/** Bun's `BuildMessage` is not an `Error`, so `String(error)` would prefix the class name. */
function messageOf(error: unknown): string {
	const message = typeof error === 'object' && error !== null && 'message' in error ? (error as { message: unknown }).message : undefined
	return String(typeof message === 'string' ? message : error).split('\n')[0]!
}

/**
 * Map a position in the emitted TypeScript back to the `.astro` source.
 *
 * Without this the position points into generated `$$render` code, which is worse than no position
 * at all — it looks like a real line number and is not one.
 */
function toSource(map: string | undefined, position: BuildPosition | null): { line?: number; column?: number } {
	if (!map || position?.line === undefined) return {}
	try {
		const traced = originalPositionFor(new TraceMap(JSON.parse(map)), {
			line: position.line,
			column: position.column ?? 0,
		})
		if (traced.line === null) return {}
		// trace-mapping columns are 0-based; editors and build output are not.
		return { line: traced.line, column: traced.column + 1 }
	} catch {
		return {}
	}
}

async function checkAstroFile(absolute: string, relative: string, source: string): Promise<CheckFinding | null> {
	let emitted: { code: string; map: string }
	try {
		emitted = await transform(source, { filename: absolute, sourcemap: 'both' })
	} catch (error) {
		return { severity: 'error', code: 'code/astro-parse', file: relative, message: messageOf(error) }
	}

	try {
		new Bun.Transpiler({ loader: 'ts' }).transformSync(emitted.code)
		return null
	} catch (error) {
		const position = buildPosition(error)
		return {
			severity: 'error',
			code: 'code/syntax',
			file: relative,
			...toSource(emitted.map, position),
			message: messageOf(error),
		}
	}
}

function checkScriptFile(relative: string, source: string, loader: 'ts' | 'tsx'): CheckFinding | null {
	try {
		new Bun.Transpiler({ loader }).transformSync(source)
		return null
	} catch (error) {
		const position = buildPosition(error)
		return {
			severity: 'error',
			code: 'code/syntax',
			file: relative,
			line: position?.line,
			column: position?.column === undefined ? undefined : position.column + 1,
			message: messageOf(error),
		}
	}
}

/**
 * The parser's own syntax errors. Compiling a stylesheet alone also reports what only the whole
 * project could settle (`@apply` of a utility its theme defines, a `@reference` it needs), and those
 * are left to the build.
 */
const CSS_SYNTAX_ERROR = /^(Missing closing|Missing opening|Unterminated string|Invalid declaration)/

/** A Tailwind `CssSyntaxError`: its message is `<from>:<line>:<column>: <what>`, its `loc` the offsets into the source. */
function cssSyntaxError(error: unknown): { message: string; offset: number | null } | null {
	if (!(error instanceof Error)) return null
	const message = error.message.replace(/^.*?:\d+:\d+: /, '')
	if (!CSS_SYNTAX_ERROR.test(message)) return null
	const loc = 'loc' in error && Array.isArray(error.loc) ? error.loc : null
	const offset = loc && typeof loc[1] === 'number' ? loc[1] : null
	return { message, offset }
}

/** 1-based line and column of an offset, the way editors and build output count them. */
function lineAndColumn(source: string, offset: number): { line: number; column: number } {
	const before = source.slice(0, offset)
	const line = before.split('\n').length
	return { line, column: offset - before.lastIndexOf('\n') }
}

/**
 * The site's own Tailwind when it has one, else the copy this CLI ships. Its parser's strictness moved between
 * versions (4.0 accepts `color red;`, 4.1 refuses it), and the check has to refuse what the site's build refuses.
 */
async function compileFor(root: string): Promise<Compile> {
	try {
		const module: unknown = await import(createRequire(path.join(root, 'package.json')).resolve('tailwindcss'))
		if (typeof module === 'object' && module !== null && 'compile' in module && typeof module.compile === 'function') {
			return module.compile as Compile
		}
	} catch {
		// Not installed in the site, or not loadable from here: the bundled parser is the next best judge.
	}
	return bundledCompile
}

async function checkCssFile(compile: Compile, absolute: string, relative: string, source: string): Promise<CheckFinding | null> {
	try {
		// Imports and plugins resolve to nothing: each stylesheet is parsed on its own, and loading the
		// project's would only add errors that are not syntax.
		await compile(source, {
			base: path.dirname(absolute),
			from: relative,
			loadStylesheet: async (id, base) => ({ path: id, base, content: '' }),
			loadModule: async (id, base) => ({ path: id, base, module: () => {} }),
		})
		return null
	} catch (error) {
		const syntax = cssSyntaxError(error)
		if (!syntax) return null
		return {
			severity: 'error',
			code: 'code/css-syntax',
			file: relative,
			...(syntax.offset === null ? {} : lineAndColumn(source, syntax.offset)),
			message: syntax.message,
		}
	}
}

export interface CodeCheckResult {
	findings: CheckFinding[]
	files: number
	/** The files parsed, relative to the root: what `--fail-on` can vouch for. */
	paths: string[]
}

/** Parse every `.astro`/`.ts`/`.tsx`/`.css` under `root`; order is by path. */
export async function checkCode(root: string): Promise<CodeCheckResult> {
	const findings: CheckFinding[] = []
	let files = 0

	const paths: string[] = []
	for await (const relative of new Glob('**/*.{astro,ts,tsx,mts,cts,css}').scan({ cwd: root })) {
		if (isIgnored(relative)) continue
		if (relative.endsWith('.css') && UNPROCESSED_STYLESHEETS.includes(relative.split(path.sep)[0]!)) continue
		paths.push(relative)
	}
	paths.sort()

	const compile = paths.some(relative => relative.endsWith('.css')) ? await compileFor(root) : bundledCompile
	for (const relative of paths) {
		files++
		const absolute = path.join(root, relative)
		const source = await Bun.file(absolute).text()
		const finding = relative.endsWith('.astro')
			? await checkAstroFile(absolute, relative, source)
			: relative.endsWith('.css')
			? await checkCssFile(compile, absolute, relative, source)
			: checkScriptFile(relative, source, relative.endsWith('.tsx') ? 'tsx' : 'ts')
		if (finding) findings.push(finding)
	}

	return { findings, files, paths }
}
