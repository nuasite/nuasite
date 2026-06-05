import type { CreatePageRequest, DeletePageRequest, DuplicatePageRequest, LayoutInfo, PageOperationResponse } from '@nuasite/cms-types'
import type { CmsFileSystem } from '../fs/types'
import { escapeHtml, slugify } from '../shared'

const PAGE_EXTENSIONS = ['.astro', '.md', '.mdx']

export interface PageOpsDeps {
	fs: CmsFileSystem
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export async function createPage(deps: PageOpsDeps, request: CreatePageRequest): Promise<PageOperationResponse> {
	const { title, slug } = request
	const normalizedSlug = slugify(slug || title)

	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug from the provided title/slug' }
	}

	const filePath = `src/pages/${normalizedSlug}.astro`

	if (await deps.fs.exists(filePath)) {
		return { success: false, error: `Page already exists: ${filePath}` }
	}

	const layoutImport = await resolveLayoutImport(deps, request.layoutPath)
	const content = generatePageContent(title, layoutImport)

	try {
		await deps.fs.writeFile(filePath, content)
		const url = normalizedSlug === 'index' ? '/' : `/${normalizedSlug}`
		return { success: true, filePath, slug: normalizedSlug, url }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function duplicatePage(deps: PageOpsDeps, request: DuplicatePageRequest): Promise<PageOperationResponse> {
	const { sourcePagePath, slug, title } = request
	const normalizedSlug = slugify(slug)

	if (!normalizedSlug) {
		return { success: false, error: 'Could not generate a valid slug' }
	}

	const sourceFile = await findPageFile(deps, sourcePagePath)
	if (!sourceFile) {
		return { success: false, error: `Source page not found: ${sourcePagePath}` }
	}

	let content: string
	try {
		content = await deps.fs.readFile(sourceFile)
	} catch {
		return { success: false, error: `Could not read source file: ${sourceFile}` }
	}

	if (title) {
		content = replacePageTitle(content, title)
	}

	const newFilePath = `src/pages/${normalizedSlug}.astro`

	if (await deps.fs.exists(newFilePath)) {
		return { success: false, error: `Page already exists: ${newFilePath}` }
	}

	try {
		await deps.fs.writeFile(newFilePath, content)
		const url = normalizedSlug === 'index' ? '/' : `/${normalizedSlug}`
		return { success: true, filePath: newFilePath, slug: normalizedSlug, url }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function deletePage(deps: PageOpsDeps, request: DeletePageRequest): Promise<PageOperationResponse> {
	const { pagePath } = request

	const pageFile = await findPageFile(deps, pagePath)
	if (!pageFile) {
		return { success: false, error: `Page not found: ${pagePath}` }
	}

	try {
		await deps.fs.remove(pageFile)
		return { success: true, filePath: pageFile, url: pagePath }
	} catch (error) {
		return { success: false, error: errorMessage(error) }
	}
}

export async function getLayouts(deps: PageOpsDeps): Promise<LayoutInfo[]> {
	const entries = await deps.fs.list('src/layouts')

	const layouts: LayoutInfo[] = []
	for (const entry of entries) {
		if (!entry.isDirectory && entry.name.endsWith('.astro')) {
			layouts.push({
				name: entry.name.slice(0, -'.astro'.length),
				path: `src/layouts/${entry.name}`,
			})
		}
	}

	return layouts.sort((a, b) => a.name.localeCompare(b.name))
}

export async function checkSlugExists(deps: PageOpsDeps, slug: string): Promise<{ exists: boolean; filePath?: string }> {
	const normalizedSlug = slugify(slug)
	if (!normalizedSlug) return { exists: false }

	const found = await findPageFile(deps, `/${normalizedSlug}`)
	return found ? { exists: true, filePath: found } : { exists: false }
}

// --- Internal helpers ---

async function findPageFile(deps: PageOpsDeps, pagePath: string): Promise<string | null> {
	const normalized = pagePath.replace(/^\//, '').replace(/\/$/, '') || 'index'

	for (const ext of PAGE_EXTENSIONS) {
		const direct = `src/pages/${normalized}${ext}`
		if (await deps.fs.exists(direct)) return direct
	}

	for (const ext of PAGE_EXTENSIONS) {
		const indexFile = `src/pages/${normalized}/index${ext}`
		if (await deps.fs.exists(indexFile)) return indexFile
	}

	return null
}

async function resolveLayoutImport(deps: PageOpsDeps, layoutPath?: string): Promise<{ importPath: string; componentName: string } | null> {
	if (layoutPath) {
		const name = layoutPath.replace(/^.*\//, '').replace(/\.astro$/, '')
		const importPath = `../${layoutPath.replace(/^src\//, '')}`
		return { importPath, componentName: pascalCase(name) }
	}

	const layouts = await getLayouts(deps)
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
