import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from '../config'
import type { ManifestWriter } from '../manifest-writer'
import type { CmsManifest, ComponentDefinition, ComponentInstance } from '../types'
import { acquireFileLock, escapeRegex, normalizePagePath, resolveAndValidatePath } from '../utils'

export type InsertPosition = 'before' | 'after'

export interface InsertComponentRequest {
	position: InsertPosition
	referenceComponentId: string
	componentName: string
	props: Record<string, unknown>
	meta?: { source: string; url: string }
}

export interface InsertComponentResponse {
	success: boolean
	message?: string
	sourceFile?: string
	error?: string
}

export interface RemoveComponentRequest {
	componentId: string
	meta?: { source: string; url: string }
}

export interface RemoveComponentResponse {
	success: boolean
	message?: string
	sourceFile?: string
	error?: string
}

export async function handleInsertComponent(
	request: InsertComponentRequest,
	manifestWriter: ManifestWriter,
): Promise<InsertComponentResponse> {
	const { position, referenceComponentId, componentName, props, meta } = request

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

	// Find the reference component
	const referenceComponent = manifest.components[referenceComponentId]
	if (!referenceComponent) {
		return { success: false, error: `Reference component '${referenceComponentId}' not found in manifest` }
	}

	// Get component definition
	const componentDef = manifest.componentDefinitions[componentName]
	if (!componentDef) {
		return { success: false, error: `Component definition '${componentName}' not found in manifest` }
	}

	try {
		const projectRoot = getProjectRoot()

		// Find the invocation file
		const invocation = await findComponentInvocationFile(
			projectRoot,
			meta.url,
			manifest,
			referenceComponent,
		)

		const filePath = invocation?.filePath
			?? normalizeFilePath(referenceComponent.invocationSourcePath ?? referenceComponent.sourcePath)

		const fullPath = resolveAndValidatePath(filePath)
		const release = await acquireFileLock(fullPath)
		try {
			let currentContent: string
			try {
				currentContent = await fs.readFile(fullPath, 'utf-8')
			} catch {
				return { success: false, error: `Source file not found: ${filePath}` }
			}

			const lines = currentContent.split('\n')

			let refLineIndex: number
			if (invocation) {
				refLineIndex = invocation.lineIndex
			} else {
				const occurrenceIndex = getComponentOccurrenceIndex(manifest, referenceComponent)
				refLineIndex = findComponentInvocationLine(lines, referenceComponent.componentName, occurrenceIndex)
				if (refLineIndex < 0) {
					refLineIndex = referenceComponent.sourceLine - 1
				}
			}

			if (refLineIndex < 0 || refLineIndex >= lines.length) {
				return { success: false, error: `Invalid source line for reference component: ${refLineIndex + 1}` }
			}

			const newComponentJsx = generateComponentJsx(componentName, props, componentDef)

			const { startLine, endLine } = findComponentBounds(
				lines,
				refLineIndex,
				referenceComponent.componentName,
			)

			const insertIndex = position === 'before' ? startLine : endLine + 1
			const indentation = getIndentation(lines[startLine]!)

			const indentedJsx = newComponentJsx
				.split('\n')
				.map((line) => (line.trim() ? indentation + line : line))
				.join('\n')

			lines.splice(insertIndex, 0, indentedJsx)
			await fs.writeFile(fullPath, lines.join('\n'), 'utf-8')

			return {
				success: true,
				message: `Successfully inserted ${componentName} ${position} ${referenceComponent.componentName}`,
				sourceFile: filePath,
			}
		} finally {
			release()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

export async function handleRemoveComponent(
	request: RemoveComponentRequest,
	manifestWriter: ManifestWriter,
): Promise<RemoveComponentResponse> {
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
		const projectRoot = getProjectRoot()

		const invocation = await findComponentInvocationFile(
			projectRoot,
			meta.url,
			manifest,
			component,
		)

		const filePath = invocation?.filePath
			?? normalizeFilePath(component.invocationSourcePath ?? component.sourcePath)

		const fullPath = resolveAndValidatePath(filePath)
		const release = await acquireFileLock(fullPath)
		try {
			let currentContent: string
			try {
				currentContent = await fs.readFile(fullPath, 'utf-8')
			} catch {
				return { success: false, error: `Source file not found: ${filePath}` }
			}

			const lines = currentContent.split('\n')

			let refLineIndex: number
			if (invocation) {
				refLineIndex = invocation.lineIndex
			} else {
				const occurrenceIndex = getComponentOccurrenceIndex(manifest, component)
				refLineIndex = findComponentInvocationLine(lines, component.componentName, occurrenceIndex)
				if (refLineIndex < 0) {
					refLineIndex = component.sourceLine - 1
				}
			}

			if (refLineIndex < 0 || refLineIndex >= lines.length) {
				return { success: false, error: `Invalid source line for component: ${refLineIndex + 1}` }
			}

			const { startLine, endLine } = findComponentBounds(
				lines,
				refLineIndex,
				component.componentName,
			)

			let removeCount = endLine - startLine + 1
			if (endLine + 1 < lines.length && lines[endLine + 1]!.trim() === '') {
				removeCount++
			}

			lines.splice(startLine, removeCount)
			await fs.writeFile(fullPath, lines.join('\n'), 'utf-8')

			return {
				success: true,
				message: `Successfully removed ${component.componentName} component`,
				sourceFile: filePath,
			}
		} finally {
			release()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

// --- Helper functions ported from CmsComponentHandler ---

function findComponentBounds(
	lines: string[],
	startLineIndex: number,
	componentName: string,
): { startLine: number; endLine: number } {
	const startLine = startLineIndex

	// Check if the opening tag is self-closing (may span multiple lines)
	// Scan from startLine forward until we find either '/>' or '>' to determine tag style
	let tagClosed = false
	for (let i = startLineIndex; i < lines.length; i++) {
		const currentLine = lines[i]!
		// Check for self-closing '/>' before any '>' on this line
		const selfCloseIdx = currentLine.indexOf('/>')
		const openEndIdx = currentLine.indexOf('>')

		if (selfCloseIdx >= 0 && (openEndIdx < 0 || selfCloseIdx <= openEndIdx)) {
			// Self-closing tag found
			return { startLine, endLine: i }
		}
		if (openEndIdx >= 0) {
			// Opening tag closed with '>' (not self-closing)
			tagClosed = true
			break
		}
	}

	// If the tag never closed, return just the start line
	if (!tagClosed) {
		return { startLine, endLine: startLineIndex }
	}

	const escapedName = escapeRegex(componentName)
	const closingTag = `</${componentName}>`
	let depth = 1
	let endLine = startLineIndex

	for (let i = startLineIndex + 1; i < lines.length; i++) {
		const currentLine = lines[i]!

		const openingMatches = currentLine.match(new RegExp(`<${escapedName}(?:\\s|>)`, 'g'))
		if (openingMatches) {
			for (const match of openingMatches) {
				const tagStart = currentLine.indexOf(match)
				const restOfTag = currentLine.slice(tagStart)
				if (!restOfTag.includes('/>') || restOfTag.indexOf('/>') > restOfTag.indexOf('>')) {
					depth++
				}
			}
		}

		const closingMatches = currentLine.match(new RegExp(escapeRegex(closingTag), 'g'))
		if (closingMatches) {
			depth -= closingMatches.length
		}

		if (depth <= 0) {
			endLine = i
			break
		}
	}

	return { startLine, endLine }
}

function getPageFileCandidates(pageUrl: string): string[] {
	let pathname: string
	try {
		const url = new URL(pageUrl)
		pathname = url.pathname
	} catch {
		pathname = pageUrl.split('?')[0]?.split('#')[0] ?? '/'
	}

	if (pathname.length > 1 && pathname.endsWith('/')) {
		pathname = pathname.slice(0, -1)
	}

	if (pathname === '/' || pathname === '') {
		return ['src/pages/index.astro', 'src/pages/index.mdx']
	}

	const p = pathname.slice(1)
	return [
		`src/pages/${p}.astro`,
		`src/pages/${p}/index.astro`,
		`src/pages/${p}.mdx`,
		`src/pages/${p}/index.mdx`,
	]
}

function getComponentOccurrenceIndex(
	manifest: CmsManifest,
	referenceComponent: ComponentInstance,
): number {
	if (referenceComponent.invocationIndex !== undefined) {
		return referenceComponent.invocationIndex
	}

	const componentName = referenceComponent.componentName
	const invocationSource = referenceComponent.invocationSourcePath
	const sameNameComponents = Object.values(manifest.components)
		.filter(c =>
			c.componentName === componentName
			&& (!invocationSource || c.invocationSourcePath === invocationSource),
		)

	const index = sameNameComponents.findIndex(c => c.id === referenceComponent.id)
	return index >= 0 ? index : 0
}

async function findComponentInvocationFile(
	projectRoot: string,
	pageUrl: string,
	manifest: CmsManifest,
	referenceComponent: ComponentInstance,
): Promise<{ filePath: string; lineIndex: number } | null> {
	// If manifest provides invocationSourcePath, use it directly
	if (referenceComponent.invocationSourcePath) {
		const filePath = normalizeFilePath(referenceComponent.invocationSourcePath)
		const fullPath = path.resolve(projectRoot, filePath)
		try {
			const content = await fs.readFile(fullPath, 'utf-8')
			const lines = content.split('\n')
			const lineIndex = findComponentInvocationLine(
				lines,
				referenceComponent.componentName,
				referenceComponent.invocationIndex ?? 0,
			)
			if (lineIndex >= 0) {
				return { filePath, lineIndex }
			}
		} catch {
			// File not found, fall through to candidates
		}
	}

	// Derive page file path from URL and search for the component invocation
	const candidates = getPageFileCandidates(pageUrl)
	const occurrenceIndex = getComponentOccurrenceIndex(manifest, referenceComponent)

	for (const candidate of candidates) {
		const fullPath = path.resolve(projectRoot, candidate)
		try {
			const content = await fs.readFile(fullPath, 'utf-8')
			const lines = content.split('\n')
			const lineIndex = findComponentInvocationLine(
				lines,
				referenceComponent.componentName,
				occurrenceIndex,
			)
			if (lineIndex >= 0) {
				return { filePath: candidate, lineIndex }
			}
		} catch {
			// File not found, try next candidate
		}
	}

	return null
}

function findComponentInvocationLine(
	lines: string[],
	componentName: string,
	occurrenceIndex: number,
): number {
	const pattern = new RegExp(`<${escapeRegex(componentName)}(?:\\s|>|/>)`)
	let found = 0
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i]!)) {
			if (found === occurrenceIndex) return i
			found++
		}
	}
	return found > 0 ? findComponentInvocationLine(lines, componentName, 0) : -1
}

function generateComponentJsx(
	componentName: string,
	props: Record<string, unknown>,
	_definition: ComponentDefinition,
): string {
	const propsString = Object.entries(props)
		.map(([key, value]) => {
			if (typeof value === 'string') {
				return `${key}="${escapeHtml(value)}"`
			}
			if (typeof value === 'boolean') {
				return value ? key : `${key}={false}`
			}
			if (typeof value === 'number') {
				return `${key}={${value}}`
			}
			return `${key}={${JSON.stringify(value)}}`
		})
		.join(' ')

	if (propsString) {
		return `<${componentName} ${propsString} />`
	}
	return `<${componentName} />`
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function getIndentation(line: string): string {
	const match = line.match(/^(\s*)/)
	return match ? match[1]! : ''
}

function normalizeFilePath(p: string): string {
	return p.startsWith('/') ? p.slice(1) : p
}

