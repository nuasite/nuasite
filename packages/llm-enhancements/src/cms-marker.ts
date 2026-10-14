import type { CollectionInfo, MarkdownContent } from '@nuasite/cms'
import path from 'node:path'
import { cms } from './cms'
import { type MarkdownSyntax, mdxBodyAsMarkdown } from './mdx'
import { normalizePath } from './paths'

type Collections = Awaited<ReturnType<NonNullable<typeof cms>['scanProjectCollections']>>

/** The pages that render a collection entry, by normalized pathname. */
export type CollectionPages = Map<string, CollectionInfo>

/**
 * A page's collection entry. `body` is `undefined` when the entry cannot be told as markdown (an `.mdx`
 * body that renders components or expressions): the page is still the entry's, but its text comes
 * from the rendered HTML.
 */
export type CollectionPage = Omit<MarkdownContent, 'body'> & { body: string | undefined }

/** Entries whose body is markdown. A data entry (`.json`, `.yaml`) or Markdoc is told by its page. */
const MARKDOWN_ENTRY = /\.(md|mdx|markdown)$/i

export async function getCollectionContent(
	pagePath: string,
	pages: CollectionPages,
	syntax: MarkdownSyntax,
): Promise<CollectionPage | undefined> {
	const collectionInfo = pages.get(normalizePath(pagePath))
	if (!cms || !collectionInfo || !MARKDOWN_ENTRY.test(collectionInfo.file)) {
		return undefined
	}

	const content = await cms.parseMarkdownContent(collectionInfo)
	if (!content) return undefined

	const body = content.body.replace(/\r\n?/g, '\n')
	return { ...content, body: content.file.toLowerCase().endsWith('.mdx') ? mdxBodyAsMarkdown(body, syntax) : body }
}

/**
 * Find the pages that render a collection entry, once, for a caller about to resolve many pages: the URL
 * the CMS editor shows for each entry (see `collectionPagesByPathname` in `@nuasite/cms`). Runs in the
 * current project context. Empty without `@nuasite/cms`, or when the scan fails, which `warn` reports:
 * every page is then told by its rendered HTML.
 */
export async function findCollectionPages(contentDir: string, warn: (message: string) => void): Promise<CollectionPages> {
	if (!cms) return new Map()
	let found: CollectionPages
	try {
		found = await cms.collectionPagesByPathname(await scanContent(contentDir))
	} catch (error) {
		warn(`Could not scan the content collections in ${contentDir}, every page is converted from its HTML: ${error}`)
		return new Map()
	}
	const pages: CollectionPages = new Map()
	for (const [pathname, info] of found) pages.set(normalizePath(pathname), info)
	return pages
}

/**
 * Scan the collections in `contentDir`. One outside the project root (`../shared/content`) is scanned
 * from its parent, since the CMS filesystem refuses paths outside its root, and its source paths are
 * then spelled from the project root again, which is how the rest of the CMS reads them.
 */
async function scanContent(contentDir: string): Promise<Collections> {
	const api = cms!
	const root = api.getProjectRoot()
	const absolute = path.resolve(root, contentDir)
	const relative = path.relative(root, absolute)
	if (!relative.startsWith('..') && !path.isAbsolute(relative)) return api.scanProjectCollections(contentDir)

	const base = path.dirname(absolute)
	const scanned = await api.runAtProjectRoot(base, () => api.scanProjectCollections(path.basename(absolute)))
	const fromRoot = (sourcePath: string) => path.relative(root, path.resolve(base, sourcePath)).split(path.sep).join('/')
	const rebased: Collections = {}
	for (const [name, def] of Object.entries(scanned)) {
		rebased[name] = { ...def, path: fromRoot(def.path), entries: def.entries?.map(entry => ({ ...entry, sourcePath: fromRoot(entry.sourcePath) })) }
	}
	return rebased
}
