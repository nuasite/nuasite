import type { CollectionInfo, MarkdownContent } from '@nuasite/cms'
import path from 'node:path'
import { cms } from './cms'
import { type MarkdownSyntax, mdxBodyAsMarkdown } from './mdx'
import { normalizePath } from './paths'

/** The pages that render a collection entry, by normalized pathname. */
export type CollectionPages = Map<string, CollectionInfo>

/**
 * A page's collection entry. `body` is `undefined` when the entry cannot be told as markdown (an `.mdx`
 * body that renders components or expressions): the page is still the entry's, but its text comes
 * from the rendered HTML.
 */
export type CollectionPage = Omit<MarkdownContent, 'body'> & { body: string | undefined }

/**
 * Entries whose body is markdown. Any other entry (`.json`, `.yaml`, Markdoc) still owns its page, but
 * is told by the rendered HTML, like an `.mdx` entry that renders components.
 */
const MARKDOWN_ENTRY = /\.(md|mdx|markdown)$/i

export async function getCollectionContent(
	pagePath: string,
	pages: CollectionPages,
	syntax: MarkdownSyntax,
): Promise<CollectionPage | undefined> {
	const collectionInfo = pages.get(normalizePath(pagePath))
	if (!cms || !collectionInfo) return undefined
	if (!MARKDOWN_ENTRY.test(collectionInfo.file)) {
		return {
			frontmatter: {},
			body: undefined,
			bodyStartLine: 0,
			file: collectionInfo.file,
			collectionName: collectionInfo.name,
			collectionSlug: collectionInfo.slug,
		}
	}

	const content = await cms.parseMarkdownContent(collectionInfo)
	if (!content) return undefined

	const body = content.body.replace(/\r\n?/g, '\n')
	return { ...content, body: content.file.toLowerCase().endsWith('.mdx') ? mdxBodyAsMarkdown(body, syntax) : body }
}

/**
 * Find the pages that render a collection entry, once, for a caller about to resolve many pages: the URL
 * the CMS editor shows for each entry (see `collectionPagesByPathname` in `@nuasite/cms`). Runs in the
 * current project context. Empty without `@nuasite/cms`, when `contentDir` lies outside the project root
 * (the CMS reads nothing there), or when the scan fails; `warn` reports the last two. Every page is then
 * told by its rendered HTML.
 */
export async function findCollectionPages(contentDir: string, warn: (message: string) => void): Promise<CollectionPages> {
	if (!cms) return new Map()
	const root = cms.getProjectRoot()
	const relative = path.relative(root, path.resolve(root, contentDir))
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		warn(`contentDir ${contentDir} is outside the project root ${root}, every page is converted from its HTML`)
		return new Map()
	}

	let found: CollectionPages
	try {
		// Relative, as the CMS spells the source paths it reads entries from.
		found = await cms.collectionPagesByPathname(await cms.scanProjectCollections(relative.split(path.sep).join('/') || '.'))
	} catch (error) {
		warn(`Could not scan the content collections in ${contentDir}, every page is converted from its HTML: ${error}`)
		return new Map()
	}
	const pages: CollectionPages = new Map()
	for (const [pathname, info] of found) pages.set(normalizePath(pathname), info)
	return pages
}
