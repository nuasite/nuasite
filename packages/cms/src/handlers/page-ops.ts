import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from '../config'
import type { CreatePageRequest, DeletePageRequest, DuplicatePageRequest, LayoutInfo, PageOperationResponse } from '../types'
import { escapeHtml, isNodeError, resolveAndValidatePath, slugify } from '../utils'

const PAGE_EXTENSIONS = ['.astro', '.md', '.mdx']

export async function handleCreatePage(request: CreatePageRequest): Promise<PageOperationResponse> {
	const { title, slug } = request
	const normalizedSlug = slugify(slug || title)

	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug from the provided title/slug' }
	}

	const filePath = `src/pages/${normalizedSlug}.astro`
	const fullPath = resolveAndValidatePath(filePath)

	const layoutImport = await resolveLayoutImport(request.layoutPath)
	const content = generatePageContent(title, layoutImport)

	try {
		await fs.mkdir(path.dirname(fullPath), { recursive: true })
		// 'wx' flag atomically fails if file exists — no pre-check needed
		await fs.writeFile(fullPath, content, { encoding: 'utf-8', flag: 'wx' })

		const url = normalizedSlug === 'index' ? '/' : `/${normalizedSlug}`
		return { success: true, filePath, slug: normalizedSlug, url }
	} catch (error) {
		if (isNodeError(error, 'EEXIST')) {
			return { success: false, error: `Page already exists: ${filePath}` }
		}
		return { success: false, error: errorMessage(error) }
	}
}

export async function handleDuplicatePage(request: DuplicatePageRequest): Promise<PageOperationResponse> {
	const { sourcePagePath, slug, title } = request
	const normalizedSlug = slugify(slug)

	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug' }
	}

	const sourceFile = await findPageFile(sourcePagePath)
	if (!sourceFile) {
		return { success: false, error: `Source page not found: ${sourcePagePath}` }
	}

	let content: string
	try {
		content = await fs.readFile(resolveAndValidatePath(sourceFile), 'utf-8')
	} catch {
		return { success: false, error: `Could not read source file: ${sourceFile}` }
	}

	if (title) {
		content = replacePageTitle(content, title)
	}

	const newFilePath = `src/pages/${normalizedSlug}.astro`
	const newFullPath = resolveAndValidatePath(newFilePath)

	try {
		await fs.mkdir(path.dirname(newFullPath), { recursive: true })
		await fs.writeFile(newFullPath, content, { encoding: 'utf-8', flag: 'wx' })

		const url = normalizedSlug === 'index' ? '/' : `/${normalizedSlug}`
		return { success: true, filePath: newFilePath, slug: normalizedSlug, url }
	} catch (error) {
		if (isNodeError(error, 'EEXIST')) {
			return { success: false, error: `Page already exists: ${newFilePath}` }
		}
		return { success: false, error: errorMessage(error) }
	}
}

export async function handleDeletePage(request: DeletePageRequest): Promise<PageOperationResponse> {
	const { pagePath } = request

	const pageFile = await findPageFile(pagePath)
	if (!pageFile) {
		return { success: false, error: `Page not found: ${pagePath}` }
	}

	try {
		// No pre-check — just unlink and handle ENOENT
		await fs.unlink(resolveAndValidatePath(pageFile))
		return { success: true, filePath: pageFile, url: pagePath }
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) {
			return { success: false, error: `File not found: ${pageFile}` }
		}
		return { success: false, error: errorMessage(error) }
	}
}

/**
 * Reuses findPageFile to check whether a slug is already taken.
 */
export async function handleCheckSlugExists(slug: string): Promise<{ exists: boolean; filePath?: string }> {
	const normalizedSlug = slugify(slug)
	if (!normalizedSlug) return { exists: false }

	const found = await findPageFile(`/${normalizedSlug}`)
	return found ? { exists: true, filePath: found } : { exists: false }
}

export async function handleGetLayouts(): Promise<LayoutInfo[]> {
	const layoutsDir = path.join(getProjectRoot(), 'src', 'layouts')

	let entries
	try {
		entries = await fs.readdir(layoutsDir, { withFileTypes: true })
	} catch {
		return []
	}

	const layouts: LayoutInfo[] = []
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith('.astro')) {
			layouts.push({
				name: path.basename(entry.name, '.astro'),
				path: `src/layouts/${entry.name}`,
			})
		}
	}

	return layouts.sort((a, b) => a.name.localeCompare(b.name))
}

// --- Internal helpers ---

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function fileExists(fullPath: string): Promise<boolean> {
	try {
		await fs.access(fullPath)
		return true
	} catch {
		return false
	}
}

async function findPageFile(pagePath: string): Promise<string | null> {
	const normalized = pagePath.replace(/^\//, '').replace(/\/$/, '') || 'index'

	for (const ext of PAGE_EXTENSIONS) {
		const direct = `src/pages/${normalized}${ext}`
		if (await fileExists(resolveAndValidatePath(direct))) return direct
	}

	for (const ext of PAGE_EXTENSIONS) {
		const indexFile = `src/pages/${normalized}/index${ext}`
		if (await fileExists(resolveAndValidatePath(indexFile))) return indexFile
	}

	return null
}

async function resolveLayoutImport(layoutPath?: string): Promise<{ importPath: string; componentName: string } | null> {
	if (layoutPath) {
		const name = path.basename(layoutPath, '.astro')
		const importPath = `../${layoutPath.replace(/^src\//, '')}`
		return { importPath, componentName: pascalCase(name) }
	}

	const layouts = await handleGetLayouts()
	if (layouts.length === 0) return null

	const layout = layouts[0]!
	const importPath = `../${layout.path.replace(/^src\//, '')}`
	return { importPath, componentName: pascalCase(layout.name) }
}

function pascalCase(name: string): string {
	return name.replace(/(^|[-_])(\w)/g, (_, _sep, char) => char.toUpperCase())
}

function generatePageContent(
	title: string,
	layoutImport: { importPath: string; componentName: string } | null,
): string {
	const escapedTitle = title.replace(/'/g, "\\'").replace(/`/g, '\\`')
	const htmlTitle = escapeHtml(title)

	if (layoutImport) {
		const { importPath, componentName } = layoutImport
		return `---
import ${componentName} from '${importPath}'
---

<${componentName} title="${escapedTitle}" description="">
\t<main>
\t\t<h1>${htmlTitle}</h1>
\t</main>
</${componentName}>
`
	}

	return `---

---

<html lang="en">
\t<head>
\t\t<meta charset="utf-8" />
\t\t<meta name="viewport" content="width=device-width" />
\t\t<title>${escapedTitle}</title>
\t</head>
\t<body>
\t\t<main>
\t\t\t<h1>${htmlTitle}</h1>
\t\t</main>
\t</body>
</html>
`
}

function replacePageTitle(content: string, newTitle: string): string {
	let result = content
	result = result.replace(/(title\s*=\s*")([^"]*)(")/, `$1${newTitle}$3`)
	result = result.replace(/(<title>)([^<]*)(<\/title>)/, `$1${newTitle}$3`)
	result = result.replace(/(<h1[^>]*>)([^<]*)(<\/h1>)/, `$1${escapeHtml(newTitle)}$3`)
	return result
}
