/**
 * The syntax check of a site's own code, without a runtime of its own.
 *
 * A build dies on a file it cannot parse before a single page renders. Astro compiles a `.astro`
 * file to TypeScript and the bundler parses that, so compiling and parsing reproduces the error
 * without rendering anything. Astro's own `parse` is not enough: an attribute expression left open
 * (`<header class={a>`) swallows the `<style>` and `<script>` below it, and the compiler reports
 * nothing while the emitted code cannot be parsed.
 *
 * The compiler and the script parser are ports, so the same check runs where each host has its
 * own: the CLI on Bun, a Worker over a compiler service and a JavaScript parser of its bundle.
 */

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import type { CheckFinding } from './check.ts'

/** How the syntax check reads a file. */
export type SourceKind = 'astro' | 'ts' | 'tsx' | 'css'

/** Directories that are never the project's own source. */
const IGNORED_DIRECTORIES = ['node_modules', 'dist', '.astro', '.git', '.output', '.vercel', '.netlify']

/** Copied to the output as they are: nothing parses a stylesheet there, so nothing in it can fail a build. */
const UNPROCESSED_STYLESHEET_DIRECTORIES = ['public']

/**
 * How the syntax check reads a file, by its path relative to the Astro project; null for a file it
 * does not read. Paths use `/`, or the platform separator.
 */
export function sourceKind(relative: string): SourceKind | null {
	const segments = relative.split(/[\\/]/)
	if (segments.some(segment => IGNORED_DIRECTORIES.includes(segment))) return null
	// Declaration files are types only: nothing compiles them.
	if (/\.d\.[mc]?ts$/.test(relative)) return null
	if (relative.endsWith('.astro')) return 'astro'
	if (relative.endsWith('.tsx')) return 'tsx'
	if (/\.[mc]?ts$/.test(relative)) return 'ts'
	if (relative.endsWith('.css')) return UNPROCESSED_STYLESHEET_DIRECTORIES.includes(segments[0]!) ? null : 'css'
	return null
}

/** A syntax error in the code a script parser was given: `line` 1-based, `column` 0-based. */
export interface ScriptSyntaxError {
	message: string
	line?: number
	column?: number
}

/** The component compiled to TypeScript, with its source map as JSON text. */
export interface CompiledAstro {
	code: string
	map: string
}

export interface SourceCheckPorts {
	/** Astro's `transform` of a component. Throws when the compiler gives up on the source. */
	compileAstro(source: string, filename: string): Promise<CompiledAstro>
	/** Parse TypeScript (`tsx` with JSX) without running it; null when it parses. */
	parseScript(code: string, loader: 'ts' | 'tsx'): ScriptSyntaxError | null
}

/**
 * Map a position in the emitted TypeScript back to the `.astro` source.
 *
 * Without this the position points into generated `$$render` code, which looks like a real line
 * number and is not one.
 */
function toSource(map: string, error: ScriptSyntaxError): { line?: number; column?: number } {
	if (error.line === undefined) return {}
	let traced: ReturnType<typeof originalPositionFor>
	try {
		traced = originalPositionFor(new TraceMap(map), { line: error.line, column: error.column ?? 0 })
	} catch {
		// A map the compiler wrote that cannot be read: the file is named, only the position is lost.
		return {}
	}
	if (traced.line === null) return {}
	return { line: traced.line, column: traced.column + 1 }
}

function compileFailure(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	return message.split('\n')[0]!
}

/**
 * The syntax error a build would stop on in one `.astro`, `.ts` or `.tsx` file, or null when it
 * parses. `file` is the path the finding names; `filename` is what the compiler is told, by default
 * the same.
 */
export async function checkScriptSource(
	file: string,
	source: string,
	kind: Exclude<SourceKind, 'css'>,
	ports: SourceCheckPorts,
	filename: string = file,
): Promise<CheckFinding | null> {
	if (kind !== 'astro') {
		const error = ports.parseScript(source, kind)
		if (error === null) return null
		return {
			severity: 'error',
			code: 'code/syntax',
			file,
			...(error.line === undefined ? {} : { line: error.line }),
			...(error.column === undefined ? {} : { column: error.column + 1 }),
			message: error.message,
		}
	}

	let compiled: CompiledAstro
	try {
		compiled = await ports.compileAstro(source, filename)
	} catch (error) {
		return { severity: 'error', code: 'code/astro-parse', file, message: compileFailure(error) }
	}
	const error = ports.parseScript(compiled.code, 'ts')
	if (error === null) return null
	return { severity: 'error', code: 'code/syntax', file, ...toSource(compiled.map, error), message: error.message }
}
