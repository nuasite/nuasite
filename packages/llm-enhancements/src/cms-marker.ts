// A static import on purpose. Astro evaluates an integration through a Vite module runner that it
// closes once the config is loaded, so a dynamic import made later fails in any Astro build, Node or
// Bun ("Vite module runner has been closed"), and every collection page fell back to its HTML.
import { findCollectionSource, type MarkdownContent, parseMarkdownContent, scanProjectCollections } from '@nuasite/cms'
import { mdxBodyAsMarkdown } from './mdx'

export type Collections = Awaited<ReturnType<typeof scanProjectCollections>>

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
	contentDir: string,
	collections?: Collections,
): Promise<CollectionPage | undefined> {
	// Exact: the entry is published as the page's content, so a page only borrowing its filename's slug
	// (a static `/team/jana` beside `blog/jana.md`) must not get it.
	const collectionInfo = await findCollectionSource(pagePath, contentDir, collections, { exact: true })
	if (!collectionInfo || !MARKDOWN_ENTRY.test(collectionInfo.file)) {
		return undefined
	}

	const content = await parseMarkdownContent(collectionInfo)
	if (!content) return undefined

	const body = content.body.replace(/\r\n?/g, '\n')
	return { ...content, body: content.file.toLowerCase().endsWith('.mdx') ? mdxBodyAsMarkdown(body) : body }
}

/**
 * Scan the content collections once, for a caller about to resolve many pages: passing the result to
 * {@link getCollectionContent} keeps each page from scanning every collection again. When the scan
 * fails, `warn` says why and the result is empty: pages then resolve by filename alone instead of
 * each repeating the failing scan.
 */
export async function scanCollectionsForPages(contentDir: string, warn: (message: string) => void): Promise<Collections> {
	try {
		return await scanProjectCollections(contentDir)
	} catch (error) {
		warn(`Could not scan the content collections in ${contentDir}, resolving pages by filename only: ${error}`)
		return {}
	}
}
