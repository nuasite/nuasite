import { getMarkdownUrl } from './paths'
import type { LlmsTxtOptions } from './types'

export interface PageEntry {
	pathname: string
	title?: string
	type: 'collection' | 'static'
}

export interface SiteMetadata {
	title?: string
	description?: string
	baseUrl?: string
}

/**
 * Generate the content for /llms.txt
 *
 * The llms.txt format follows the convention at https://llmstxt.org/
 * providing a standardized way to communicate site structure to LLMs and crawlers.
 */
export function generateLlmsTxt(
	pages: PageEntry[],
	siteMetadata: SiteMetadata,
	options: LlmsTxtOptions,
): string {
	const siteName = options.siteName ?? siteMetadata.title ?? 'Site'
	const description = options.description ?? siteMetadata.description
	const baseUrl = options.baseUrl ?? siteMetadata.baseUrl ?? ''

	const lines: string[] = []

	// Title
	lines.push(`# ${siteName}`)
	lines.push('')

	// Description as blockquote (llms.txt convention)
	if (description) {
		lines.push(`> ${description}`)
		lines.push('')
	}

	// LLM-specific guidance
	if (options.allowCrawling !== false) {
		lines.push('This site provides markdown versions of all pages for LLM consumption.')
		lines.push('')
	}

	// LLM Discovery endpoint
	lines.push('## LLM Discovery')
	lines.push('')
	lines.push(`- [LLM Discovery Endpoint](${baseUrl}/.well-known/llm.md): Full site map with all available markdown endpoints`)
	lines.push('')

	// Markdown endpoints section
	lines.push('## Markdown Endpoints')
	lines.push('')
	lines.push('All pages are available as markdown by appending `.md` to the URL.')
	lines.push('')

	// Separate collection and static pages
	const collectionPages = pages.filter((p) => p.type === 'collection')
	const staticPages = pages.filter((p) => p.type === 'static')

	// Content pages (from collections)
	if (collectionPages.length > 0) {
		lines.push('### Content')
		lines.push('')
		const sortedCollection = [...collectionPages].sort((a, b) => a.pathname.localeCompare(b.pathname))
		for (const page of sortedCollection) {
			const mdUrl = getMarkdownUrl(page.pathname)
			const title = page.title ?? page.pathname
			lines.push(`- [${title}](${baseUrl}${mdUrl}): ${page.pathname}`)
		}
		lines.push('')
	}

	// Static pages
	if (staticPages.length > 0) {
		lines.push('### Pages')
		lines.push('')
		const sortedStatic = [...staticPages].sort((a, b) => a.pathname.localeCompare(b.pathname))
		for (const page of sortedStatic) {
			const mdUrl = getMarkdownUrl(page.pathname)
			const title = page.title ?? page.pathname
			lines.push(`- [${title}](${baseUrl}${mdUrl}): ${page.pathname}`)
		}
		lines.push('')
	}

	// If both are empty, show a generic message
	if (collectionPages.length === 0 && staticPages.length === 0) {
		lines.push('Append `.md` to any page URL to get the markdown version.')
		lines.push('')
		lines.push('Examples:')
		lines.push('- `/about` → `/about.md`')
		lines.push('- `/blog/post` → `/blog/post.md`')
		lines.push('')
	}

	// Crawling permissions
	lines.push('## Permissions')
	lines.push('')
	if (options.allowCrawling !== false) {
		lines.push('LLMs and crawlers are welcome to access markdown endpoints.')
	} else {
		lines.push('Please respect rate limits when crawling.')
	}

	// Additional instructions
	if (options.instructions) {
		lines.push('')
		lines.push(options.instructions)
	}

	// Additional content
	if (options.additionalContent) {
		lines.push('')
		lines.push(options.additionalContent)
	}

	return lines.join('\n')
}
