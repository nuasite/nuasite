import { parse as parseBabel } from '@babel/parser'
import fs from 'node:fs/promises'
import { getProjectRoot } from '../config'
import type { ManifestWriter } from '../manifest-writer'
import type { CmsManifest, ComponentInstance } from '../types'
import { acquireFileLock, normalizePagePath, resolveAndValidatePath } from '../utils'
import {
	findComponentInvocationFile,
	findComponentInvocationLine,
	findFrontmatterEnd,
	getComponentOccurrenceIndex,
	getIndentation,
	normalizeFilePath,
} from './component-ops'

export interface AddArrayItemRequest {
	referenceComponentId: string
	position: 'before' | 'after'
	props: Record<string, unknown>
	meta?: { source: string; url: string }
}

export interface AddArrayItemResponse {
	success: boolean
	message?: string
	sourceFile?: string
	error?: string
}

export interface RemoveArrayItemRequest {
	componentId: string
	meta?: { source: string; url: string }
}

export interface RemoveArrayItemResponse {
	success: boolean
	message?: string
	sourceFile?: string
	error?: string
}

/**
 * Scan backwards from a component invocation line to find a `.map(` pattern
 * and extract the array variable name.
 *
 * Looks for patterns like:
 *   {packages.map((pkg) => <PackageCard {...pkg} />)}
 *   {items.map(item => (
 */
export function detectArrayPattern(
	lines: string[],
	invocationLineIndex: number,
): { arrayVarName: string; mapLineIndex: number } | null {
	// Search up to 5 lines above (the `.map(` may be on the same line or a few lines above)
	const searchStart = Math.max(0, invocationLineIndex - 5)
	for (let i = invocationLineIndex; i >= searchStart; i--) {
		const line = lines[i]!
		// Match patterns like: {varName.map( or varName.map(
		const match = line.match(/\{?\s*(\w+)\.map\s*\(/)
		if (match) {
			return { arrayVarName: match[1]!, mapLineIndex: i }
		}
	}
	return null
}

interface ArrayElementBounds {
	startLine: number
	endLine: number
}

/**
 * Parse frontmatter with Babel, walk the AST to find the array variable declaration,
 * and return the line bounds of each element.
 *
 * @param frontmatterContent - The raw frontmatter code (between --- delimiters)
 * @param frontmatterStartLine - The 0-indexed line where frontmatter content starts in the file
 *                                (line after the opening `---`)
 * @param arrayVarName - The variable name of the array to find
 */
export function findArrayDeclaration(
	frontmatterContent: string,
	frontmatterStartLine: number,
	arrayVarName: string,
): ArrayElementBounds[] | null {
	let ast: ReturnType<typeof parseBabel>
	try {
		ast = parseBabel(frontmatterContent, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		})
	} catch {
		return null
	}

	// Walk the top-level statements to find the array declaration
	for (const node of ast.program.body) {
		// Handle: const foo = [...]
		if (node.type === 'VariableDeclaration') {
			for (const decl of node.declarations) {
				if (
					decl.id.type === 'Identifier'
					&& decl.id.name === arrayVarName
					&& decl.init?.type === 'ArrayExpression'
				) {
					return extractElementBounds(decl.init.elements, frontmatterStartLine)
				}
			}
		}
		// Handle: export const foo = [...]
		if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
			for (const decl of node.declaration.declarations) {
				if (
					decl.id.type === 'Identifier'
					&& decl.id.name === arrayVarName
					&& decl.init?.type === 'ArrayExpression'
				) {
					return extractElementBounds(decl.init.elements, frontmatterStartLine)
				}
			}
		}
	}

	return null
}

function extractElementBounds(
	elements: any[],
	frontmatterStartLine: number,
): ArrayElementBounds[] {
	const bounds: ArrayElementBounds[] = []
	for (const el of elements) {
		if (el && el.loc) {
			bounds.push({
				// Babel loc is 1-indexed; convert to 0-indexed file lines
				startLine: el.loc.start.line - 1 + frontmatterStartLine,
				endLine: el.loc.end.line - 1 + frontmatterStartLine,
			})
		}
	}
	return bounds
}

/**
 * Resolve the file, lines, invocation index, and array info for a component.
 */
async function resolveArrayContext(
	component: ComponentInstance,
	manifest: CmsManifest,
	pageUrl: string,
) {
	const projectRoot = getProjectRoot()

	const invocation = await findComponentInvocationFile(
		projectRoot,
		pageUrl,
		manifest,
		component,
	)

	const filePath = invocation?.filePath
		?? normalizeFilePath(component.invocationSourcePath ?? component.sourcePath)

	const fullPath = resolveAndValidatePath(filePath)
	const content = await fs.readFile(fullPath, 'utf-8')
	const lines = content.split('\n')

	let refLineIndex: number
	if (invocation) {
		refLineIndex = invocation.lineIndex
	} else {
		const occurrenceIndex = getComponentOccurrenceIndex(manifest, component)
		refLineIndex = findComponentInvocationLine(lines, component.componentName, occurrenceIndex)
	}

	if (refLineIndex < 0 || refLineIndex >= lines.length) {
		return null
	}

	const pattern = detectArrayPattern(lines, refLineIndex)
	if (!pattern) {
		return null
	}

	// Extract frontmatter content
	const fmEnd = findFrontmatterEnd(lines)
	if (fmEnd === 0) return null // No frontmatter

	// frontmatterStartLine is the line after the opening ---
	const frontmatterStartLine = 1 // Line 0 is `---`, line 1 is first content line
	const frontmatterContent = lines.slice(1, fmEnd - 1).join('\n')

	const elementBounds = findArrayDeclaration(
		frontmatterContent,
		frontmatterStartLine,
		pattern.arrayVarName,
	)

	if (!elementBounds || elementBounds.length === 0) {
		return null
	}

	// Determine which array element this component corresponds to.
	// The invocationIndex tells us the Nth occurrence of this component in the template,
	// which maps directly to the Nth array element.
	const occurrenceIndex = getComponentOccurrenceIndex(manifest, component)
	// Count only components with the same name AND same invocationSourcePath to get array index
	const sameSourceComponents = Object.values(manifest.components)
		.filter(c =>
			c.componentName === component.componentName
			&& c.invocationSourcePath === component.invocationSourcePath
		)
	const arrayIndex = sameSourceComponents.findIndex(c => c.id === component.id)

	if (arrayIndex < 0 || arrayIndex >= elementBounds.length) {
		return null
	}

	return {
		filePath,
		fullPath,
		lines,
		content,
		elementBounds,
		arrayIndex,
		frontmatterContent,
		frontmatterStartLine,
		arrayVarName: pattern.arrayVarName,
		occurrenceIndex,
	}
}

export async function handleRemoveArrayItem(
	request: RemoveArrayItemRequest,
	manifestWriter: ManifestWriter,
): Promise<RemoveArrayItemResponse> {
	const { componentId, meta } = request

	if (!meta?.url) {
		return { success: false, error: 'Page URL is required in meta' }
	}

	const pagePath = normalizePagePath(meta.url)
	const pageData = manifestWriter.getPageManifest(pagePath)
	if (!pageData) {
		return { success: false, error: 'Page manifest not found' }
	}

	const manifest: CmsManifest = {
		entries: pageData.entries,
		components: pageData.components,
		componentDefinitions: manifestWriter.getComponentDefinitions(),
	}

	const component = manifest.components[componentId]
	if (!component) {
		return { success: false, error: `Component '${componentId}' not found in manifest` }
	}

	try {
		const ctx = await resolveArrayContext(component, manifest, meta.url)
		if (!ctx) {
			return { success: false, error: 'Could not detect array pattern for this component' }
		}

		const { fullPath, lines, elementBounds, arrayIndex } = ctx

		const release = await acquireFileLock(fullPath)
		try {
			// Re-read the file to avoid stale data
			const freshContent = await fs.readFile(fullPath, 'utf-8')
			const freshLines = freshContent.split('\n')

			const bounds = elementBounds[arrayIndex]!
			let removeStart = bounds.startLine
			let removeEnd = bounds.endLine

			// Clean up trailing comma on the line after the element, or leading comma
			// Check if there's a trailing comma after the element's end line
			const afterEndLine = freshLines[removeEnd]
			if (afterEndLine !== undefined) {
				// If the element's end line has a trailing comma, it'll be removed with the element
				// But we also need to handle the case where the PREVIOUS element's trailing comma
				// now becomes the last element (remove its trailing comma)
			}

			// Check line after removeEnd for a comma-only or blank line
			if (removeEnd + 1 < freshLines.length && freshLines[removeEnd + 1]!.trim() === '') {
				removeEnd++
			}

			// Remove the element lines
			freshLines.splice(removeStart, removeEnd - removeStart + 1)

			// Clean up: if the previous element now ends with a trailing comma
			// and there's a closing bracket right after, remove the comma
			if (removeStart > 0 && removeStart <= freshLines.length) {
				const prevLine = freshLines[removeStart - 1]!
				const nextLine = freshLines[removeStart]
				if (nextLine !== undefined && nextLine.trim().startsWith(']') && prevLine.trimEnd().endsWith(',')) {
					freshLines[removeStart - 1] = prevLine.replace(/,\s*$/, '')
				}
			}

			await fs.writeFile(fullPath, freshLines.join('\n'), 'utf-8')

			return {
				success: true,
				message: `Successfully removed array item (${component.componentName} at index ${arrayIndex})`,
				sourceFile: ctx.filePath,
			}
		} finally {
			release()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

export async function handleAddArrayItem(
	request: AddArrayItemRequest,
	manifestWriter: ManifestWriter,
): Promise<AddArrayItemResponse> {
	const { referenceComponentId, position, props, meta } = request

	if (!meta?.url) {
		return { success: false, error: 'Page URL is required in meta' }
	}

	const pagePath = normalizePagePath(meta.url)
	const pageData = manifestWriter.getPageManifest(pagePath)
	if (!pageData) {
		return { success: false, error: 'Page manifest not found' }
	}

	const manifest: CmsManifest = {
		entries: pageData.entries,
		components: pageData.components,
		componentDefinitions: manifestWriter.getComponentDefinitions(),
	}

	const referenceComponent = manifest.components[referenceComponentId]
	if (!referenceComponent) {
		return { success: false, error: `Reference component '${referenceComponentId}' not found in manifest` }
	}

	try {
		const ctx = await resolveArrayContext(referenceComponent, manifest, meta.url)
		if (!ctx) {
			return { success: false, error: 'Could not detect array pattern for this component' }
		}

		const { fullPath, elementBounds, arrayIndex } = ctx

		const release = await acquireFileLock(fullPath)
		try {
			const freshContent = await fs.readFile(fullPath, 'utf-8')
			const freshLines = freshContent.split('\n')

			const refBounds = elementBounds[arrayIndex]!

			// Generate JS object literal from props
			const newElement = generateObjectLiteral(props)

			// Get indentation from the reference element
			const indentation = getIndentation(freshLines[refBounds.startLine]!)

			// Indent the new element
			const indentedLines = newElement
				.split('\n')
				.map((line, i) => {
					if (i === 0) return indentation + line
					if (line.trim()) return indentation + line
					return line
				})
				.join('\n')

			if (position === 'before') {
				// Insert before the reference element
				const insertLine = refBounds.startLine
				freshLines.splice(insertLine, 0, indentedLines + ',')
			} else {
				// Insert after the reference element
				const insertLine = refBounds.endLine + 1
				// Ensure the reference element has a trailing comma
				const refEndLine = freshLines[refBounds.endLine]!
				if (!refEndLine.trimEnd().endsWith(',')) {
					freshLines[refBounds.endLine] = refEndLine.replace(/(\s*)$/, ',$1')
				}
				freshLines.splice(insertLine, 0, indentedLines + ',')
			}

			// Clean up trailing comma before closing bracket
			// Find the closing ] and remove comma from the last element
			for (let i = freshLines.length - 1; i >= 0; i--) {
				if (freshLines[i]!.trim().startsWith(']')) {
					const prev = freshLines[i - 1]
					if (prev && prev.trimEnd().endsWith(',')) {
						// Check if this is the array we're editing by scanning backwards
						// to find the array variable
						freshLines[i - 1] = prev.replace(/,(\s*)$/, '$1')
					}
					break
				}
			}

			await fs.writeFile(fullPath, freshLines.join('\n'), 'utf-8')

			return {
				success: true,
				message: `Successfully added array item ${position} index ${arrayIndex}`,
				sourceFile: ctx.filePath,
			}
		} finally {
			release()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

/**
 * Generate a JavaScript object literal string from props.
 * Example: { name: 'Components', slug: 'components' }
 */
function generateObjectLiteral(props: Record<string, unknown>): string {
	const entries = Object.entries(props)
	if (entries.length === 0) return '{}'

	const parts = entries.map(([key, value]) => {
		const safeKey = /^[a-zA-Z_$]\w*$/.test(key) ? key : `'${key}'`
		return `${safeKey}: ${formatValue(value)}`
	})

	if (parts.length <= 3 && parts.join(', ').length < 60) {
		return `{ ${parts.join(', ')} }`
	}

	return `{\n\t${parts.join(',\n\t')},\n}`
}

function formatValue(value: unknown): string {
	if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (value === null || value === undefined) return 'undefined'
	if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
	if (typeof value === 'object') return generateObjectLiteral(value as Record<string, unknown>)
	return String(value)
}
