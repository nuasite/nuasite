import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'yaml'
import { getProjectRoot } from '../config'
import { acquireFileLock } from '../utils'

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
): Promise<UpdateMarkdownResponse> {
	try {
		const fullPath = resolveAndValidatePath(request.filePath)
		const release = await acquireFileLock(fullPath)
		try {
			const raw = await fs.readFile(fullPath, 'utf-8')
			const existing = parseFrontmatter(raw)

			const mergedFrontmatter: BlogFrontmatter = {
				...(existing.frontmatter as BlogFrontmatter),
				...request.frontmatter,
			}

			const finalContent = request.content ?? existing.content
			const markdownContent = serializeFrontmatter(mergedFrontmatter, finalContent)

			await fs.writeFile(fullPath, markdownContent, 'utf-8')

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
	const filePath = `src/content/${collection}/${normalizedSlug}.md`
	const fullPath = resolveAndValidatePath(filePath)

	const fullFrontmatter: BlogFrontmatter = {
		title,
		date: new Date().toISOString().split('T')[0]!,
		draft: true,
		...frontmatter,
	}

	const markdownContent = serializeFrontmatter(fullFrontmatter, content)

	try {
		await fs.mkdir(path.dirname(fullPath), { recursive: true })
		// Use 'wx' flag for atomic exclusive create — fails if file already exists
		await fs.writeFile(fullPath, markdownContent, { encoding: 'utf-8', flag: 'wx' })

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

// --- Internal helpers ---

/**
 * Resolve a user-provided file path and ensure it stays within the project root.
 * Throws if the resolved path escapes the project boundary.
 */
function resolveAndValidatePath(filePath: string): string {
	const projectRoot = getProjectRoot()
	const resolvedRoot = path.resolve(projectRoot)
	// Absolute filesystem paths (e.g. /Users/...) stay intact;
	// project-relative paths with a leading slash (e.g. /src/content/...) get it stripped
	const isAbsoluteFs = filePath.startsWith(resolvedRoot)
	const normalizedPath = (!isAbsoluteFs && filePath.startsWith('/')) ? filePath.slice(1) : filePath
	const fullPath = path.isAbsolute(normalizedPath) ? path.resolve(normalizedPath) : path.resolve(projectRoot, normalizedPath)

	// Ensure the resolved path is within the project root
	if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
		throw new Error(`Path traversal detected: ${filePath}`)
	}

	return fullPath
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

function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
}
