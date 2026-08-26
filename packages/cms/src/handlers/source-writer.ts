import { NodeType, parse as parseHtml } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, parseDocument, stringify as stringifyYaml, visit as visitYaml } from 'yaml'
import { pickSiblingTarget } from '../astro-image-paths'
import { getProjectRoot } from '../config'
import type { AttributeChangePayload, ChangePayload, SaveBatchRequest } from '../editor/types'
import type { ManifestWriter } from '../manifest-writer'
import { extractAstroImageOriginalUrl } from '../source-finder/snippet-utils'
import type { CmsManifest, ManifestEntry } from '../types'
import { acquireFileLock, escapeRegex, escapeReplacement, normalizePagePath, relativeImportPath, resolveAndValidatePath } from '../utils'

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

				const { newContent, appliedCount, failedChanges, fileOps } = await applyChanges(
					currentContent,
					fileChanges,
					manifest,
					fullPath,
					meta.url,
				)
				if (failedChanges.length > 0) {
					errors.push(...failedChanges)
				}

				if (appliedCount > 0 && newContent !== currentContent) {
					// Write assets first so the source file never points at missing files.
					for (const op of fileOps) {
						await fs.mkdir(path.dirname(op.target), { recursive: true })
						await fs.writeFile(op.target, op.bytes)
					}
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

/** Asset write that must land alongside the source rewrite (assets first, then source). */
interface PendingFileOp {
	target: string
	bytes: Buffer
}

async function applyChanges(
	content: string,
	changes: ChangePayload[],
	manifest: CmsManifest,
	absFilePath: string,
	originUrl: string,
): Promise<{
	newContent: string
	appliedCount: number
	failedChanges: Array<{ cmsId: string; error: string }>
	fileOps: PendingFileOp[]
}> {
	let newContent = content
	let appliedCount = 0
	const failedChanges: Array<{ cmsId: string; error: string }> = []
	const fileOps: PendingFileOp[] = []

	// Sort changes by source line descending to prevent offset shifts
	const sortedChanges = [...changes].sort(
		(a, b) => (b.sourceLine ?? 0) - (a.sourceLine ?? 0),
	)

	for (const change of sortedChanges) {
		// Handle image changes
		if (change.imageChange) {
			const result = await applyImageChange(newContent, change, absFilePath, originUrl)
			if (result.success) {
				newContent = result.content
				if (result.fileOp) fileOps.push(result.fileOp)
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

	return { newContent, appliedCount, failedChanges, fileOps }
}

export async function applyImageChange(
	content: string,
	change: ChangePayload,
	absFilePath?: string,
	originUrl?: string,
): Promise<{ success: true; content: string; fileOp?: PendingFileOp } | { success: false; error: string }> {
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

	// Extract original path from Astro Image optimization URLs (/_image?href=...)
	const decodedHref = extractAstroImageOriginalUrl(originalSrc)
	if (decodedHref && !srcCandidates.includes(decodedHref)) {
		srcCandidates.push(decodedHref)
	}

	// Extract the authored value from YAML/JSON source snippets.
	// Astro optimizes images from content collections (e.g. ./images/photo.jpg → /assets/hash.webp),
	// so the rendered URL won't match the value in the data file. Parse the snippet to recover it.
	if (change.sourceSnippet) {
		const yamlKeyMatch = change.sourceSnippet.match(/^\s*([\w][\w-]*):\s*/)
		if (yamlKeyMatch?.[1]) {
			try {
				const parsed = parseYaml(change.sourceSnippet)
				if (parsed && typeof parsed === 'object') {
					const value = (parsed as Record<string, unknown>)[yamlKeyMatch[1]]
					if (typeof value === 'string' && !srcCandidates.includes(value)) {
						srcCandidates.push(value)
					}
				}
			} catch {
				// Not valid YAML, ignore
			}
		}
	}

	let newContent = content
	let replacedIndex = -1
	for (const srcToFind of srcCandidates) {
		// Use non-global patterns to replace only the first occurrence
		const srcPatternDouble = new RegExp(`src="${escapeRegex(srcToFind)}"`)
		const srcPatternSingle = new RegExp(`src='${escapeRegex(srcToFind)}'`)

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

	// Fallback: try YAML key-value replacement for collection frontmatter fields
	// Try all srcCandidates since the rendered URL may differ from the authored YAML value
	if (replacedIndex < 0 && change.sourceSnippet && isYamlValueSource(newContent, change.sourceSnippet, change.sourcePath)) {
		for (const srcToFind of srcCandidates) {
			const yamlResult = tryYamlValueReplacement(change.sourceSnippet, srcToFind, newSrc)
			if (yamlResult !== null) {
				// Search near the source line to avoid matching a duplicate snippet elsewhere
				let searchStart = 0
				if (change.sourceLine > 1) {
					let linesFound = 0
					for (let j = 0; j < newContent.length; j++) {
						if (newContent[j] === '\n' && ++linesFound >= change.sourceLine - 1) {
							searchStart = j + 1
							break
						}
					}
				}
				const snippetIdx = newContent.indexOf(change.sourceSnippet, searchStart)
				if (snippetIdx >= 0) {
					replacedIndex = snippetIdx
					newContent = newContent.slice(0, snippetIdx) + yamlResult + newContent.slice(snippetIdx + change.sourceSnippet.length)
					break
				}
			}
		}
	}

	// Fallback: direct quoted-value replacement for data files (JSON, YAML, MD frontmatter)
	// The source file may be a collection data file where the image is a plain string value
	if (replacedIndex < 0 && change.sourceSnippet) {
		for (const srcToFind of srcCandidates) {
			const result = tryDataFileValueReplacement(newContent, change.sourceSnippet, srcToFind, newSrc, change.sourceLine)
			if (result) {
				replacedIndex = result.index
				newContent = result.content
				break
			}
		}
	}

	// Fallback: if literal src not found, try to find an expression-based src attribute
	// near the source line (handles src={variable}, src={obj.prop}, etc.)
	let pendingFileOp: PendingFileOp | undefined
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
			const exprMatch = findExpressionSrcAttribute(regionText)
			if (exprMatch) {
				const exprContent = regionText.slice(
					exprMatch.index + regionText.slice(exprMatch.index).indexOf('{') + 1,
					exprMatch.index + exprMatch.length - 1,
				).trim()

				// `<Image src={importedAsset}>` where `importedAsset` is a frontmatter asset
				// import: prefer rewriting the import target so Astro's asset pipeline still
				// processes the new image. Falls back to inline JSX replacement when the new
				// src can't be resolved on disk (e.g. external URLs, non-local media adapters).
				const importInfo = /^\w+$/.test(exprContent) ? findFrontmatterAssetImport(content, exprContent) : null
				if (!importInfo) {
					return { success: false, error: `Image src uses a dynamic expression (src={${exprContent}}) — edit the data source directly` }
				}
				const rewrite = absFilePath
					? await tryRewriteAssetImport(content, importInfo, newSrc, absFilePath, originUrl)
					: null
				if (rewrite) {
					newContent = rewrite.content
					pendingFileOp = rewrite.fileOp
					replacedIndex = rewrite.importSourceIndex
				} else {
					const literalResult = inlineJsxLiteralReplace(newContent, lines, regionStart, exprMatch, newSrc)
					newContent = literalResult.content
					replacedIndex = literalResult.replacedIndex
				}
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

		// Try string-literal alt first, then expression alt with balanced braces
		let altIndex = -1
		let altLength = 0
		let altQuote = '"'

		const altPatternDouble = /alt="[^"]*"/
		const altPatternSingle = /alt='[^']*'/
		const altDoubleMatch = region.match(altPatternDouble)
		const altSingleMatch = region.match(altPatternSingle)

		if (altDoubleMatch && altDoubleMatch.index !== undefined) {
			altIndex = altDoubleMatch.index
			altLength = altDoubleMatch[0].length
			altQuote = '"'
		} else if (altSingleMatch && altSingleMatch.index !== undefined) {
			altIndex = altSingleMatch.index
			altLength = altSingleMatch[0].length
			altQuote = "'"
		} else {
			// Expression-based alt={...} — use balanced brace matching
			const altExprMatch = findExpressionAltAttribute(region)
			if (altExprMatch) {
				altIndex = altExprMatch.index
				altLength = altExprMatch.length
				altQuote = '"'
			}
		}

		if (altIndex >= 0) {
			const altAbsoluteIndex = searchStart + altIndex
			const escapedAlt = altQuote === '"'
				? newAlt.replace(/"/g, '&quot;')
				: newAlt.replace(/'/g, '&#39;')
			newContent = newContent.slice(0, altAbsoluteIndex)
				+ `alt=${altQuote}${escapedAlt}${altQuote}`
				+ newContent.slice(altAbsoluteIndex + altLength)
		}
	}

	return { success: true, content: newContent, fileOp: pendingFileOp }
}

interface FrontmatterAssetImport {
	/** Local binding name (e.g., `hero`). */
	localName: string
	/** Import source as written in the frontmatter (e.g., `'../assets/hero.png'`). */
	source: string
	/** Character offset of `source` (without quotes) in `content`. */
	sourceStart: number
	/** Character offset just past the `source` string (without quotes) in `content`. */
	sourceEnd: number
}

const ASSET_IMPORT_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?)$/i

/**
 * Locate the frontmatter `import varName from '<asset-path>'` statement that binds
 * `varName` to a relative image asset. Returns the binding's source-string position
 * so callers can rewrite just the path without re-tokenizing the import.
 */
function findFrontmatterAssetImport(content: string, varName: string): FrontmatterAssetImport | null {
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!fmMatch) return null
	const fmStart = fmMatch[0].indexOf(fmMatch[1]!)
	const importRe = /^\s*import\s+(?!type\b)([\s\S]+?)\s+from\s+(['"])([^'"]+)\2/gm
	let m: RegExpExecArray | null
	while ((m = importRe.exec(fmMatch[1]!)) !== null) {
		const source = m[3]!
		if (!source.startsWith('.') || !ASSET_IMPORT_EXT_RE.test(source)) continue
		// Skip per-binding `import { type X } from '...'` — those are erased at compile time.
		const tokens = m[1]!.replace(/[{}]/g, ',').split(',').map(s => s.trim()).filter(t => t && !t.startsWith('type '))
		const matches = tokens.some(tok => {
			const aliasMatch = tok.match(/^\S+\s+as\s+(\S+)$/)
			return (aliasMatch ? aliasMatch[1]! : tok) === varName
		})
		if (!matches) continue
		// Compute absolute position of the path string (between the quote chars).
		const matchStart = fmStart + m.index
		const sourceStart = matchStart + m[0]!.indexOf(m[2]!) + 1
		return { localName: varName, source, sourceStart, sourceEnd: sourceStart + source.length }
	}
	return null
}

/**
 * Pure literal swap of `src={var}` → `src="<newSrc>"`. The fallback when import-rewrite
 * isn't possible (e.g. the new src can't be read from disk).
 */
function inlineJsxLiteralReplace(
	content: string,
	lines: string[],
	regionStart: number,
	exprMatch: { index: number; length: number },
	newSrc: string,
): { content: string; replacedIndex: number } {
	let regionStartOffset = 0
	for (let i = 0; i < regionStart; i++) regionStartOffset += lines[i]!.length + 1
	const absIndex = regionStartOffset + exprMatch.index
	return {
		content: content.slice(0, absIndex) + `src="${escapeReplacement(newSrc)}"` + content.slice(absIndex + exprMatch.length),
		replacedIndex: absIndex,
	}
}

/**
 * Rewrite the frontmatter import target so Astro's asset pipeline picks up the new image,
 * and emit a paired file write for the bytes. Returns null only when the new src can't
 * be resolved at all — caller falls back to inline JSX.
 */
async function tryRewriteAssetImport(
	content: string,
	importInfo: FrontmatterAssetImport,
	newSrc: string,
	absFilePath: string,
	originUrl?: string,
): Promise<{ content: string; fileOp: PendingFileOp; importSourceIndex: number } | null> {
	const resolved = await resolveNewSrcBytes(newSrc, originUrl)
	if (!resolved) return null

	const originalAssetAbs = path.resolve(path.dirname(absFilePath), importInfo.source)
	const targetAbs = await pickSiblingTarget(path.dirname(originalAssetAbs), resolved.filename, resolved.bytes)

	const newRelImport = relativeImportPath(absFilePath, targetAbs)
	const newContent = content.slice(0, importInfo.sourceStart) + newRelImport + content.slice(importInfo.sourceEnd)

	return {
		content: newContent,
		fileOp: { target: targetAbs, bytes: resolved.bytes },
		importSourceIndex: importInfo.sourceStart,
	}
}

/**
 * Resolve a new image src to bytes. Tries (in order): the local on-disk location matching
 * the path's prefix (`/src/...` → project, `/...` → public/), then an HTTP fetch as a
 * universal fallback for external URLs and remote media adapters.
 */
async function resolveNewSrcBytes(
	newSrc: string,
	originUrl: string | undefined,
): Promise<{ bytes: Buffer; filename: string } | null> {
	const filenameFromPath = (p: string) => path.basename(p.split('?')[0] ?? p)

	const diskPath = newSrc.startsWith('/src/')
		? path.join(getProjectRoot(), newSrc.slice(1))
		: newSrc.startsWith('/') && !newSrc.startsWith('//')
		? path.join(getProjectRoot(), 'public', newSrc.replace(/^\/+/, ''))
		: null
	if (diskPath) {
		try {
			return { bytes: await fs.readFile(diskPath), filename: filenameFromPath(newSrc) }
		} catch {
			// Fall through to HTTP fetch
		}
	}

	try {
		const isAbsolute = /^https?:\/\//.test(newSrc)
		if (!isAbsolute && !originUrl) return null
		const fetchUrl = isAbsolute ? newSrc : new URL(newSrc, originUrl).toString()
		const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) })
		if (!res.ok) return null
		// Cap the response so a malicious or misbehaving remote can't OOM the dev server.
		const bytes = await readBoundedBody(res, REMOTE_FETCH_MAX_BYTES)
		if (!bytes) return null
		return { bytes, filename: filenameFromPath(new URL(fetchUrl).pathname) }
	} catch {
		return null
	}
}

const REMOTE_FETCH_TIMEOUT_MS = 15_000
const REMOTE_FETCH_MAX_BYTES = 50 * 1024 * 1024

async function readBoundedBody(res: Response, maxBytes: number): Promise<Buffer | null> {
	const declared = Number(res.headers.get('content-length'))
	if (declared > maxBytes) return null
	if (!res.body) return null
	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (total > maxBytes) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	return Buffer.concat(chunks, total)
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

/**
 * Locate `sourceSnippet` in `content` and replace the first quoted occurrence
 * of `oldValue` inside that snippet with `newValue`, then splice back. Returns
 * the updated file content, or undefined if the snippet isn't in the file or
 * contains no quoted match.
 *
 * Used as the save-path for attribute values backed by a JS literal (variable
 * definition, conditional branch) where there's no `attrName=` prefix on the
 * source line. Scoping the match to the recorded snippet prevents accidental
 * hits elsewhere in the file.
 */
const QUOTED_LITERAL_DELIMITERS = [`'`, `"`, '`'] as const

function replaceLiteralInSnippet(
	content: string,
	snippet: string,
	oldValue: string,
	newValue: string,
): string | undefined {
	if (!content.includes(snippet)) return undefined

	const safeNewValue = escapeReplacement(newValue)
	const escapedOld = escapeRegex(oldValue)
	for (const quote of QUOTED_LITERAL_DELIMITERS) {
		const pattern = new RegExp(`${quote}(${escapedOld})${quote}`)
		if (!pattern.test(snippet)) continue
		const updated = snippet.replace(pattern, `${quote}${safeNewValue}${quote}`)
		if (updated !== snippet) return content.replace(snippet, escapeReplacement(updated))
	}
	return undefined
}

export function applyAttributeChanges(
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
					`(${escapeRegex(attributeName)}\\s*=\\s*)"(${escapeRegex(attrOldValue)})"`,
				)
				const singleQuotePattern = new RegExp(
					`(${escapeRegex(attributeName)}\\s*=\\s*)'(${escapeRegex(attrOldValue)})'`,
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
					// JS-backed value (variable def or conditional branch) — no
					// `attrName=` on the line, so scope the replacement to the
					// recorded snippet.
					const snippet = attrChange.sourceSnippet
					if (!snippet) {
						failedChanges.push({
							cmsId: change.cmsId,
							error: `Attribute '${attributeName}="${attrOldValue}"' not found on line ${targetLine}`,
						})
					} else {
						const snippetResult = replaceLiteralInSnippet(
							newContent,
							snippet,
							attrOldValue,
							attrNewValue,
						)
						if (snippetResult) {
							newContent = snippetResult
							attrApplied++
						} else {
							failedChanges.push({
								cmsId: change.cmsId,
								error: `Attribute '${attributeName}="${attrOldValue}"' not found on line ${targetLine} `
									+ `and source snippet did not yield a quoted literal match`,
							})
						}
					}
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
				`(${escapeRegex(attributeName)}\\s*=\\s*)"(${escapeRegex(attrOldValue)})"`,
			)
			const singleQuotePattern = new RegExp(
				`(${escapeRegex(attributeName)}\\s*=\\s*)'(${escapeRegex(attrOldValue)})'`,
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

	if (!sourceSnippet || !originalValue) {
		if (change.attributeChanges && change.attributeChanges.length > 0) {
			return { success: true, content }
		}
		return { success: false, error: 'Missing sourceSnippet or originalValue in change payload' }
	}

	if (!content.includes(sourceSnippet)) {
		return { success: false, error: 'Source snippet not found in file' }
	}

	const entry = manifest.entries[change.cmsId]
	const insideYaml = isYamlValueSource(content, sourceSnippet, change.sourcePath)

	// Never write HTML back into entries that don't allow styling — these are string props,
	// collection fields, etc. where inline HTML would produce invalid source code. A missing
	// manifest entry says nothing about styling, so a frontmatter field — which is never
	// markup — decides on its own rather than defaulting to allowed.
	const stylingAllowed = entry?.allowStyling !== false && !insideYaml
	const newText = stylingAllowed ? (htmlValue ?? newValue) : newValue

	// When originalValue contains CMS placeholders (child elements like {{cms:cms-5}}),
	// replace only the text segments between placeholders directly in the sourceSnippet.
	// This avoids resolving placeholders via child sourceSnippets, which can be incorrect
	// when multiple inline children share the same source line (extractCompleteTagSnippet
	// returns the entire line, not just the individual child tag).
	const placeholderPattern = /\{\{cms:[^}]+\}\}/g
	if (placeholderPattern.test(originalValue)) {
		return applyTextChangeWithPlaceholders(insideYaml, content, sourceSnippet, originalValue, newText)
	}

	// No placeholders — resolve and match directly
	const resolvedNewText = resolveCmsPlaceholders(newText, manifest)
	const resolvedOriginal = resolveCmsPlaceholders(originalValue, manifest)

	// Every path below hands its result to `write`, so the frontmatter guard sits on
	// all of them rather than on whichever one happened to be the last resort.
	const write = (updatedSnippet: string) => writeSnippet(content, sourceSnippet, updatedSnippet, insideYaml, resolvedNewText)

	// A markup-free snippet in a JavaScript file is a frontmatter constant.
	// Substituting the text verbatim there would write an unescaped apostrophe or
	// line break straight into a string literal, so the literal path goes first.
	// The file has to be JavaScript: a quoted YAML value in a markdown entry looks
	// the same but escapes differently, and belongs to `tryYamlValueReplacement`.
	// A traced variable is a definition whatever its snippet swept up; otherwise the
	// snippet has to look markup-free on its own.
	const snippetIsJavaScript = isJavaScriptSource(change.sourcePath)
		&& (!!entry?.variableName || !looksLikeMarkup(sourceSnippet))
	if (snippetIsJavaScript) {
		const literalResult = tryJsStringLiteralChange(sourceSnippet, resolvedOriginal, resolvedNewText)
		if (literalResult !== null) {
			return write(literalResult)
		}
	}

	// A frontmatter scalar has to go through the YAML serializer even when the old
	// text sits in the line verbatim. Written back raw, `Ahoj: světe` or `- světe`
	// gives a mapping the parser can no longer read, and `Sleva #1` silently loses
	// everything from the `#` on — while the save still reports success. The
	// verbatim replace below matches first for any ordinary scalar, so the YAML
	// path only gets a turn if it comes before it.
	if (insideYaml) {
		// The file is known to be YAML here, so a quoted key is just a quoted key —
		// the reason to distrust one is JSON, which cannot reach this branch.
		const frontmatterResult = tryYamlValueReplacement(sourceSnippet, resolvedOriginal, resolvedNewText, true)
		if (frontmatterResult !== null) {
			return write(frontmatterResult)
		}
	}

	// Replace resolvedOriginal with resolvedNewText WITHIN the sourceSnippet
	const updatedSnippet = sourceSnippet.replace(resolvedOriginal, escapeReplacement(resolvedNewText))

	if (updatedSnippet === sourceSnippet) {
		// Try YAML key-value replacement for multi-line frontmatter values
		// (e.g., "title: long text\n  that wraps")
		// Try AST-based <br> normalization (browser normalizes <br class="..." /> to <br>
		// and collapses surrounding whitespace/indentation)
		const brResult = tryBrNormalizedChange(sourceSnippet, resolvedOriginal, resolvedNewText)
		if (brResult !== null) {
			return write(brResult)
		}

		// The snippet may be a frontmatter constant rather than template markup, in
		// which case the rendered text is the *decoded* literal.
		if (snippetIsJavaScript) {
			const literalResult = tryJsStringLiteralChange(sourceSnippet, resolvedOriginal, resolvedNewText)
			if (literalResult !== null) {
				return write(literalResult)
			}
		}

		// resolvedOriginal wasn't found in snippet - try HTML entity handling
		const matchedText = findTextInSnippet(sourceSnippet, resolvedOriginal)
		if (matchedText) {
			// Entity-aware matching means the source spells some characters as entities;
			// the replacement has to keep that spelling. Splicing only the span that
			// changed preserves every entity the edit didn't touch.
			const spliced = /<[^>]+>/.test(resolvedNewText)
				? null
				: spliceIntoEntitySource(matchedText, resolvedOriginal, resolvedNewText)
			// A replacement carrying its own markup gets the nbsp pass only — encoding
			// `&`/`<`/`"` there would mangle the tags the editor just sent.
			const replacement = spliced
				?? (/<[^>]+>/.test(resolvedNewText)
					? encodeNbspLike(resolvedNewText, matchedText)
					: encodeEntitiesLike(resolvedNewText, matchedText))
			const updatedWithEntity = sourceSnippet.replace(matchedText, escapeReplacement(replacement))
			return write(updatedWithEntity)
		}
		// Try inner content replacement for text spanning inline HTML elements
		// (e.g., <h3>text part 1 <span class="...">text part 2</span></h3>)
		const innerMatch = sourceSnippet.match(/^(\s*<(\w+)\b[^>]*>)([\s\S]*)(<\/\2>\s*)$/)
		if (innerMatch) {
			const [, openTag, , innerContent, closeTag] = innerMatch
			const textOnly = innerContent!.replace(/<[^>]+>/g, '')
			if (textOnly === resolvedOriginal) {
				// The editor sends markup of its own only when the element allows styling.
				// Swapping plain text in for inner content that has tags would delete them,
				// so the edit is spliced into the text run it actually touched instead.
				const isHtmlReplacement = /<[^>]+>/.test(resolvedNewText)
				if (isHtmlReplacement || !/<[^>]+>/.test(innerContent!)) {
					return write(openTag + resolvedNewText + closeTag)
				}
				const splicedInner = spliceTextAcrossInlineMarkup(innerContent!, resolvedOriginal, resolvedNewText)
				if (splicedInner !== null) {
					return write(openTag + splicedInner + closeTag)
				}
				return {
					success: false,
					error: 'Cannot apply this edit without dropping the inline markup inside the element '
						+ '— edit the styled part separately',
				}
			}
		}

		return {
			success: false,
			error: `Original text "${resolvedOriginal.substring(0, 50)}..." not found in source snippet`,
		}
	}

	return write(updatedSnippet)
}

/**
 * Apply text change when originalValue contains CMS placeholders.
 * Splits by placeholder boundaries and replaces only the changed text segments.
 */
function applyTextChangeWithPlaceholders(
	insideYaml: boolean,
	content: string,
	sourceSnippet: string,
	originalValue: string,
	newText: string,
): { success: true; content: string } | { success: false; error: string } {
	const placeholderPattern = /\{\{cms:[^}]+\}\}/g

	const originalParts = originalValue.split(placeholderPattern)
	const newParts = newText.split(placeholderPattern)

	if (originalParts.length !== newParts.length) {
		return { success: false, error: 'Placeholder structure mismatch between original and new values' }
	}

	let updatedSnippet = sourceSnippet
	let anyChange = false

	for (let i = 0; i < originalParts.length; i++) {
		const oldPart = originalParts[i]!
		let newPart = newParts[i]!

		if (oldPart === newPart || oldPart.length === 0) {
			continue
		}

		// Try direct match first, then entity-aware match
		const matchedText = findTextInSnippet(updatedSnippet, oldPart)
		if (matchedText) {
			// When entity-aware matching was needed, encode the same entities in the replacement
			if (matchedText !== oldPart) {
				newPart = encodeEntitiesLike(newPart, matchedText)
			}
			updatedSnippet = updatedSnippet.replace(matchedText, escapeReplacement(newPart))
			anyChange = true
		} else {
			return {
				success: false,
				error: `Text segment "${oldPart.substring(0, 50)}..." not found in source snippet`,
			}
		}
	}

	if (!anyChange) {
		return { success: false, error: 'No text changes detected between original and new values' }
	}

	return writeSnippet(content, sourceSnippet, updatedSnippet, insideYaml, newText)
}

// ============================================================================
// JavaScript String Literals
// ============================================================================

/** Files whose contents (or frontmatter) are JavaScript, so string literals escape JS-style. */
const JAVASCRIPT_SOURCE = /\.(astro|[cm]?[jt]sx?)$/i

function isJavaScriptSource(sourcePath: string | undefined): boolean {
	return !!sourcePath && JAVASCRIPT_SOURCE.test(sourcePath)
}

const YAML_DOCUMENT_SOURCE = /\.ya?ml$/i
const YAML_FRONTMATTER_SOURCE = /\.(md|mdx|markdown)$/i

/**
 * True when the snippet sits in YAML the file means as data — a markdown entry's
 * frontmatter block, or the whole of a `.yaml` file. Position decides this, not
 * shape: a markdown *body* line reads `Poznámka: text` exactly like a mapping
 * entry, and running prose through the YAML serializer would quote it.
 */
function isYamlValueSource(content: string, sourceSnippet: string, sourcePath: string | undefined): boolean {
	if (!sourcePath) return false
	if (YAML_DOCUMENT_SOURCE.test(sourcePath)) return true
	if (!YAML_FRONTMATTER_SOURCE.test(sourcePath)) return false

	const block = frontmatterBlock(content)
	if (!block) return false

	const snippetStart = content.indexOf(sourceSnippet)
	return snippetStart >= block.start && snippetStart + sourceSnippet.length <= block.end
}

/**
 * Where the frontmatter block sits, decided the way Astro decides it: a fence at
 * the very start of the file — after an optional BOM or blank lines — and
 * everything up to the next one. Astro reads that block as YAML whatever it
 * holds, so this does not second-guess the shape; a block that does not parse is
 * a broken entry, which the write guard refuses rather than waves through.
 *
 * `+++` opens TOML frontmatter, which Astro parses with a different library and
 * this module has no business rewriting.
 */
function frontmatterBlock(content: string): { start: number; end: number } | null {
	const opening = /^(?:\uFEFF)?(?:[ \t]*\r?\n)*(---|\+\+\+)[ \t]*\r?\n/.exec(content)
	if (!opening || opening[1] !== '---') return null

	const start = opening[0].length
	// Match from the `\n` so a CRLF file's `\r` stays inside the block — it is part
	// of the last field's line, and the snippet the finder cuts includes it.
	const closing = /\n(?:---|\+\+\+)[ \t]*(\r?\n|$)/.exec(content.slice(start))
	return closing ? { start, end: start + closing.index } : null
}

/** A `<` that opens a tag, as opposed to one that is simply part of the text (`a < b`). */
function looksLikeMarkup(text: string): boolean {
	return /<[a-zA-Z/!]/.test(text)
}

interface SourceLiteral {
	/** Offset of the opening quote */
	start: number
	/** Offset just past the closing quote */
	end: number
	quote: string
	/** The literal's decoded value */
	value: string
}

const JS_ESCAPES: Record<string, string> = {
	n: '\n',
	r: '\r',
	t: '\t',
	b: '\b',
	f: '\f',
	v: '\v',
	0: '\0',
}

/** Decode the body of a JavaScript string literal (no surrounding quotes). */
function decodeJsString(raw: string): string {
	let out = ''
	for (let i = 0; i < raw.length; i++) {
		const char = raw[i]!
		if (char !== '\\') {
			out += char
			continue
		}
		const next = raw[++i]
		if (next === undefined) break
		if (next === 'u') {
			if (raw[i + 1] === '{') {
				const close = raw.indexOf('}', i + 2)
				if (close !== -1) {
					const code = parseInt(raw.slice(i + 2, close), 16)
					if (!Number.isNaN(code)) {
						out += String.fromCodePoint(code)
						i = close
						continue
					}
				}
			}
			const code = parseInt(raw.slice(i + 1, i + 5), 16)
			if (!Number.isNaN(code)) {
				out += String.fromCharCode(code)
				i += 4
				continue
			}
		}
		if (next === 'x') {
			const code = parseInt(raw.slice(i + 1, i + 3), 16)
			if (!Number.isNaN(code)) {
				out += String.fromCharCode(code)
				i += 2
				continue
			}
		}
		// A backslash before a real newline is a line continuation
		if (next === '\n') continue
		out += JS_ESCAPES[next] ?? next
	}
	return out
}

/**
 * Re-encode a value for a literal delimited by `quote`, keeping the escape
 * style the source used for non-breaking spaces.
 */
function encodeJsString(value: string, quote: string, escapeNbsp: boolean): string {
	let out = value
		.replace(/\\/g, '\\\\')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t')
		.replaceAll(quote, `\\${quote}`)
	if (escapeNbsp) out = out.replace(/\u00A0/g, '\\u00A0')
	if (quote === '`') out = out.replace(/\$\{/g, '\\${')
	return quote + out + quote
}

/** Locate every string literal in a snippet, with its decoded value. */
function findStringLiterals(snippet: string): SourceLiteral[] {
	const literals: SourceLiteral[] = []
	for (let i = 0; i < snippet.length; i++) {
		const quote = snippet[i]!
		if (quote !== "'" && quote !== '"' && quote !== '`') continue
		let j = i + 1
		while (j < snippet.length) {
			if (snippet[j] === '\\') j += 2
			else if (snippet[j] === quote) break
			else j++
		}
		if (j >= snippet.length) break
		const raw = snippet.slice(i + 1, j)
		literals.push({ start: i, end: j + 1, quote, value: decodeJsString(raw) })
		i = j
	}
	return literals
}

/**
 * Rewrite text that lives in a JavaScript string literal.
 *
 * The rendered text carries the decoded value — a source `\u00A0` reaches the
 * browser as U+00A0, a `\n` as a real line break — so a verbatim comparison
 * against the snippet never matches. A literal split across a `+` chain is
 * collapsed into one literal, since the edit has no way to say where the seam
 * should fall.
 *
 * Returns the updated snippet, or null when no literal holds exactly this text.
 */
function tryJsStringLiteralChange(
	sourceSnippet: string,
	resolvedOriginal: string,
	resolvedNewText: string,
): string | null {
	const literals = findStringLiterals(sourceSnippet)
	if (literals.length === 0) return null

	const splice = (start: number, end: number, replacement: string) => sourceSnippet.slice(0, start) + replacement + sourceSnippet.slice(end)

	// A single literal holding the whole text
	for (const literal of literals) {
		if (literal.value !== resolvedOriginal) continue
		const escapeNbsp = /\\u00[aA]0/.test(sourceSnippet.slice(literal.start, literal.end))
		return splice(literal.start, literal.end, encodeJsString(resolvedNewText, literal.quote, escapeNbsp))
	}

	// A `+` chain of adjacent literals
	for (let first = 0; first < literals.length; first++) {
		let combined = ''
		for (let last = first; last < literals.length; last++) {
			if (last > first) {
				const between = sourceSnippet.slice(literals[last - 1]!.end, literals[last]!.start)
				if (!/^\s*\+\s*$/.test(between)) break
			}
			combined += literals[last]!.value
			if (last === first || combined !== resolvedOriginal) continue
			const start = literals[first]!.start
			const end = literals[last]!.end
			const escapeNbsp = /\\u00[aA]0/.test(sourceSnippet.slice(start, end))
			return splice(start, end, encodeJsString(resolvedNewText, literals[first]!.quote, escapeNbsp))
		}
	}

	return null
}

/**
 * An insertion between two text runs sits next to markup. If that markup closes an
 * element the earlier run was inside, the text belongs to the later run; if it
 * opens one the later run is inside, it belongs to the earlier run. Either way the
 * typed text stays outside the inline element.
 */
function pickRunAtSeam<T extends { index: number }>(tokens: string[], earlier: T, later: T): T {
	const seam = tokens.slice(earlier.index + 1, later.index).find(token => token.startsWith('<'))
	return seam?.startsWith('</') ? later : earlier
}

/**
 * Apply a plain-text edit to inner content that carries inline markup.
 *
 * The rendered text is the concatenation of the element's text runs, so an edit
 * to it has to be written back into whichever run it fell in — replacing the
 * whole inner content would take `<strong>`/`<em>` with it. Returns null when
 * the edit spans more than one run, where no splice can preserve the markup.
 */
function spliceTextAcrossInlineMarkup(
	innerContent: string,
	originalText: string,
	newText: string,
): string | null {
	const tokens = innerContent.split(/(<[^>]+>)/)
	const isTag = (token: string) => token.startsWith('<')

	// Offset of each text token within the concatenated plain text
	const runs: Array<{ index: number; start: number; end: number }> = []
	let plain = ''
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!
		if (isTag(token) || !token) continue
		runs.push({ index: i, start: plain.length, end: plain.length + token.length })
		plain += token
	}
	if (plain !== originalText) return null

	// Narrow the edit to the span that actually changed
	let start = 0
	while (start < originalText.length && start < newText.length && originalText[start] === newText[start]) start++
	let tail = 0
	while (
		tail < originalText.length - start
		&& tail < newText.length - start
		&& originalText[originalText.length - 1 - tail] === newText[newText.length - 1 - tail]
	) tail++
	const originalEnd = originalText.length - tail
	const newEnd = newText.length - tail
	if (start === originalEnd && start === newEnd) return innerContent

	// A pure insertion has no run of its own to land in; it belongs outside whatever
	// inline element sits at the seam, not inside it.
	if (start === originalEnd) {
		const inserted = newText.slice(start, newEnd)
		if (start === 0) return inserted + innerContent
		if (start === originalText.length) return innerContent + inserted
	}

	const fitting = runs.filter(r => start >= r.start && originalEnd <= r.end)
	const run = start === originalEnd && fitting.length > 1
		? pickRunAtSeam(tokens, fitting[0]!, fitting[fitting.length - 1]!)
		: fitting[0]
	if (!run) return null

	const token = tokens[run.index]!
	tokens[run.index] = token.slice(0, start - run.start)
		+ newText.slice(start, newEnd)
		+ token.slice(originalEnd - run.start)
	return tokens.join('')
}

/**
 * Source forms each character can take in an `.astro` template. The rendered
 * text always carries the decoded character (a `&nbsp;` reaches us as U+00A0),
 * so the source may spell it either way.
 */
const ENTITY_ALTERNATIVES = new Map<string, string[]>([
	['&', ['&amp;']],
	['\u00A0', ['&nbsp;', '&#160;', ' ']],
	// contentEditable hands back a plain space for some authored `&nbsp;` (next to
	// another space, or doubled), so the search text has to reach the entity too.
	// Nothing is lost by it: the rewrite splices only the span that changed and
	// leaves the surrounding source bytes, entities included, exactly as they were.
	[' ', ['&nbsp;', '&#160;']],
	['<', ['&lt;']],
	['>', ['&gt;']],
	['"', ['&quot;']],
	["'", ['&#39;', '&apos;']],
])

/**
 * Find the original text within a source snippet, accounting for HTML entities.
 */
function findTextInSnippet(snippet: string, decodedText: string): string | null {
	if (snippet.includes(decodedText)) {
		return decodedText
	}

	// Built per character so an entity alternation can never be re-expanded by a
	// later pass (`&` inside `&nbsp;` used to get rewritten to `(?:&|&amp;)nbsp;`).
	let pattern = ''
	for (const char of decodedText) {
		const alternatives = ENTITY_ALTERNATIVES.get(char)
		pattern += alternatives
			? `(?:${[char, ...alternatives].map(escapeRegex).join('|')})`
			: escapeRegex(char)
	}

	const regex = new RegExp(pattern)
	const match = snippet.match(regex)
	if (match) return match[0]

	// Try matching with <br> tags stripped from snippet
	const chars = [...decodedText].map((ch) => escapeRegex(ch))
	const brAwarePattern = chars.join('(?:<br\\b[^>]*\\/?>)*')
	const brRegex = new RegExp(brAwarePattern)
	const brMatch = snippet.match(brRegex)

	return brMatch && brMatch[0] !== decodedText ? brMatch[0] : null
}

/** A space and a non-breaking space are interchangeable for matching purposes. */
function sameCharacter(a: string | undefined, b: string | undefined): boolean {
	if (a === b) return true
	const spaceLike = (c: string | undefined) => c === ' ' || c === '\u00A0'
	return spaceLike(a) && spaceLike(b)
}

/**
 * Decode HTML entities, remembering where each decoded character came from.
 * `offsets[i]` is the index in `source` at which decoded character `i` starts, and
 * the array carries one extra entry for the end of the string.
 */
function decodeEntitiesWithOffsets(source: string): { text: string; offsets: number[] } {
	const entityPattern = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/iy
	let text = ''
	const offsets: number[] = []
	let i = 0
	while (i < source.length) {
		entityPattern.lastIndex = i
		const match = entityPattern.exec(source)
		const decoded = match ? decodeEntityMatch(match) : undefined
		offsets.push(i)
		if (decoded !== undefined) {
			text += decoded
			i += match![0].length
		} else {
			text += source[i]
			i++
		}
	}
	offsets.push(source.length)
	return { text, offsets }
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00A0',
}

function decodeEntityMatch(match: RegExpExecArray): string | undefined {
	const [, hex, dec, name] = match
	if (hex) return String.fromCodePoint(parseInt(hex, 16))
	if (dec) return String.fromCodePoint(parseInt(dec, 10))
	return name ? NAMED_ENTITIES[name.toLowerCase()] : undefined
}

/**
 * Rewrite entity-encoded source in place, touching only the characters that
 * actually changed.
 *
 * Replacing the whole match would flatten every entity in it to whatever the
 * browser handed back — a `&nbsp;` the user never touched would come back as a
 * plain space. Returns null when the source doesn't decode to `original`, leaving
 * the caller its whole-match fallback.
 */
function spliceIntoEntitySource(source: string, original: string, replacement: string): string | null {
	const { text: decoded, offsets } = decodeEntitiesWithOffsets(source)
	if (decoded.length !== original.length) return null
	for (let i = 0; i < decoded.length; i++) {
		if (!sameCharacter(decoded[i], original[i])) return null
	}

	let start = 0
	while (start < original.length && start < replacement.length && sameCharacter(original[start], replacement[start])) {
		start++
	}
	let tail = 0
	while (
		tail < original.length - start
		&& tail < replacement.length - start
		&& sameCharacter(original[original.length - 1 - tail], replacement[replacement.length - 1 - tail])
	) tail++

	const originalEnd = original.length - tail
	const newEnd = replacement.length - tail
	if (start === originalEnd && start === newEnd) return source

	const head = source.slice(0, offsets[start])
	const rest = source.slice(offsets[originalEnd])
	return head + encodeEntitiesLike(replacement.slice(start, newEnd), source) + rest
}

/**
 * Encode HTML entities in text to match the encoding used in a reference string.
 * When entity-aware matching found entities in the source, the replacement text
 * needs the same encoding to preserve valid HTML.
 */
function encodeEntitiesLike(text: string, reference: string): string {
	let result = text
	// & must be encoded first to avoid double-encoding other entities
	if (reference.includes('&amp;')) {
		result = result.replace(/&/g, '&amp;')
	}
	result = encodeNbspLike(result, reference)
	if (reference.includes('&lt;')) {
		result = result.replace(/</g, '&lt;')
	}
	if (reference.includes('&gt;')) {
		result = result.replace(/>/g, '&gt;')
	}
	if (reference.includes('&quot;')) {
		result = result.replace(/"/g, '&quot;')
	}
	if (reference.includes('&#39;') || reference.includes('&apos;')) {
		result = result.replace(/'/g, '&#39;')
	}
	return result
}

/**
 * Keep non-breaking spaces in the entity form the source used — writing a raw
 * U+00A0 back would leave an invisible character in the template.
 */
function encodeNbspLike(text: string, reference: string): string {
	if (reference.includes('&nbsp;')) return text.replace(/\u00A0/g, '&nbsp;')
	if (reference.includes('&#160;')) return text.replace(/\u00A0/g, '&#160;')
	return text
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
 * Find an attribute with expression value (e.g., attr={variable}) using balanced brace matching.
 * Returns the match with index and length, or null if not found.
 */
function findExpressionAttribute(text: string, attr: string): { index: number; length: number } | null {
	const exprStart = new RegExp(`${attr}\\s*=\\s*\\{`)
	const match = text.match(exprStart)
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

export function findExpressionSrcAttribute(text: string): { index: number; length: number } | null {
	return findExpressionAttribute(text, 'src')
}

export function findExpressionAltAttribute(text: string): { index: number; length: number } | null {
	return findExpressionAttribute(text, 'alt')
}

/** True when `varName` is bound by a frontmatter `import ... from '<relative-asset-path>'`. */
export function isFrontmatterAssetImport(content: string, varName: string): boolean {
	return findFrontmatterAssetImport(content, varName) !== null
}

/**
 * Extract visible text from an HTML string the way a browser would render it.
 * Text nodes contribute their content, <br> elements become '\n',
 * and whitespace around '\n' is collapsed (matching browser behavior).
 */
function getVisibleText(html: string): string {
	const root = parseHtml(html, { blockTextElements: {} })
	let text = ''
	const walk = (node: ReturnType<typeof parseHtml>) => {
		for (const child of node.childNodes) {
			if (child.nodeType === NodeType.TEXT_NODE) {
				text += child.rawText
			} else if (child.nodeType === NodeType.ELEMENT_NODE && (child as any).rawTagName === 'br') {
				text += '\n'
			} else {
				walk(child as any)
			}
		}
	}
	walk(root)
	// Collapse whitespace around newlines (browser behavior around <br>)
	text = text.replace(/[ \t]*\n[ \t]*/g, '\n')
	return text.trim()
}

interface YamlTarget {
	/** Offset of the value's first character in the snippet */
	start: number
	/** Offset just past the value */
	end: number
	/** The value as the parser resolves it */
	value: string | number
	/** The key the value belongs to, or null for a plain item in a sequence */
	key: string | null
	/** Column of whatever owns the value — a block scalar's body has to clear it */
	ownerColumn: number
}

/**
 * Every value in a snippet an edit could be about — a mapping value at any depth,
 * or an item in a sequence. Mapping *keys* are not values and are left out.
 *
 * The old matcher only ever looked at the snippet's first entry, which is wrong
 * as soon as the snippet spans more than one line — and `collection-finder.ts`
 * builds multi-line snippets routinely. Collecting them all lets the caller
 * insist on exactly one match rather than rewriting whichever field came first.
 */
function findYamlTargets(sourceSnippet: string, allowQuotedKey: boolean): YamlTarget[] {
	let doc
	try {
		doc = parseDocument(sourceSnippet)
		if (doc.errors.length > 0) return []
	} catch {
		return []
	}

	const targets: YamlTarget[] = []
	visitYaml(doc, {
		Scalar(key, node: any, path: any) {
			if (key === 'key' || !node.range) return
			if (typeof node.value !== 'string' && typeof node.value !== 'number') return

			// YAML is a superset of JSON, so `parseDocument` reads a data file's
			// `"banner": "/x.webp"` or `["/x.webp"]` too — and the value would go back
			// as a plain scalar, which is valid YAML and invalid JSON. Quoting is the
			// only hint available here, so only a caller that knows the file is YAML
			// may accept a quoted key or a quoted item.
			const parent = path[path.length - 1]
			const pair = key === 'value' && parent && 'key' in parent ? parent : null
			if (!allowQuotedKey && (pair ? pair.key?.type !== 'PLAIN' : node.type !== 'PLAIN')) return

			const ownerStart = pair ? pair.key.range[0] : dashBefore(sourceSnippet, node.range[0])
			const [start, end] = node.range as [number, number, number]
			const value = node.value as string | number

			// A CRLF file hands back the carriage return as part of the value. It belongs
			// to the line, not to the field, so it stays where it is and out of the match.
			const trailingCr = typeof value === 'string' && value.endsWith('\r') && sourceSnippet[end - 1] === '\r'

			targets.push({
				start,
				end: trailingCr ? end - 1 : end,
				value: trailingCr ? (value as string).slice(0, -1) : value,
				key: pair ? String(pair.key.value) : null,
				ownerColumn: columnOf(sourceSnippet, ownerStart),
			})
		},
	})
	return targets
}

/** Offset of the `-` introducing the sequence item that starts at `valueStart`. */
function dashBefore(sourceSnippet: string, valueStart: number): number {
	const dash = sourceSnippet.lastIndexOf('-', valueStart)
	return dash < 0 ? valueStart : dash
}

/** How far an offset sits from the start of its line. */
function columnOf(sourceSnippet: string, offset: number): number {
	return offset - (sourceSnippet.lastIndexOf('\n', offset - 1) + 1)
}

/**
 * Try to replace a YAML value in a frontmatter snippet.
 * Works on the value's own source range, so a trailing comment, an anchor, or a
 * sequence item's `- ` survives the edit — everything the line holds besides the
 * value is left exactly as it was. The new value goes through the serializer,
 * which quotes whatever would otherwise break the scalar (`:` `#` `[` `-` …).
 * Returns the updated snippet, or null if this approach doesn't apply.
 */
/**
 * A number as YAML spells one, and nothing else. `tryParseYaml` would say yes to
 * `5 # levne`, `&a 130` and `!!int 130` as well — all of which read back as 130
 * while quietly writing a comment, an anchor or a tag into the entry.
 */
const YAML_PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function tryYamlValueReplacement(
	sourceSnippet: string,
	resolvedOriginal: string,
	resolvedNewText: string,
	allowQuotedKey = false,
): string | null {
	// Exactly one field may answer to this text. Two fields holding the same value
	// is not a tie to break — nothing in the snippet says which one the editor
	// meant — so the edit goes to a path that does not have to guess.
	const matches = findYamlTargets(sourceSnippet, allowQuotedKey).filter((candidate) => String(candidate.value) === resolvedOriginal)
	if (matches.length !== 1) return null
	const target = matches[0]!

	// A numeric field has to stay numeric: `stringifyYaml` quotes '120' to keep it
	// a string, which would flip the field's type and fail the collection schema.
	// A date or boolean field is the same problem read the other way — there the
	// plain spelling is what carries the type, so quoting is what would break it.
	const fieldIsTyped = resolvesAsNonString(sourceSnippet.slice(target.start, target.end))
	const replacement = typeof target.value === 'number' && YAML_PLAIN_NUMBER.test(resolvedNewText)
		? resolvedNewText
		: serializeYamlValue(resolvedNewText, target.key, target.ownerColumn, fieldIsTyped)
	if (replacement === null) return null

	const updated = sourceSnippet.slice(0, target.start) + replacement + sourceSnippet.slice(target.end)

	// Serializing and splicing are two separate guesses about the shape of the
	// line. Reading the result back is what makes them one: a value the parser
	// hands back unchanged is safe to write, and anything else falls through to
	// the callers' other strategies rather than corrupting the entry.
	return yamlValueRoundTrips(updated, resolvedNewText) ? updated : null
}

/**
 * Does the value this edit rewrote read back exactly as written? Asked of a
 * snippet whose target we located ourselves, so the value is known and the
 * comparison can be strict.
 */
function yamlValueRoundTrips(updatedSnippet: string, expected: string): boolean {
	return findYamlTargets(normalizeCr(updatedSnippet), true).some((target) => scalarSays(target.value, expected))
}

/**
 * Does this scalar say what the editor sent? A number is compared as a number:
 * `129.90` is how a price is typed, `129.9` is how it reads back, and that is the
 * same value spelled canonically rather than a failed write.
 */
function scalarSays(actual: unknown, expected: string): boolean {
	if (String(actual) === expected) return true
	if (typeof actual !== 'number') return false
	const parsed = tryParseYaml(expected)
	return typeof parsed === 'number' && parsed === actual
}

/**
 * Write the rewritten snippet back, unless it is a frontmatter write that would
 * not survive being read again. `content.replace` takes a *replacement pattern*,
 * so `$&` and friends in the new text have to be escaped or they splice the
 * matched snippet into itself.
 */
function writeSnippet(
	content: string,
	sourceSnippet: string,
	updatedSnippet: string,
	insideYaml: boolean,
	expected: string,
): { success: true; content: string } | { success: false; error: string } {
	if (insideYaml && !yamlSnippetSurvives(sourceSnippet, updatedSnippet, expected)) {
		return {
			success: false,
			error: `"${expected.substring(0, 50)}" cannot be written into this frontmatter field without breaking it`,
		}
	}
	return { success: true, content: content.replace(sourceSnippet, escapeReplacement(updatedSnippet)) }
}

/**
 * Does this snippet still parse, and still say what the edit meant to write?
 *
 * Asked of a write no YAML-aware path claimed, where the edited field could be
 * any scalar in the snippet — a second list item, a field under a parent key, a
 * run of text inside a longer value. So the question is deliberately weaker than
 * `yamlValueRoundTrips`: the new text has to come back readable inside *some*
 * scalar. That still catches what #91 is about — a value the parser rereads as a
 * mapping or a list, or truncates at a `#` — without refusing the many ordinary
 * edits whose result simply isn't `key: <the whole new text>`.
 */
function yamlSnippetSurvives(sourceSnippet: string, updatedSnippet: string, expected: string): boolean {
	const before = yamlScalars(sourceSnippet)
	const after = yamlScalars(updatedSnippet)
	if (!before || !after || before.length !== after.length) return false

	let changed = 0
	for (let i = 0; i < before.length; i++) {
		if (before[i]!.owner !== after[i]!.owner) return false
		const wrote = after[i]!.value
		if (String(before[i]!.value) === String(wrote)) continue
		changed++
		// Whatever this scalar became has to still say what the editor sent. An edit
		// can touch part of a value, so containing it is enough — but an emptied
		// field must actually be empty, where `includes('')` would wave through the
		// `null` a bare `key:` reads back as.
		const saysIt = expected === '' ? wrote === '' : (scalarSays(wrote, expected) || String(wrote).includes(expected))
		if (!saysIt) return false
	}
	return changed > 0
}

/**
 * Every scalar in a snippet, in document order, each tagged with how it hangs off
 * its parent — a mapping key, a mapping value, or an index in a sequence. Two of
 * these lists line up only while the snippet keeps its shape, which is what turns
 * `Ahoj: světe` written into a string field from a value change into a visibly
 * different document. Null when the snippet does not parse at all.
 */
function yamlScalars(snippet: string): Array<{ owner: string; value: unknown }> | null {
	try {
		const doc = parseDocument(normalizeCr(snippet))
		if (doc.errors.length > 0) return null
		const scalars: Array<{ owner: string; value: unknown }> = []
		visitYaml(doc, {
			Scalar(key, node) {
				scalars.push({ owner: String(key), value: node.value })
			},
		})
		return scalars
	} catch {
		return null
	}
}

/** A snippet cut from a CRLF file ends mid-terminator, and a lone `\r` is junk to the parser. */
function normalizeCr(snippet: string): string {
	return snippet.replace(/\r(?=\n|$)/g, '')
}

/**
 * Serialize a value for the right-hand side of a `key:` or a `- `.
 *
 * The value is rendered inside a one-entry container rather than on its own: a
 * bare block scalar whose first line is indented is written with an indentation
 * indicator the serializer computes from its parent, and with no parent it emits
 * a document its own parser rejects. Rendering the container gives it one, and
 * moving owner and body by the same amount afterwards keeps the indicator true.
 */
function serializeYamlValue(value: string, key: string | null, ownerColumn: number, fieldIsTyped = false): string | null {
	let body = renderYamlValue(value, key, undefined)

	// The serializer targets YAML 1.2, where a plain `2026-04-01` is a string.
	// Astro reads frontmatter with a 1.1 parser, which resolves it to a Date — the
	// same silent type flip the numeric branch guards against, in the other
	// direction. Quoting is what keeps a string field a string — and what would
	// break a field that really is a date or a boolean, hence `fieldIsTyped`.
	if (!fieldIsTyped && body !== null && !body.includes('\n') && resolvesAsNonString(body)) {
		body = renderYamlValue(value, key, 'QUOTE_DOUBLE')
	}
	if (body === null || !body.includes('\n')) return body

	const pad = ' '.repeat(ownerColumn)
	const [header, ...rest] = body.split('\n')
	return [header, ...rest.map((line) => (line === '' ? line : pad + line))].join('\n')
}

/** Render the value inside a one-entry container and return just the value's own text. */
function renderYamlValue(value: string, key: string | null, defaultStringType: 'QUOTE_DOUBLE' | undefined): string | null {
	const options = { lineWidth: 0, ...(defaultStringType ? { defaultStringType, defaultKeyType: 'PLAIN' as const } : {}) }
	const rendered = key === null ? stringifyYaml([value], options) : stringifyYaml({ [key]: value }, options)

	let valueStart: number
	try {
		const doc = parseDocument(rendered)
		const first = (doc.contents as any)?.items?.[0]
		const node = key === null ? first : first?.value
		if (!node?.range) return null
		valueStart = node.range[0]
	} catch {
		return null
	}

	// The container holds nothing else, so the value runs to the end. The document's
	// terminating newline is not part of it — unless the block is keep-chomped
	// (`|+`, `|2+`), where the trailing newlines are what it exists to preserve.
	const text = rendered.slice(valueStart)
	return /^[|>]\d*\+/.test(text) ? text : text.replace(/\n$/, '')
}

/** Would a 1.1 parser — the one Astro loads frontmatter with — read this scalar as something other than a string? */
function resolvesAsNonString(scalar: string): boolean {
	try {
		return typeof parseYaml(scalar, { version: '1.1' }) !== 'string'
	} catch {
		return false
	}
}

/** `parseYaml` on text that may not be YAML at all. */
function tryParseYaml(text: string): unknown {
	try {
		return parseYaml(text)
	} catch {
		return undefined
	}
}

/**
 * Replace an image value in a data file (JSON, YAML, MD frontmatter).
 * Matches the original value as a quoted string within the source snippet context.
 */
function tryDataFileValueReplacement(
	content: string,
	sourceSnippet: string,
	originalValue: string,
	newValue: string,
	sourceLine: number,
): { content: string; index: number } | null {
	// Check if snippet contains the original value as a quoted string (JSON or YAML)
	const doubleQuoted = `"${originalValue}"`
	const singleQuoted = `'${originalValue}'`

	let quotedOriginal: string
	let quotedNew: string
	if (sourceSnippet.includes(doubleQuoted)) {
		quotedOriginal = doubleQuoted
		quotedNew = `"${newValue}"`
	} else if (sourceSnippet.includes(singleQuoted)) {
		quotedOriginal = singleQuoted
		quotedNew = `'${newValue}'`
	} else {
		return null
	}

	const updatedSnippet = sourceSnippet.replace(quotedOriginal, escapeReplacement(quotedNew))
	if (updatedSnippet === sourceSnippet) return null

	// Find the snippet in content near the source line
	let searchStart = 0
	if (sourceLine > 1) {
		let linesFound = 0
		for (let j = 0; j < content.length; j++) {
			if (content[j] === '\n' && ++linesFound >= sourceLine - 1) {
				searchStart = j + 1
				break
			}
		}
	}
	const snippetIdx = content.indexOf(sourceSnippet, searchStart)
	if (snippetIdx < 0) return null

	return {
		content: content.slice(0, snippetIdx) + updatedSnippet + content.slice(snippetIdx + sourceSnippet.length),
		index: snippetIdx,
	}
}

/**
 * Try to apply a text change when the mismatch is due to <br> normalization.
 * The browser normalizes <br class="..." /> to plain <br> and collapses surrounding whitespace.
 * This function preserves the original <br> elements (with attributes) and surrounding indentation.
 * Returns the updated snippet, or null if this approach doesn't apply.
 */
function tryBrNormalizedChange(
	sourceSnippet: string,
	resolvedOriginal: string,
	resolvedNewText: string,
): string | null {
	// Only applies when the browser text contains <br>
	if (!resolvedOriginal.includes('<br>')) return null

	// Verify that the visible text matches after normalization
	const sourceVisible = getVisibleText(sourceSnippet)
	const originalVisible = getVisibleText(resolvedOriginal)
	if (sourceVisible !== originalVisible) return null

	// Split browser text by <br> into segments
	const originalSegments = resolvedOriginal.split('<br>')
	const newSegments = resolvedNewText.split('<br>')

	// If segment count changed, user added/removed line breaks — let other fallbacks handle it
	if (originalSegments.length !== newSegments.length) return null

	// Parse the source snippet and identify text nodes and br elements
	const root = parseHtml(sourceSnippet, { blockTextElements: {} })

	// Find the outer element (e.g., <h1>, <p>)
	const outerElement = root.childNodes.find(
		(n) => n.nodeType === NodeType.ELEMENT_NODE,
	) as any
	if (!outerElement) return null

	// Collect text nodes between br boundaries
	const groups: Array<Array<{ node: any; index: number }>> = [[]]
	for (let i = 0; i < outerElement.childNodes.length; i++) {
		const child = outerElement.childNodes[i]
		if (child.nodeType === NodeType.ELEMENT_NODE && (child as any).rawTagName === 'br') {
			groups.push([])
		} else if (child.nodeType === NodeType.TEXT_NODE) {
			groups[groups.length - 1]!.push({ node: child, index: i })
		}
	}

	// Number of groups should match number of segments
	if (groups.length !== originalSegments.length) return null

	// Replace text content in each group
	let result = sourceSnippet
	for (let g = groups.length - 1; g >= 0; g--) {
		const group = groups[g]!
		const origSegment = originalSegments[g]!.trim()
		const newSegment = newSegments[g]!.trim()

		if (origSegment === newSegment) continue

		// Find the text node in this group that contains the meaningful text
		for (const { node } of group) {
			const raw: string = node.rawText
			const trimmed = raw.trim()
			if (!trimmed) continue

			// Check if this text node's trimmed content matches the original segment
			if (trimmed === origSegment) {
				// Replace the meaningful text, preserving surrounding whitespace
				const leadingWs = raw.slice(0, raw.indexOf(trimmed))
				const trailingWs = raw.slice(raw.indexOf(trimmed) + trimmed.length)
				const newRaw = leadingWs + newSegment + trailingWs
				result = result.replace(raw, escapeReplacement(newRaw))
				break
			}
		}
	}

	return result !== sourceSnippet ? result : null
}
