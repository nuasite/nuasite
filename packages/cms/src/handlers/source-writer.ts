import { NodeType, parse as parseHtml } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
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
	if (replacedIndex < 0 && change.sourceSnippet) {
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
		if (updated !== snippet) return content.replace(snippet, updated)
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

	// Never write HTML back into entries that don't allow styling — these are string props,
	// collection fields, etc. where inline HTML would produce invalid source code.
	const stylingAllowed = manifest.entries[change.cmsId]?.allowStyling !== false
	const newText = stylingAllowed ? (htmlValue ?? newValue) : newValue

	// When originalValue contains CMS placeholders (child elements like {{cms:cms-5}}),
	// replace only the text segments between placeholders directly in the sourceSnippet.
	// This avoids resolving placeholders via child sourceSnippets, which can be incorrect
	// when multiple inline children share the same source line (extractCompleteTagSnippet
	// returns the entire line, not just the individual child tag).
	const placeholderPattern = /\{\{cms:[^}]+\}\}/g
	if (placeholderPattern.test(originalValue)) {
		return applyTextChangeWithPlaceholders(content, sourceSnippet, originalValue, newText)
	}

	// No placeholders — resolve and match directly
	const resolvedNewText = resolveCmsPlaceholders(newText, manifest)
	const resolvedOriginal = resolveCmsPlaceholders(originalValue, manifest)

	// Replace resolvedOriginal with resolvedNewText WITHIN the sourceSnippet
	const updatedSnippet = sourceSnippet.replace(resolvedOriginal, resolvedNewText)

	if (updatedSnippet === sourceSnippet) {
		// Try YAML key-value replacement for multi-line frontmatter values
		// (e.g., "title: long text\n  that wraps")
		const yamlResult = tryYamlValueReplacement(sourceSnippet, resolvedOriginal, resolvedNewText)
		if (yamlResult !== null) {
			return { success: true, content: content.replace(sourceSnippet, yamlResult) }
		}

		// Try AST-based <br> normalization (browser normalizes <br class="..." /> to <br>
		// and collapses surrounding whitespace/indentation)
		const brResult = tryBrNormalizedChange(sourceSnippet, resolvedOriginal, resolvedNewText)
		if (brResult !== null) {
			return { success: true, content: content.replace(sourceSnippet, brResult) }
		}

		// resolvedOriginal wasn't found in snippet - try HTML entity handling
		const matchedText = findTextInSnippet(sourceSnippet, resolvedOriginal)
		if (matchedText) {
			const updatedWithEntity = sourceSnippet.replace(matchedText, resolvedNewText)
			return { success: true, content: content.replace(sourceSnippet, updatedWithEntity) }
		}
		// Try inner content replacement for text spanning inline HTML elements
		// (e.g., <h3>text part 1 <span class="...">text part 2</span></h3>)
		const innerMatch = sourceSnippet.match(/^(\s*<(\w+)\b[^>]*>)([\s\S]*)(<\/\2>\s*)$/)
		if (innerMatch) {
			const [, openTag, , innerContent, closeTag] = innerMatch
			const textOnly = innerContent!.replace(/<[^>]+>/g, '')
			if (textOnly === resolvedOriginal) {
				return { success: true, content: content.replace(sourceSnippet, openTag + resolvedNewText + closeTag) }
			}
		}

		return {
			success: false,
			error: `Original text "${resolvedOriginal.substring(0, 50)}..." not found in source snippet`,
		}
	}

	return { success: true, content: content.replace(sourceSnippet, updatedSnippet) }
}

/**
 * Apply text change when originalValue contains CMS placeholders.
 * Splits by placeholder boundaries and replaces only the changed text segments.
 */
function applyTextChangeWithPlaceholders(
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
			updatedSnippet = updatedSnippet.replace(matchedText, newPart)
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

	let pattern = escapeRegex(decodedText)
	for (const [char, entity] of entityMap) {
		const escapedChar = escapeRegex(char)
		const escapedEntity = escapeRegex(entity)
		pattern = pattern.replace(new RegExp(escapedChar, 'g'), `(?:${escapedChar}|${escapedEntity})`)
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

/**
 * Try to replace a YAML value in a frontmatter snippet.
 * Uses the YAML parser to resolve the value (handles all scalar styles:
 * plain wrapping, single/double quoted, block literal `|`, folded `>`).
 * Returns the updated snippet, or null if this approach doesn't apply.
 */
function tryYamlValueReplacement(
	sourceSnippet: string,
	resolvedOriginal: string,
	resolvedNewText: string,
): string | null {
	// Must look like a YAML key: value pair
	const keyMatch = sourceSnippet.match(/^(\s*([\w][\w-]*):\s*)/)
	if (!keyMatch) return null

	// Use the YAML parser to resolve the value — handles all scalar styles
	try {
		const parsed = parseYaml(sourceSnippet)
		if (parsed == null || typeof parsed !== 'object') return null
		const value = (parsed as Record<string, unknown>)[keyMatch[2]!]
		if (typeof value !== 'string' && typeof value !== 'number') return null
		if (String(value) !== resolvedOriginal) return null
	} catch {
		return null
	}

	// Use the YAML library to safely serialize the new value,
	// handling characters that would break plain scalars (: # [ ] { } , etc.)
	const serialized = stringifyYaml(resolvedNewText, { lineWidth: 0 }).trimEnd()
	return `${keyMatch[1]}${serialized}`
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

	const updatedSnippet = sourceSnippet.replace(quotedOriginal, quotedNew)
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
				result = result.replace(raw, newRaw)
				break
			}
		}
	}

	return result !== sourceSnippet ? result : null
}
