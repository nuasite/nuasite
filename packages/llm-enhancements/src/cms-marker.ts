// A static import on purpose. Astro evaluates an integration through a Vite module runner that it
// closes once the config is loaded, so a dynamic import made later fails in any Astro build, Node or
// Bun ("Vite module runner has been closed"), and every collection page fell back to its HTML.
import { findCollectionSource, type MarkdownContent, parseMarkdownContent, scanProjectCollections } from '@nuasite/cms'
import { mdxBodyAsMarkdown } from './mdx'

type Collections = Awaited<ReturnType<typeof scanProjectCollections>>

export async function getCollectionContent(
	pagePath: string,
	contentDir: string,
	collections?: Collections,
): Promise<MarkdownContent | undefined> {
	const collectionInfo = await findCollectionSource(pagePath, contentDir, collections)
	if (!collectionInfo) {
		return undefined
	}

	const content = await parseMarkdownContent(collectionInfo)
	if (!content?.file.endsWith('.mdx')) return content

	// An entry whose body needs its components rendered is better told by the page itself.
	const body = mdxBodyAsMarkdown(content.body)
	return body === undefined ? undefined : { ...content, body }
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
