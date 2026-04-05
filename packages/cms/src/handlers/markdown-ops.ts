import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'yaml'
import { getProjectRoot } from '../config'
import type { ComponentDefinition } from '../types'
import { acquireFileLock, isNodeError, relativeImportPath, resolveAndValidatePath, slugify } from '../utils'

export interface BlogFrontmatter {
	title: string
	date: string
	author?: string
	categories?: string[]
	excerpt?: string
	featuredImage?: string
	draft?: boolean
	[key: string]: unknown
}

export interface CreateMarkdownRequest {
	collection: string
	title: string
	slug: string
	frontmatter?: Partial<BlogFrontmatter>
	content?: string
	/** File extension override for data collections (e.g. 'json', 'yaml') */
	fileExtension?: string
}

export interface CreateMarkdownResponse {
	success: boolean
	filePath?: string
	slug?: string
	error?: string
}

export interface UpdateMarkdownRequest {
	filePath: string
	frontmatter?: Partial<BlogFrontmatter>
	content?: string
}

export interface UpdateMarkdownResponse {
	success: boolean
	error?: string
}

export interface DeleteMarkdownRequest {
	filePath: string
}

export interface DeleteMarkdownResponse {
	success: boolean
	error?: string
}

export interface GetMarkdownContentResponse {
	content: string
	frontmatter: BlogFrontmatter
	filePath: string
}

export async function handleGetMarkdownContent(
	filePath: string,
): Promise<GetMarkdownContentResponse | null> {
	try {
		const fullPath = resolveAndValidatePath(filePath)
		const raw = await fs.readFile(fullPath, 'utf-8')

		if (isDataFile(filePath)) {
			const data = filePath.endsWith('.json') ? JSON.parse(raw) : yaml.parse(raw)
			return {
				content: '',
				frontmatter: (data && typeof data === 'object' ? data : {}) as BlogFrontmatter,
				filePath,
			}
		}

		const { frontmatter, content } = parseFrontmatter(raw)
		return {
			content,
			frontmatter: frontmatter as BlogFrontmatter,
			filePath,
		}
	} catch {
		return null
	}
}

export async function handleUpdateMarkdown(
	request: UpdateMarkdownRequest,
	componentDefinitions?: Record<string, ComponentDefinition>,
): Promise<UpdateMarkdownResponse> {
	try {
		const fullPath = resolveAndValidatePath(request.filePath)
		const release = await acquireFileLock(fullPath)
		try {
			if (isDataFile(request.filePath)) {
				// Data collections: merge and write JSON/YAML directly
				const raw = await fs.readFile(fullPath, 'utf-8')
				const existing = request.filePath.endsWith('.json') ? JSON.parse(raw) : yaml.parse(raw)
				const merged = { ...(existing ?? {}), ...request.frontmatter }

				const output = request.filePath.endsWith('.json')
					? JSON.stringify(merged, null, 2) + '\n'
					: yaml.stringify(merged)
				await fs.writeFile(fullPath, output, 'utf-8')
			} else {
				const raw = await fs.readFile(fullPath, 'utf-8')
				const existing = parseFrontmatter(raw)

				const mergedFrontmatter: BlogFrontmatter = {
					...(existing.frontmatter as BlogFrontmatter),
					...request.frontmatter,
				}

				let finalContent = request.content ?? existing.content

				if (request.filePath.endsWith('.mdx') && componentDefinitions) {
					finalContent = ensureMdxImports(finalContent, request.filePath, componentDefinitions)
				}

				const markdownContent = serializeFrontmatter(mergedFrontmatter, finalContent)
				await fs.writeFile(fullPath, markdownContent, 'utf-8')
			}

			return { success: true }
		} finally {
			release()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

export async function handleCreateMarkdown(
	request: CreateMarkdownRequest,
): Promise<CreateMarkdownResponse> {
	const { collection, title, slug, frontmatter = {}, content = '' } = request

	const normalizedSlug = slugify(slug || title)
	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug from the provided title/slug' }
	}

	const allowedExtensions = ['md', 'mdx', 'json', 'yaml', 'yml']
	const ext = request.fileExtension ?? 'md'
	if (!allowedExtensions.includes(ext)) {
		return { success: false, error: `Invalid file extension "${ext}". Allowed: ${allowedExtensions.join(', ')}` }
	}
	const isData = ext === 'json' || ext === 'yaml' || ext === 'yml'
	const filePath = `src/content/${collection}/${normalizedSlug}.${ext}`
	const fullPath = resolveAndValidatePath(filePath)

	let fileContent: string
	if (isData) {
		const data = { ...frontmatter }
		fileContent = ext === 'json'
			? JSON.stringify(data, null, 2) + '\n'
			: yaml.stringify(data)
	} else {
		const fullFrontmatter: BlogFrontmatter = {
			title,
			date: new Date().toISOString().split('T')[0]!,
			draft: true,
			...frontmatter,
		}
		fileContent = serializeFrontmatter(fullFrontmatter, content)
	}

	try {
		await fs.mkdir(path.dirname(fullPath), { recursive: true })
		await fs.writeFile(fullPath, fileContent, { encoding: 'utf-8', flag: 'wx' })

		return {
			success: true,
			filePath,
			slug: normalizedSlug,
		}
	} catch (error) {
		if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
			return { success: false, error: `File already exists: ${filePath}` }
		}
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

export async function handleDeleteMarkdown(
	request: DeleteMarkdownRequest,
): Promise<DeleteMarkdownResponse> {
	try {
		const fullPath = resolveAndValidatePath(request.filePath)

		// Verify the file exists before deleting
		await fs.access(fullPath)
		await fs.unlink(fullPath)

		return { success: true }
	} catch (error) {
		if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { success: false, error: `File not found: ${request.filePath}` }
		}
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

export interface RenameMarkdownRequest {
	filePath: string
	newSlug: string
}

export interface RenameMarkdownResponse {
	success: boolean
	newFilePath?: string
	newSlug?: string
	error?: string
}

export async function handleRenameMarkdown(
	request: RenameMarkdownRequest,
): Promise<RenameMarkdownResponse> {
	try {
		const fullPath = resolveAndValidatePath(request.filePath)
		const normalizedSlug = slugify(request.newSlug)
		if (!normalizedSlug) {
			return { success: false, error: 'Invalid slug' }
		}

		const dir = path.dirname(fullPath)
		const ext = path.extname(fullPath)
		const newFullPath = path.join(dir, `${normalizedSlug}${ext}`)

		if (fullPath === newFullPath) {
			return { success: true, newFilePath: request.filePath, newSlug: normalizedSlug }
		}

		// Acquire lock to prevent concurrent access during rename
		const release = await acquireFileLock(fullPath)
		try {
			// Use link+unlink for atomic rename that fails if target exists
			try {
				await fs.link(fullPath, newFullPath)
			} catch (err) {
				if (isNodeError(err, 'EEXIST')) {
					return { success: false, error: `File already exists: ${normalizedSlug}${ext}` }
				}
				throw err
			}
			try {
				await fs.unlink(fullPath)
			} catch (err) {
				// Clean up the new file if unlink of original fails
				await fs.unlink(newFullPath).catch(() => {})
				throw err
			}
		} finally {
			release()
		}

		// Build project-relative path (normalize to forward slashes)
		const projectRoot = getProjectRoot()
		const newFilePath = path.relative(projectRoot, newFullPath).split(path.sep).join('/')

		return { success: true, newFilePath, newSlug: normalizedSlug }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { success: false, error: message }
	}
}

// --- Internal helpers ---

function isDataFile(filePath: string): boolean {
	return filePath.endsWith('.json') || filePath.endsWith('.yaml') || filePath.endsWith('.yml')
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
	const trimmed = raw.trimStart()
	if (!trimmed.startsWith('---')) {
		return { frontmatter: {}, content: raw }
	}

	// Find closing --- on its own line (not inside YAML values)
	const lines = trimmed.split('\n')
	let endLineIndex = -1
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]!.trimEnd() === '---') {
			endLineIndex = i
			break
		}
	}
	if (endLineIndex === -1) {
		return { frontmatter: {}, content: raw }
	}

	const yamlStr = lines.slice(1, endLineIndex).join('\n').trim()
	const content = lines.slice(endLineIndex + 1).join('\n').replace(/^\r?\n/, '')

	let frontmatter: Record<string, unknown> = {}
	try {
		frontmatter = (yaml.parse(yamlStr) as Record<string, unknown>) ?? {}
	} catch {
		// Invalid YAML, return empty frontmatter
	}

	return { frontmatter, content }
}

function serializeFrontmatter(frontmatter: Record<string, unknown>, content: string): string {
	const yamlStr = yaml.stringify(frontmatter).trim()
	return `---\n${yamlStr}\n---\n${content}`
}

/**
 * Ensure MDX content has import statements for all components used in the body.
 * Scans for `<ComponentName` tags, checks for existing imports, and prepends missing ones.
 */
function ensureMdxImports(
	content: string,
	filePath: string,
	componentDefinitions: Record<string, ComponentDefinition>,
): string {
	// Find all component-like tags (capitalized names)
	const usedComponents = new Set<string>()
	const tagRegex = /<([A-Z][A-Za-z0-9]*)\b/g
	let match
	while ((match = tagRegex.exec(content)) !== null) {
		if (match[1]) usedComponents.add(match[1])
	}
	if (usedComponents.size === 0) return content

	// Find already-imported names and track the last import position in a single pass
	const importedNames = new Set<string>()
	const importLineRegex = /^import\s+(.+)\s+from\s+/gm
	let lastImportEnd = -1
	while ((match = importLineRegex.exec(content)) !== null) {
		lastImportEnd = match.index + match[0].length
		// Advance past the `from '...'` portion to find the true line end
		const fromRest = content.slice(lastImportEnd)
		const lineEnd = fromRest.indexOf('\n')
		if (lineEnd >= 0) lastImportEnd += lineEnd
		else lastImportEnd = content.length

		const clause = match[1]!
		// Extract named imports from braces: { A, B as C }
		const braceMatch = clause.match(/\{([^}]+)\}/)
		if (braceMatch?.[1]) {
			for (const name of braceMatch[1].split(',')) {
				const parts = name.trim().split(/\s+as\s+/)
				const imported = (parts[1] ?? parts[0])?.trim()
				if (imported) importedNames.add(imported)
			}
		}
		// Extract default import and namespace import (* as X)
		const withoutBraces = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
		for (const token of withoutBraces.split(/\s+/)) {
			if (token === '*' || token === 'as' || token === '') continue
			importedNames.add(token)
		}
	}

	const root = getProjectRoot()
	const mdxFullPath = path.join(root, filePath)
	const missingImports: string[] = []

	for (const name of usedComponents) {
		if (importedNames.has(name)) continue
		const def = componentDefinitions[name]
		if (!def) continue

		const componentAbsPath = path.join(root, def.file)
		const rel = relativeImportPath(mdxFullPath, componentAbsPath)
		missingImports.push(`import ${name} from '${rel}'`)
	}

	if (missingImports.length === 0) return content

	// Place after any existing import block, or at the top
	const importBlock = missingImports.join('\n')

	if (lastImportEnd >= 0) {
		return content.slice(0, lastImportEnd) + '\n' + importBlock + content.slice(lastImportEnd)
	}

	return importBlock + '\n\n' + content
}
