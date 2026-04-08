/**
 * Apply a suggestion's text replacement back to the source file.
 *
 * Each suggestion item already carries the source location it was created
 * against (`targetSourcePath`, `targetSourceLine`) — both populated from the
 * `@nuasite/cms` per-page manifest at create time. That gives us everything
 * we need to perform the apply locally without peer-importing CMS internals:
 *
 *   1. Read the source file at `targetSourcePath`.
 *   2. Find `range.originalText` in the file.
 *      - If it appears exactly once → replace it.
 *      - If it appears multiple times → use `targetSourceLine` to pick the
 *        nearest occurrence (within a small window). This handles repeated
 *        words / boilerplate inside large files.
 *      - If it doesn't appear → drift detected, return `stale`.
 *   3. Atomically write the file back (write `.tmp`, rename).
 *
 * The Vite watcher inside CMS picks up the file write and triggers HMR,
 * which reloads the page and shows the applied text. The notes API handler
 * also fires its own HMR full-reload to be safe.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { NoteItem } from '../storage/types'

export type ApplyResult =
	| { ok: true; file: string; before: string; after: string }
	| { ok: false; reason: 'not-suggestion' | 'missing-source' | 'file-error' | 'not-found' | 'ambiguous'; message: string }

interface ApplyOptions {
	projectRoot: string
}

const LINE_WINDOW = 8

function* findAllOccurrences(haystack: string, needle: string): Generator<number> {
	if (!needle) return
	let from = 0
	while (true) {
		const idx = haystack.indexOf(needle, from)
		if (idx < 0) return
		yield idx
		from = idx + needle.length
	}
}

function lineOfOffset(content: string, offset: number): number {
	let line = 1
	for (let i = 0; i < offset && i < content.length; i++) {
		if (content[i] === '\n') line++
	}
	return line
}

/**
 * Resolve `targetSourcePath` to an absolute path inside the project root.
 * Defends against path traversal: the resolved path must stay inside the
 * project root.
 */
function resolveSafe(projectRoot: string, sourcePath: string): string | null {
	const root = path.resolve(projectRoot)
	const candidate = path.resolve(root, sourcePath)
	if (!candidate.startsWith(root + path.sep) && candidate !== root) return null
	return candidate
}

export async function applySuggestion(item: NoteItem, options: ApplyOptions): Promise<ApplyResult> {
	if (item.type !== 'suggestion' || !item.range) {
		return { ok: false, reason: 'not-suggestion', message: 'Only suggestion items can be applied' }
	}
	if (!item.targetSourcePath) {
		return {
			ok: false,
			reason: 'missing-source',
			message: 'Suggestion is missing targetSourcePath. Cannot resolve which file to edit.',
		}
	}
	const abs = resolveSafe(options.projectRoot, item.targetSourcePath)
	if (!abs) {
		return { ok: false, reason: 'missing-source', message: `Refusing to write outside project root: ${item.targetSourcePath}` }
	}

	let content: string
	try {
		content = await fs.readFile(abs, 'utf-8')
	} catch (err) {
		return {
			ok: false,
			reason: 'file-error',
			message: `Could not read ${item.targetSourcePath}: ${err instanceof Error ? err.message : String(err)}`,
		}
	}

	const original = item.range.originalText
	const replacement = item.range.suggestedText
	if (!original) {
		return { ok: false, reason: 'not-found', message: 'Suggestion has empty originalText' }
	}

	const occurrences = Array.from(findAllOccurrences(content, original))
	if (occurrences.length === 0) {
		return {
			ok: false,
			reason: 'not-found',
			message: `Original text not found in ${item.targetSourcePath}. Source may have drifted since the suggestion was made.`,
		}
	}

	let chosenOffset: number
	if (occurrences.length === 1) {
		chosenOffset = occurrences[0]!
	} else {
		// Pick the occurrence closest to targetSourceLine (within a small window).
		const targetLine = item.targetSourceLine ?? 0
		let best: { offset: number; dist: number } | null = null
		for (const off of occurrences) {
			const ln = lineOfOffset(content, off)
			const dist = Math.abs(ln - targetLine)
			if (!best || dist < best.dist) best = { offset: off, dist }
		}
		if (!best || best.dist > LINE_WINDOW) {
			return {
				ok: false,
				reason: 'ambiguous',
				message:
					`Original text appears ${occurrences.length} times in ${item.targetSourcePath} and none are near targetSourceLine ${targetLine}. Refusing to apply.`,
			}
		}
		chosenOffset = best.offset
	}

	const before = content.slice(Math.max(0, chosenOffset - 40), chosenOffset + original.length + 40)
	const newContent = content.slice(0, chosenOffset) + replacement + content.slice(chosenOffset + original.length)
	const after = newContent.slice(Math.max(0, chosenOffset - 40), chosenOffset + replacement.length + 40)

	// Atomic write — same pattern the JSON store uses.
	const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`
	try {
		await fs.writeFile(tmp, newContent, 'utf-8')
		await fs.rename(tmp, abs)
	} catch (err) {
		// Clean up tmp on failure
		try {
			await fs.unlink(tmp)
		} catch {}
		return {
			ok: false,
			reason: 'file-error',
			message: `Could not write ${item.targetSourcePath}: ${err instanceof Error ? err.message : String(err)}`,
		}
	}

	return { ok: true, file: item.targetSourcePath, before, after }
}
