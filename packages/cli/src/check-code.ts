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
 */

import { transform } from '@astrojs/compiler'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import type { CheckFinding } from '@nuasite/cms-core'
import { Glob } from 'bun'
import path from 'node:path'

/** Directories that are never the project's own source. */
const IGNORED = ['node_modules', 'dist', '.astro', '.git', '.output', '.vercel', '.netlify']

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

export interface CodeCheckResult {
	findings: CheckFinding[]
	files: number
}

/** Parse every `.astro`/`.ts`/`.tsx` under `root`, newest failure first is not meaningful here — order is by path. */
export async function checkCode(root: string): Promise<CodeCheckResult> {
	const findings: CheckFinding[] = []
	let files = 0

	const paths: string[] = []
	for await (const relative of new Glob('**/*.{astro,ts,tsx,mts,cts}').scan({ cwd: root })) {
		if (!isIgnored(relative)) paths.push(relative)
	}
	paths.sort()

	for (const relative of paths) {
		files++
		const absolute = path.join(root, relative)
		const source = await Bun.file(absolute).text()
		const finding = relative.endsWith('.astro')
			? await checkAstroFile(absolute, relative, source)
			: checkScriptFile(relative, source, relative.endsWith('.tsx') ? 'tsx' : 'ts')
		if (finding) findings.push(finding)
	}

	return { findings, files }
}
