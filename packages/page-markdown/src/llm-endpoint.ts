import { getMarkdownUrl } from './paths'
import type { LlmEndpointOptions } from './types'

export interface PageEntry {
	pathname: string
	title?: string
	type: 'collection' | 'static'
}

export interface SiteMetadata {
	title?: string
	description?: string
}

/**
 * Generate the content for /.well-known/llm.md
 */
export function generateLlmMarkdown(
	pages: PageEntry[],
	siteMetadata: SiteMetadata,
	options: LlmEndpointOptions,
): string {
	const siteName = options.siteName ?? siteMetadata.title ?? 'Site'
	const description = options.description ?? siteMetadata.description

	const lines: string[] = []

	// Frontmatter
	lines.push('---')
	lines.push(`generatedAt: ${new Date().toISOString()}`)
	lines.push('---')
	lines.push('')

	// Title
	lines.push(`# ${siteName}`)
	lines.push('')

	// Description
	if (description) {
		lines.push(description)
		lines.push('')
	}

	// Markdown endpoints section
	lines.push('## Markdown Endpoints')
	lines.push('')
	lines.push('This site exposes page content as markdown at `.md` URLs.')
	lines.push('')

	// Separate collection and static pages
	const collectionPages = pages.filter((p) => p.type === 'collection')
	const staticPages = pages.filter((p) => p.type === 'static')

	// Pages section
	if (pages.length > 0) {
		lines.push('### Pages')
		lines.push('')

		// List all pages sorted by pathname
		const sortedPages = [...pages].sort((a, b) => a.pathname.localeCompare(b.pathname))
		for (const page of sortedPages) {
			const mdUrl = getMarkdownUrl(page.pathname)
			const label = page.title ?? page.pathname
			lines.push(`- [${mdUrl}](.${mdUrl})${page.title ? ` - ${page.title}` : ''}`)
		}
		lines.push('')
	}

	// Usage section
	lines.push('## Usage')
	lines.push('')
	lines.push('Append `.md` to any page URL to get the markdown version:')
	lines.push('- `/about` → `/about.md`')
	lines.push('- `/blog/hello` → `/blog/hello.md`')

	// Additional content
	if (options.additionalContent) {
		lines.push('')
		lines.push(options.additionalContent)
	}

	return lines.join('\n')
}
