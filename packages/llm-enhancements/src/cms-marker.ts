// A static import on purpose. Astro evaluates an integration through a Vite module runner that it
// closes once the config is loaded, so a dynamic import made later fails in any Astro build, Node or
// Bun ("Vite module runner has been closed"), and every collection page fell back to its HTML.
import { findCollectionSource, type MarkdownContent, parseMarkdownContent, scanProjectCollections } from '@nuasite/cms'
import { mdxBodyAsMarkdown } from './mdx'

type Collections = Awaited<ReturnType<typeof scanProjectCollections>>

/**
 * A page's collection entry. `body` is `undefined` when the entry cannot be told as markdown (an `.mdx`
 * body that renders components or expressions): the page is still the entry's, but its text comes
 * from the rendered HTML.
 */
export type CollectionPage = Omit<MarkdownContent, 'body'> & { body: string | undefined }

export async function getCollectionContent(
	pagePath: string,
	contentDir: string,
	collections?: Collections,
): Promise<CollectionPage | undefined> {
	const collectionInfo = await findCollectionSource(pagePath, contentDir, collections)
	if (!collectionInfo) {
		return undefined
	}

	const content = await parseMarkdownContent(collectionInfo)
	if (!content?.file.endsWith('.mdx')) return content

	return { ...content, body: mdxBodyAsMarkdown(content.body) }
}

/**
 * Scan the content collections once, for a caller about to resolve many pages: passing the result to
 * {@link getCollectionContent} keeps each page from scanning every collection again. `undefined` when
 * the scan fails, so each page falls back to resolving on its own; `warn` says why.
 */
export async function scanCollectionsForPages(contentDir: string, warn: (message: string) => void): Promise<Collections | undefined> {
	try {
		return await scanProjectCollections(contentDir)
	} catch (error) {
		warn(`Could not scan the content collections in ${contentDir}, resolving each page on its own: ${error}`)
		return undefined
	}
}
