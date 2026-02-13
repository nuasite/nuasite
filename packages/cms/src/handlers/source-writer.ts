import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from '../config'
import type { AttributeChangePayload, ChangePayload, SaveBatchRequest } from '../editor/types'
import type { ManifestWriter } from '../manifest-writer'
import type { CmsManifest, ManifestEntry } from '../types'
import { acquireFileLock, escapeReplacement, normalizePagePath, resolveAndValidatePath } from '../utils'

export interface SaveBatchResponse {
	updated: number
	errors?: Array<{ cmsId: string; error: string }>
}

export async function handleUpdate(
	request: SaveBatchRequest,
	manifestWriter: ManifestWriter,
): Promise<SaveBatchResponse> {
	const { changes, meta } = request
	const errors: Array<{ cmsId: string; error: string }> = []
	let updated = 0

	// Get the manifest for the page being edited
	const pagePath = normalizePagePath(meta.url)
	const pageData = manifestWriter.getPageManifest(pagePath)
	const manifest: CmsManifest = pageData
		? {
			entries: pageData.entries,
			components: pageData.components,
			componentDefinitions: manifestWriter.getComponentDefinitions(),
		}
		: manifestWriter.getGlobalManifest()

	// Group changes by source file
	const changesByFile: Record<string, ChangePayload[]> = {}
	for (const change of changes) {
		const filePath = change.sourcePath
		if (!filePath) {
			errors.push({ cmsId: change.cmsId, error: 'No file path in change payload' })
			continue
		}
		if (!changesByFile[filePath]) {
			changesByFile[filePath] = []
		}
		changesByFile[filePath]!.push(change)
	}

	const projectRoot = getProjectRoot()

	for (const [filePath, fileChanges] of Object.entries(changesByFile)) {
		try {
			const fullPath = resolveAndValidatePath(filePath)
			const release = await acquireFileLock(fullPath)
			try {
				const currentContent = await fs.readFile(fullPath, 'utf-8')

				const { newContent, appliedCount, failedChanges } = applyChanges(
					currentContent,
					fileChanges,
					manifest,
				)

				if (failedChanges.length > 0) {
					errors.push(...failedChanges)
				}

				if (appliedCount > 0 && newContent !== currentContent) {
					await fs.writeFile(fullPath, newContent, 'utf-8')
					updated += appliedCount
				}
			} finally {
				release()
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			errors.push(
				...fileChanges.map((c) => ({ cmsId: c.cmsId, error: errorMessage })),
			)
		}
	}

	return {
		updated,
		errors: errors.length > 0 ? errors : undefined,
	}
}

function applyChanges(
	content: string,
	changes: ChangePayload[],
	manifest: CmsManifest,
): {
	newContent: string
	appliedCount: number
	failedChanges: Array<{ cmsId: string; error: string }>
} {
	let newContent = content
	let appliedCount = 0
	const failedChanges: Array<{ cmsId: string; error: string }> = []

	// Sort changes by source line descending to prevent offset shifts
	const sortedChanges = [...changes].sort(
		(a, b) => (b.sourceLine ?? 0) - (a.sourceLine ?? 0),
	)

	for (const change of sortedChanges) {
		// Handle image changes
		if (change.imageChange) {
			const result = applyImageChange(newContent, change)
			if (result.success) {
				newContent = result.content
				appliedCount++
			} else {
				failedChanges.push({ cmsId: change.cmsId, error: result.error })
			}
			continue
		}

		// Handle style class changes (colors, text styles, bg images)
		if (change.styleChange) {
			const result = applyColorChange(newContent, change)
			if (result.success) {
				newContent = result.content
				appliedCount++
			} else {
				failedChanges.push({ cmsId: change.cmsId, error: result.error })
			}
			continue
		}

		// Handle attribute changes
		if (change.attributeChanges && change.attributeChanges.length > 0) {
			const result = applyAttributeChanges(newContent, change)
			if (result.appliedCount > 0) {
				newContent = result.content
				appliedCount++
			}
			failedChanges.push(...result.failedChanges)
			continue
		}

		// Text content change
		const result = applyTextChange(newContent, change, manifest)
		if (result.success) {
			newContent = result.content
			appliedCount++
		} else {
			failedChanges.push({ cmsId: change.cmsId, error: result.error })
		}
	}

	return { newContent, appliedCount, failedChanges }
}

function applyImageChange(
	content: string,
	change: ChangePayload,
): { success: true; content: string } | { success: false; error: string } {
	const { newSrc, newAlt } = change.imageChange!
	const originalSrc = change.originalValue

	if (!originalSrc) {
		return { success: false, error: 'No original image src in change payload' }
	}

	const srcCandidates = [originalSrc]
	if (originalSrc.startsWith('http://') || originalSrc.startsWith('https://')) {
		try {
			const parsedUrl = new URL(originalSrc)
			if (parsedUrl.pathname !== originalSrc) {
				srcCandidates.push(parsedUrl.pathname)
			}
		} catch {
			// URL parsing failed, just use original value
		}
	}

	// Extract the authored src from the source snippet if available
	// This handles cases where an Image component transforms the URL (e.g., CDN optimization)
	// so the rendered src differs from the authored src in the source file
	if (change.sourceSnippet) {
		const snippetSrcMatch = change.sourceSnippet.match(/src\s*=\s*"([^"]+)"/) || change.sourceSnippet.match(/src\s*=\s*'([^']+)'/)
		if (snippetSrcMatch?.[1] && !srcCandidates.includes(snippetSrcMatch[1])) {
			srcCandidates.push(snippetSrcMatch[1])
		}
	}

	let newContent = content
	let replacedIndex = -1
	for (const srcToFind of srcCandidates) {
		// Use non-global patterns to replace only the first occurrence
		const srcPatternDouble = new RegExp(`src="${escapeRegExp(srcToFind)}"`)
		const srcPatternSingle = new RegExp(`src='${escapeRegExp(srcToFind)}'`)

		const escapedNewSrc = escapeReplacement(newSrc)
		const doubleMatch = newContent.match(srcPatternDouble)
		if (doubleMatch && doubleMatch.index !== undefined) {
			replacedIndex = doubleMatch.index
			newContent = newContent.slice(0, replacedIndex)
				+ newContent.slice(replacedIndex).replace(srcPatternDouble, `src="${escapedNewSrc}"`)
			break
		}
		const singleMatch = newContent.match(srcPatternSingle)
		if (singleMatch && singleMatch.index !== undefined) {
			replacedIndex = singleMatch.index
			newContent = newContent.slice(0, replacedIndex)
				+ newContent.slice(replacedIndex).replace(srcPatternSingle, `src='${escapedNewSrc}'`)
			break
		}
	}

	// Fallback: if literal src not found, try to find an expression-based src attribute
	// near the source line (handles src={variable}, src={obj.prop}, etc.)
	if (replacedIndex < 0 && change.sourceLine > 0) {
		const lines = newContent.split('\n')
		const targetLineIdx = change.sourceLine - 1

		// Search a region around the source line for an <img with src attribute
		const regionStart = Math.max(0, targetLineIdx - 3)
		const regionEnd = Math.min(lines.length, targetLineIdx + 10)
		const regionLines = lines.slice(regionStart, regionEnd)
		const regionText = regionLines.join('\n')

		// Verify we're in an img or Image component context before replacing
		if (/<img\b/i.test(regionText) || /<Image\b/.test(regionText)) {
			// Match src attribute with expression value: src={...} (handling balanced braces)
			const exprMatch = findExpressionSrcAttribute(regionText)
			if (exprMatch) {
				const regionOffset = regionStart > 0
					? lines.slice(0, regionStart).join('\n').length + 1
					: 0
				const absoluteIndex = regionOffset + exprMatch.index

				const escapedNewSrc = escapeReplacement(newSrc)
				newContent = newContent.slice(0, absoluteIndex)
					+ `src="${escapedNewSrc}"`
					+ newContent.slice(absoluteIndex + exprMatch.length)
				replacedIndex = absoluteIndex
			}
		}
	}

	if (replacedIndex < 0) {
		return { success: false, error: `Image src not found in source file: ${originalSrc}` }
	}

	// Replace alt only in the same img tag context (within ~500 chars around the replaced src)
	if (newAlt !== undefined) {
		const searchStart = Math.max(0, replacedIndex - 200)
		const searchEnd = Math.min(newContent.length, replacedIndex + 300)
		const region = newContent.slice(searchStart, searchEnd)

		const altPatternDouble = /alt="[^"]*"/
		const altPatternSingle = /alt='[^']*'/
		// Also match expression-based alt: alt={...}
		const altPatternExpr = /alt\s*=\s*\{[^}]*\}/

		const altDoubleMatch = region.match(altPatternDouble)
		const altSingleMatch = region.match(altPatternSingle)
		const altExprMatch = region.match(altPatternExpr)

		// Pick the first match found (string literals preferred over expressions)
		const altMatch = altDoubleMatch ?? altSingleMatch ?? altExprMatch
		const altQuote = altDoubleMatch ? '"' : altSingleMatch ? "'" : '"'

		if (altMatch && altMatch.index !== undefined) {
			const altAbsoluteIndex = searchStart + altMatch.index
			// Escape quotes in alt text matching the quote style used
			const escapedAlt = altQuote === '"'
				? newAlt.replace(/"/g, '&quot;')
				: newAlt.replace(/'/g, '&#39;')
			newContent = newContent.slice(0, altAbsoluteIndex)
				+ `alt=${altQuote}${escapedAlt}${altQuote}`
				+ newContent.slice(altAbsoluteIndex + altMatch[0].length)
		}
	}

	return { success: true, content: newContent }
}

function applyColorChange(
	content: string,
	change: ChangePayload,
): { success: true; content: string } | { success: false; error: string } {
	const { oldClass, newClass } = change.styleChange!
	// Prefer styleChange's own sourceLine (points to the class attribute)
	// over the outer change.sourceLine (may point to a data declaration)
	const sourceLine = change.styleChange!.sourceLine ?? change.sourceLine

	// When oldClass is empty, we're adding a new color class (not replacing)
	if (!oldClass) {
		return appendClassToAttribute(content, newClass, sourceLine)
	}

	return replaceClassInAttribute(content, oldClass, newClass, sourceLine)
}

/**
 * Replace an existing class within a class attribute by splitting on whitespace.
 * This avoids \b word-boundary issues (e.g., \b matching `:` in `hover:bg-red-500`).
 */
function replaceClassInAttribute(
	content: string,
	oldClass: string,
	newClass: string,
	sourceLine?: number,
): { success: true; content: string } | { success: false; error: string } {
	const replaceOnLine = (line: string): string | null => {
		// Build pattern dynamically to only exclude the actual quote character used,
		// so bg-[url('/path')] works inside class="..." (single quotes allowed in double-quoted attr)
		const dqMatch = line.match(/(class\s*=\s*)(")([^"]*)"/)
		const sqMatch = line.match(/(class\s*=\s*)(')([^']*)'/)
		const match = dqMatch || sqMatch
		if (!match) return null

		const prefix = match[1]!
		const quote = match[2]!
		const classContent = match[3]!

		const classes = classContent.split(/\s+/).filter(Boolean)
		const idx = classes.indexOf(oldClass)
		if (idx === -1) return null

		if (newClass) {
			classes[idx] = newClass
		} else {
			classes.splice(idx, 1)
		}
		return line.replace(match[0], `${prefix}${quote}${classes.join(' ')}${quote}`)
	}

	if (sourceLine) {
		const lines = content.split('\n')
		const lineIndex = sourceLine - 1

		if (lineIndex >= 0 && lineIndex < lines.length) {
			const result = replaceOnLine(lines[lineIndex]!)
			if (result !== null) {
				lines[lineIndex] = result
				return { success: true, content: lines.join('\n') }
			}
			return { success: false, error: `Color class '${oldClass}' not found on line ${sourceLine}` }
		}
		return { success: false, error: `Invalid source line ${sourceLine}` }
	}

	// Fallback: find the first class attribute in the content that contains oldClass
	const lines = content.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const result = replaceOnLine(lines[i]!)
		if (result !== null) {
			lines[i] = result
			return { success: true, content: lines.join('\n') }
		}
	}
	return { success: false, error: `Color class '${oldClass}' not found in source file` }
}

/**
 * Append a new class to an existing class attribute.
 */
function appendClassToAttribute(
	content: string,
	newClass: string,
	sourceLine?: number,
): { success: true; content: string } | { success: false; error: string } {
	// Match class attribute with either quote, only excluding the actual quote used
	// so bg-[url('/path')] works inside class="..."
	const matchClassAttr = (line: string) => {
		return line.match(/(class\s*=\s*")(([^"]*))(")/)
			|| line.match(/(class\s*=\s*')(([^']*))(')/)
	}

	const doAppendOnLine = (line: string): string | null => {
		const match = matchClassAttr(line)
		if (!match) return null
		const open = match[1]!
		const classes = match[2]!
		const close = match[4]!
		const trimmed = classes.trimEnd()
		const separator = trimmed ? ' ' : ''
		const replacement = `${open}${trimmed}${separator}${escapeReplacement(newClass)}${close}`
		return line.replace(match[0], replacement)
	}

	if (sourceLine) {
		const lines = content.split('\n')
		const lineIndex = sourceLine - 1

		if (lineIndex >= 0 && lineIndex < lines.length) {
			const result = doAppendOnLine(lines[lineIndex]!)
			if (result !== null) {
				lines[lineIndex] = result
				return { success: true, content: lines.join('\n') }
			}
			return { success: false, error: `No class attribute found on line ${sourceLine}` }
		}
		return { success: false, error: `Invalid source line ${sourceLine}` }
	}

	// Fallback: find the first class attribute in the content
	const lines = content.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const result = doAppendOnLine(lines[i]!)
		if (result !== null) {
			lines[i] = result
			return { success: true, content: lines.join('\n') }
		}
	}
	return { success: false, error: 'No class attribute found in source file' }
}

function applyAttributeChanges(
	content: string,
	change: ChangePayload,
): {
	content: string
	appliedCount: number
	failedChanges: Array<{ cmsId: string; error: string }>
} {
	let newContent = content
	let attrApplied = 0
	const failedChanges: Array<{ cmsId: string; error: string }> = []

	for (const attrChange of change.attributeChanges!) {
		const { attributeName, oldValue: attrOldValue, newValue: attrNewValue } = attrChange
		if (attrOldValue === undefined || attrNewValue === undefined) {
			failedChanges.push({
				cmsId: change.cmsId,
				error: `Missing oldValue or newValue for attribute '${attributeName}'`,
			})
			continue
		}

		const targetLine = attrChange.sourceLine ?? change.sourceLine
		if (targetLine) {
			const lines = newContent.split('\n')
			const lineIndex = targetLine - 1

			if (lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex]!
				const doubleQuotePattern = new RegExp(
					`(${escapeRegExp(attributeName)}\\s*=\\s*)"(${escapeRegExp(attrOldValue)})"`,
				)
				const singleQuotePattern = new RegExp(
					`(${escapeRegExp(attributeName)}\\s*=\\s*)'(${escapeRegExp(attrOldValue)})'`,
				)

				const safeNewValue = escapeReplacement(attrNewValue)
				if (doubleQuotePattern.test(line)) {
					lines[lineIndex] = line.replace(doubleQuotePattern, `$1"${safeNewValue}"`)
					newContent = lines.join('\n')
					attrApplied++
				} else if (singleQuotePattern.test(line)) {
					lines[lineIndex] = line.replace(singleQuotePattern, `$1'${safeNewValue}'`)
					newContent = lines.join('\n')
					attrApplied++
				} else {
					failedChanges.push({
						cmsId: change.cmsId,
						error: `Attribute '${attributeName}="${attrOldValue}"' not found on line ${targetLine}`,
					})
				}
			} else {
				failedChanges.push({
					cmsId: change.cmsId,
					error: `Invalid source line ${targetLine} for attribute '${attributeName}'`,
				})
			}
		} else {
			// Fallback: replace first occurrence in the whole file
			const doubleQuotePattern = new RegExp(
				`(${escapeRegExp(attributeName)}\\s*=\\s*)"(${escapeRegExp(attrOldValue)})"`,
			)
			const singleQuotePattern = new RegExp(
				`(${escapeRegExp(attributeName)}\\s*=\\s*)'(${escapeRegExp(attrOldValue)})'`,
			)

			const safeNewValue = escapeReplacement(attrNewValue)
			if (doubleQuotePattern.test(newContent)) {
				newContent = newContent.replace(doubleQuotePattern, `$1"${safeNewValue}"`)
				attrApplied++
			} else if (singleQuotePattern.test(newContent)) {
				newContent = newContent.replace(singleQuotePattern, `$1'${safeNewValue}'`)
				attrApplied++
			} else {
				failedChanges.push({
					cmsId: change.cmsId,
					error: `Attribute '${attributeName}="${attrOldValue}"' not found in source file`,
				})
			}
		}
	}

	return { content: newContent, appliedCount: attrApplied, failedChanges }
}

export function applyTextChange(
	content: string,
	change: ChangePayload,
	manifest: CmsManifest,
): { success: true; content: string } | { success: false; error: string } {
	const { sourceSnippet, originalValue, newValue, htmlValue } = change

	let newText = htmlValue ?? newValue
	newText = resolveCmsPlaceholders(newText, manifest)

	if (!sourceSnippet || !originalValue) {
		if (change.attributeChanges && change.attributeChanges.length > 0) {
			return { success: true, content }
		}
		return { success: false, error: 'Missing sourceSnippet or originalValue in change payload' }
	}

	if (!content.includes(sourceSnippet)) {
		return { success: false, error: 'Source snippet not found in file' }
	}

	// Replace originalValue with newText WITHIN the sourceSnippet
	const updatedSnippet = sourceSnippet.replace(originalValue, newText)

	if (updatedSnippet === sourceSnippet) {
		// originalValue wasn't found in snippet - try HTML entity handling
		const matchedText = findTextInSnippet(sourceSnippet, originalValue)
		if (matchedText) {
			const updatedWithEntity = sourceSnippet.replace(matchedText, newText)
			return { success: true, content: content.replace(sourceSnippet, updatedWithEntity) }
		}
		// Try inner content replacement for text spanning inline HTML elements
		// (e.g., <h3>text part 1 <span class="...">text part 2</span></h3>)
		const innerMatch = sourceSnippet.match(/^(\s*<(\w+)\b[^>]*>)([\s\S]*)(<\/\2>\s*)$/)
		if (innerMatch) {
			const [, openTag, , innerContent, closeTag] = innerMatch
			const textOnly = innerContent.replace(/<[^>]+>/g, '')
			if (textOnly === originalValue) {
				return { success: true, content: content.replace(sourceSnippet, openTag + newText + closeTag) }
			}
		}

		return {
			success: false,
			error: `Original text "${originalValue.substring(0, 50)}..." not found in source snippet`,
		}
	}

	return { success: true, content: content.replace(sourceSnippet, updatedSnippet) }
}

/**
 * Find the original text within a source snippet, accounting for HTML entities.
 */
function findTextInSnippet(snippet: string, decodedText: string): string | null {
	if (snippet.includes(decodedText)) {
		return decodedText
	}

	const entityMap: Array<[string, string]> = [
		// & must be first: other entities contain & which would get double-expanded
		['&', '&amp;'],
		[' ', '&nbsp;'],
		[' ', '&#160;'],
		['<', '&lt;'],
		['>', '&gt;'],
		['"', '&quot;'],
		["'", '&#39;'],
		["'", '&apos;'],
	]

	let pattern = escapeRegExp(decodedText)
	for (const [char, entity] of entityMap) {
		const escapedChar = escapeRegExp(char)
		const escapedEntity = escapeRegExp(entity)
		pattern = pattern.replace(new RegExp(escapedChar, 'g'), `(?:${escapedChar}|${escapedEntity})`)
	}

	const regex = new RegExp(pattern)
	const match = snippet.match(regex)
	if (match) return match[0]

	// Try matching with <br> tags stripped from snippet
	const chars = [...decodedText].map((ch) => escapeRegExp(ch))
	const brAwarePattern = chars.join('(?:<br\\s*\\/?>)*')
	const brRegex = new RegExp(brAwarePattern)
	const brMatch = snippet.match(brRegex)

	return brMatch && brMatch[0] !== decodedText ? brMatch[0] : null
}

/**
 * Resolve CMS placeholders like {{cms:cms-96}} in text.
 */
function resolveCmsPlaceholders(text: string, manifest: CmsManifest): string {
	const placeholderPattern = /\{\{cms:([^}]+)\}\}/g

	return text.replace(placeholderPattern, (match, cmsId: string) => {
		const childEntry: ManifestEntry | undefined = manifest.entries[cmsId]
		if (!childEntry) {
			return match
		}
		if (childEntry.sourceSnippet) {
			return childEntry.sourceSnippet
		}
		return childEntry.html ?? childEntry.text ?? match
	})
}

/**
 * Find a src attribute with expression value (e.g., src={variable}) in text.
 * Handles balanced braces for nested expressions.
 * Returns the match with index and length, or null if not found.
 */
function findExpressionSrcAttribute(text: string): { index: number; length: number } | null {
	// Find 'src=' followed by '{'
	const srcExprStart = /src\s*=\s*\{/
	const match = text.match(srcExprStart)
	if (!match || match.index === undefined) return null

	// Find the matching closing brace (handle nesting)
	const braceStart = match.index + match[0].length - 1 // index of '{'
	let depth = 1
	let i = braceStart + 1
	while (i < text.length && depth > 0) {
		if (text[i] === '{') depth++
		else if (text[i] === '}') depth--
		i++
	}

	if (depth !== 0) return null // Unbalanced braces

	return {
		index: match.index,
		length: i - match.index,
	}
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
