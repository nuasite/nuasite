import path from 'node:path'

/** Well-known path for LLM discovery endpoint */
export const LLM_ENDPOINT_PATH = '/.well-known/llm.md'

/** Path for llms.txt endpoint */
export const LLMS_TXT_PATH = '/llms.txt'

/**
 * Normalize a URL path by removing query strings, hashes, and trailing slashes
 */
export function normalizePath(url: string): string {
	let pagePath = url.split('?')[0]?.split('#')[0] ?? ''
	if (pagePath.length > 1 && pagePath.endsWith('/')) {
		pagePath = pagePath.slice(0, -1)
	}
	return pagePath || '/'
}

/**
 * Get the markdown URL for a given page path
 */
export function getMarkdownUrl(pagePath: string): string {
	if (pagePath === '/') {
		return '/index.md'
	}
	const cleanPath = pagePath.endsWith('/') ? pagePath.slice(0, -1) : pagePath
	return `${cleanPath}.md`
}

/**
 * Convert a .md URL back to a page path
 */
export function mdUrlToPagePath(url: string): string {
	const match = url.match(/^\/(.*)\.md$/)
	if (!match) return url

	const pagePath = '/' + match[1]
	return pagePath === '/index' ? '/' : pagePath
}

/**
 * Get the output path for a .md file in dist
 */
export function getMdOutputPath(distDir: string, pagePath: string): string {
	if (pagePath === '/') {
		return path.join(distDir, 'index.md')
	}
	return path.join(distDir, `${pagePath.slice(1)}.md`)
}

/**
 * Get the HTML file path for a page in dist
 */
export function getHtmlPath(distDir: string, pagePath: string): string {
	if (pagePath === '/') {
		return path.join(distDir, 'index.html')
	}
	return path.join(distDir, pagePath.slice(1), 'index.html')
}

/**
 * Get the output path for llm.md in dist
 */
export function getLlmOutputPath(distDir: string): string {
	return path.join(distDir, '.well-known', 'llm.md')
}

/**
 * Get the output path for llms.txt in dist
 */
export function getLlmsTxtOutputPath(distDir: string): string {
	return path.join(distDir, 'llms.txt')
}

/**
 * Inject markdown alternate link into HTML head
 */
export function injectMarkdownLink(html: string, pagePath: string): string {
	const mdUrl = getMarkdownUrl(pagePath)
	const linkTag = `<link rel="alternate" type="text/markdown" href="${mdUrl}">`

	if (html.includes('</head>')) {
		return html.replace('</head>', `${linkTag}\n</head>`)
	}
	if (html.includes('<head>')) {
		return html.replace('<head>', `<head>\n${linkTag}`)
	}
	return html
}
