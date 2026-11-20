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
import { type CheckFinding, checkScriptSource, type ScriptSyntaxError, type SourceCheckPorts, type SourceKind, sourceKind } from '@nuasite/cms-core'
import { Glob } from 'bun'
import { createRequire } from 'node:module'
import path from 'node:path'
import { compile as bundledCompile } from 'tailwindcss'

type Compile = typeof bundledCompile

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

/** Bun's transpiler as the script parser: its positions are 1-based lines and 0-based columns. */
async function parseWithBun(code: string, loader: 'ts' | 'tsx'): Promise<ScriptSyntaxError | null> {
	try {
		new Bun.Transpiler({ loader }).transformSync(code)
		return null
	} catch (error) {
		const position = buildPosition(error)
		return { message: messageOf(error), line: position?.line, column: position?.column }
	}
}

const BUN_PORTS: SourceCheckPorts = {
	compileAstro: (source, filename) => transform(source, { filename, sourcemap: 'both' }),
	parseScript: parseWithBun,
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

export interface CodeCheckOptions {
	/**
	 * May the check load the project's own packages? Its `tailwindcss` is the site's real parser, but loading it runs
	 * the project's installed code, which `--no-live` promises not to do; the bundled parser stands in then.
	 */
	projectCode: boolean
	/** Parse only these files, relative to the root; null parses every source file of the project. */
	only?: ReadonlySet<string> | null
}

/** Parse every `.astro`/`.ts`/`.tsx`/`.css` under `root`, or those of them in `only`; order is by path. */
export async function checkCode(root: string, { projectCode, only = null }: CodeCheckOptions = { projectCode: false }): Promise<CodeCheckResult> {
	const findings: CheckFinding[] = []
	let files = 0

	const sources: { relative: string; kind: SourceKind }[] = []
	for await (const relative of new Glob('**/*.{astro,ts,tsx,mts,cts,css}').scan({ cwd: root })) {
		const kind = sourceKind(relative)
		if (kind === null || (only !== null && !only.has(relative))) continue
		sources.push({ relative, kind })
	}
	sources.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))
	const paths = sources.map(source => source.relative)

	const compile = projectCode && sources.some(source => source.kind === 'css') ? await compileFor(root) : bundledCompile
	for (const { relative, kind } of sources) {
		files++
		const absolute = path.join(root, relative)
		const source = await Bun.file(absolute).text()
		const finding = kind === 'css'
			? await checkCssFile(compile, absolute, relative, source)
			: await checkScriptSource(relative, source, kind, BUN_PORTS, absolute)
		if (finding) findings.push(finding)
	}

	return { findings, files, paths }
}
