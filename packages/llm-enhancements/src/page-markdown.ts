import { type CollectionPages, getCollectionContent } from './cms-marker.ts'
import type { HtmlToMarkdownResult } from './html-to-markdown.ts'
import { createCollectionOutput, createStaticOutput } from './markdown-generator.ts'
import type { MarkdownSyntax } from './mdx.ts'
import type { MarkdownOutput, ResolvedOptions } from './types.ts'

/** What a page is resolved against: the pages that render an entry, and how the site parses markdown. */
export interface SiteContent {
	pages: CollectionPages
	syntax: MarkdownSyntax
}

export interface PageMarkdown {
	output: MarkdownOutput
	type: 'collection' | 'static'
	/** The entry's source, for a collection page. */
	sourcePath?: string
	/** The entry's title, else the page's `<title>`. */
	title?: string
	/** The rendered page's metadata, when the page was read. */
	metadata?: HtmlToMarkdownResult['metadata']
}

/**
 * Resolve a page to the markdown that tells it: its collection entry when it has one, else its rendered
 * HTML when static pages are wanted. `readPage` converts the rendered page, or gives `undefined` when
 * there is none; it is called at most once and only when the page is needed.
 */
export async function resolvePageMarkdown(
	pagePath: string,
	options: ResolvedOptions,
	site: SiteContent,
	readPage: () => Promise<HtmlToMarkdownResult | undefined>,
): Promise<PageMarkdown | undefined> {
	let page: Promise<HtmlToMarkdownResult | undefined> | undefined
	const renderedPage = () => (page ??= readPage())

	const entry = await getCollectionContent(pagePath, site.pages, site.syntax)
	if (entry) {
		const entryTitle = entry.frontmatter.title?.value
		// An entry that renders more than its source says is told by its page, which is still the entry's,
		// so it is written whether or not static pages are.
		const rendered = entry.body === undefined || entryTitle === undefined ? await renderedPage() : undefined
		const body = entry.body ?? rendered?.body
		if (body === undefined) return undefined
		return {
			output: createCollectionOutput(entry.frontmatter, body, entry.file),
			type: 'collection',
			sourcePath: entry.file,
			title: entryTitle ?? rendered?.metadata.title,
			metadata: rendered?.metadata,
		}
	}

	if (!options.includeStaticPages) return undefined
	const rendered = await renderedPage()
	if (!rendered) return undefined
	return { output: createStaticOutput(rendered.metadata, rendered.body), type: 'static', title: rendered.metadata.title, metadata: rendered.metadata }
}
