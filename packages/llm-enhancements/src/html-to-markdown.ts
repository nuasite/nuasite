import { type HTMLElement, type Node, NodeType, parse } from 'node-html-parser'

/** Elements to exclude from markdown conversion */
const EXCLUDED_TAGS = new Set([
	'nav',
	'footer',
	'header',
	'script',
	'style',
	'noscript',
	'svg',
	'iframe',
	'form',
	'button',
	'input',
	'select',
	'textarea',
])

/** Block-level elements that need newlines around them */
const BLOCK_ELEMENTS = new Set([
	'p',
	'div',
	'section',
	'article',
	'main',
	'aside',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'blockquote',
	'pre',
	'table',
	'tr',
	'thead',
	'tbody',
	'figure',
	'figcaption',
	'hr',
	'br',
])

/**
 * Extract the main content area from HTML
 */
function extractMainContent(root: HTMLElement): HTMLElement {
	// Try to find main content container in order of preference
	const selectors = ['main', 'article', '[role="main"]', '.content', '#content']

	for (const selector of selectors) {
		const element = root.querySelector(selector)
		if (element) {
			return element
		}
	}

	// Fall back to body content
	const body = root.querySelector('body')
	return body ?? root
}

/**
 * Check if an element should be excluded from markdown output
 */
function shouldExclude(element: HTMLElement): boolean {
	const tagName = element.tagName?.toLowerCase()
	if (!tagName) return false
	return EXCLUDED_TAGS.has(tagName)
}

/**
 * Convert an HTML element to markdown
 */
function elementToMarkdown(element: HTMLElement, depth = 0): string {
	const tagName = element.tagName?.toLowerCase()

	if (!tagName) {
		return ''
	}

	if (shouldExclude(element)) {
		return ''
	}

	// Process children for most elements
	const childrenMd = () => childNodesToMarkdown(element, depth)

	switch (tagName) {
		// Headings
		case 'h1':
			return `\n# ${childrenMd().trim()}\n`
		case 'h2':
			return `\n## ${childrenMd().trim()}\n`
		case 'h3':
			return `\n### ${childrenMd().trim()}\n`
		case 'h4':
			return `\n#### ${childrenMd().trim()}\n`
		case 'h5':
			return `\n##### ${childrenMd().trim()}\n`
		case 'h6':
			return `\n###### ${childrenMd().trim()}\n`

		// Paragraphs
		case 'p':
			return `\n${childrenMd().trim()}\n`

		// Inline formatting
		case 'strong':
		case 'b':
			return `**${childrenMd()}**`
		case 'em':
		case 'i':
			return `*${childrenMd()}*`
		case 'code':
			return `\`${childrenMd()}\``
		case 's':
		case 'del':
		case 'strike':
			return `~~${childrenMd()}~~`

		// Links
		case 'a': {
			const href = element.getAttribute('href') ?? ''
			const text = childrenMd().trim()
			if (!text) return ''
			return `[${text}](${href})`
		}

		// Images
		case 'img': {
			const src = element.getAttribute('src') ?? ''
			const alt = element.getAttribute('alt') ?? ''
			return `![${alt}](${src})`
		}

		// Lists
		case 'ul':
		case 'ol':
			return `\n${childrenMd()}`
		case 'li': {
			const parent = element.parentNode as HTMLElement | null
			const isOrdered = parent?.tagName?.toLowerCase() === 'ol'
			const prefix = isOrdered ? '1. ' : '- '
			const content = childrenMd().trim()
			return `${prefix}${content}\n`
		}

		// Code blocks
		case 'pre': {
			// node-html-parser treats pre content as text, so we need to re-parse innerHTML
			const innerParsed = parse(element.innerHTML)
			const codeElement = innerParsed.querySelector('code')
			const code = codeElement ? codeElement.textContent : element.textContent
			const lang = codeElement?.getAttribute('class')?.match(/language-(\w+)/)?.[1] ?? ''
			return `\n\`\`\`${lang}\n${code?.trim()}\n\`\`\`\n`
		}

		// Blockquotes
		case 'blockquote': {
			const content = childrenMd().trim()
			const lines = content.split('\n')
			return '\n' + lines.map((line) => `> ${line}`).join('\n') + '\n'
		}

		// Horizontal rule
		case 'hr':
			return '\n---\n'

		// Line break
		case 'br':
			return '\n'

		// Tables
		case 'table':
			return `\n${convertTable(element)}\n`

		// Figures
		case 'figure':
			return `\n${childrenMd()}`
		case 'figcaption':
			return `\n*${childrenMd().trim()}*\n`

		// Container elements - just process children
		case 'div':
		case 'section':
		case 'article':
		case 'main':
		case 'aside':
		case 'span':
		case 'thead':
		case 'tbody':
		case 'tfoot':
			return childrenMd()

		default:
			return childrenMd()
	}
}

/**
 * Convert child nodes to markdown
 */
function childNodesToMarkdown(element: HTMLElement, depth: number): string {
	let result = ''

	for (const child of element.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			// Normalize whitespace in text nodes
			const text = child.textContent?.replace(/\s+/g, ' ') ?? ''
			result += text
		} else if (child.nodeType === NodeType.ELEMENT_NODE) {
			result += elementToMarkdown(child as HTMLElement, depth + 1)
		}
	}

	return result
}

/**
 * Convert HTML table to markdown table
 */
function convertTable(table: HTMLElement): string {
	const rows = table.querySelectorAll('tr')
	if (rows.length === 0) return ''

	const result: string[] = []
	let headerDone = false

	for (const row of rows) {
		const cells = row.querySelectorAll('th, td')
		const cellContents = cells.map((cell) => {
			const content = childNodesToMarkdown(cell as HTMLElement, 0).trim()
			return content.replace(/\|/g, '\\|') // Escape pipe characters
		})

		result.push(`| ${cellContents.join(' | ')} |`)

		// Add header separator after first row with th elements
		if (!headerDone && row.querySelector('th')) {
			result.push(`| ${cellContents.map(() => '---').join(' | ')} |`)
			headerDone = true
		}
	}

	// If no header row with th, add separator after first row
	if (!headerDone && result.length > 0) {
		const firstRow = rows[0]
		if (firstRow) {
			const cellCount = firstRow.querySelectorAll('td').length
			if (cellCount > 0) {
				result.splice(1, 0, `| ${Array(cellCount).fill('---').join(' | ')} |`)
			}
		}
	}

	return result.join('\n')
}

/**
 * Extract page title from HTML
 */
function extractTitle(root: HTMLElement): string | undefined {
	// Try meta title first
	const title = root.querySelector('title')
	if (title?.textContent) {
		return title.textContent.trim()
	}

	// Try og:title
	const ogTitle = root.querySelector('meta[property="og:title"]')
	if (ogTitle) {
		return ogTitle.getAttribute('content') ?? undefined
	}

	// Try first h1
	const h1 = root.querySelector('h1')
	if (h1?.textContent) {
		return h1.textContent.trim()
	}

	return undefined
}

/**
 * Extract meta description from HTML
 */
function extractDescription(root: HTMLElement): string | undefined {
	const meta = root.querySelector('meta[name="description"]')
	if (meta) {
		return meta.getAttribute('content') ?? undefined
	}

	const ogDesc = root.querySelector('meta[property="og:description"]')
	if (ogDesc) {
		return ogDesc.getAttribute('content') ?? undefined
	}

	return undefined
}

export interface HtmlToMarkdownResult {
	/** Extracted metadata for frontmatter */
	metadata: {
		title?: string
		description?: string
	}
	/** Converted markdown body */
	body: string
}

/**
 * Convert HTML string to markdown
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
	const root = parse(html)

	// Extract metadata
	const title = extractTitle(root)
	const description = extractDescription(root)

	// Get main content
	const mainContent = extractMainContent(root)

	// Convert to markdown
	let body = elementToMarkdown(mainContent)

	// Clean up the output
	body = body
		// Remove excessive newlines
		.replace(/\n{3,}/g, '\n\n')
		// Trim whitespace from each line
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		// Trim start and end
		.trim()

	return {
		metadata: {
			title,
			description,
		},
		body,
	}
}
