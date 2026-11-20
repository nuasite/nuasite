import { checkScriptSource, parseScriptWithBabel, type SourceCheckPorts, sourceKind } from '@nuasite/cms-core'
import path from 'node:path'
import type { ProjectFiles } from './files.ts'

/** Astro's `transform` of one component, as the syntax check needs it. */
export type CompileAstro = SourceCheckPorts['compileAstro']

/** An editor write refused because the site's build could not parse the file it would leave behind. */
export class UnparsableSourceError extends Error {}

/**
 * `files` that refuse to write a `.astro`, `.ts` or `.tsx` file the build could not parse.
 *
 * Astro's `parse`, which the editor reads sources with, accepts an attribute expression left open above a
 * `<style>`; the build then stops on the code the compiler emitted. So every code file a write produces is
 * compiled and parsed first. A file that already failed before the write is written as before: the
 * editor cannot be the one to have broken it, and refusing would only block edits to a broken page.
 */
export function guardSourceWrites(files: ProjectFiles, root: () => string, compileAstro: CompileAstro): ProjectFiles {
	const ports: SourceCheckPorts = { compileAstro, parseScript: parseScriptWithBabel }

	async function syntaxError(filePath: string, content: string): Promise<string | null> {
		const absolute = path.resolve(root(), filePath)
		const kind = sourceKind(path.relative(root(), absolute))
		if (kind === null || kind === 'css') return null
		const finding = await checkScriptSource(path.relative(root(), absolute), content, kind, ports, absolute)
		if (finding === null) return null
		const position = finding.line === undefined ? '' : `:${finding.line}${finding.column === undefined ? '' : `:${finding.column}`}`
		return `${finding.file}${position}: ${finding.message}`
	}

	async function previousParses(filePath: string): Promise<boolean> {
		// Unreadable counts as new, which is checked: the safe side, as the write is then refused rather than let through.
		const previous = await files.readFile(filePath).catch(() => null)
		return previous === null || await syntaxError(filePath, previous) === null
	}

	return {
		...files,
		async writeFile(filePath, content) {
			if (typeof content === 'string') {
				const error = await syntaxError(filePath, content)
				if (error !== null && await previousParses(filePath)) {
					throw new UnparsableSourceError(`Not saved: the site's build could not parse the result, ${error}`)
				}
			}
			await files.writeFile(filePath, content)
		},
	}
}
