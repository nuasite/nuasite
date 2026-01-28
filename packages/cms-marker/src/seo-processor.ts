import { type HTMLElement as ParsedHTMLElement, parse } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from './config'
import { findSourceLocation } from './source-finder/source-lookup'
import type {
	CanonicalUrl,
	JsonLdEntry,
	OpenGraphData,
	PageSeoData,
	SeoKeywords,
	SeoMetaTag,
	SeoTitle,
	TwitterCardData,
} from './types'

/** Type for parsed HTML element nodes from node-html-parser */
type HTMLNode = ParsedHTMLElement

export interface ProcessSeoOptions {
	/** Whether to mark the page title with a CMS ID (default: true) */
	markTitle?: boolean
	/** Whether to parse JSON-LD structured data (default: true) */
	parseJsonLd?: boolean
	/** Path to source file for source tracking (fallback) */
	sourcePath?: string
}

export interface ProcessSeoResult {
	/** Extracted SEO data */
	seo: PageSeoData
	/** The modified HTML with title CMS ID if markTitle is enabled */
	html: string
	/** The CMS ID assigned to the title element */
	titleId?: string
}

/**
 * Process HTML to extract SEO metadata from the <head> section.
 * Returns structured SEO data with source tracking information.
 */
export async function processSeoFromHtml(
	html: string,
	options: ProcessSeoOptions = {},
	getNextId?: () => string,
): Promise<ProcessSeoResult> {
	const { markTitle = true, parseJsonLd = true, sourcePath } = options

	const root = parse(html, {
		lowerCaseTagName: false,
		comment: true,
		blockTextElements: {
			script: true,
			noscript: true,
			style: true,
			pre: true,
		},
	})

	const head = root.querySelector('head')
	const seo: PageSeoData = {}
	let titleId: string | undefined

	// Extract title
	const titleResult = await extractTitle(root, html, sourcePath, markTitle, getNextId)
	if (titleResult) {
		seo.title = titleResult.title
		titleId = titleResult.id
	}

	// Extract meta tags from head
	if (head) {
		const metaTags = await extractMetaTags(head, html, sourcePath, getNextId)
		categorizeMetaTags(metaTags, seo)

		// Extract canonical URL
		const canonical = await extractCanonical(head, html, sourcePath, getNextId)
		if (canonical) {
			seo.canonical = canonical
		}

		// Extract JSON-LD
		if (parseJsonLd) {
			const jsonLdEntries = await extractJsonLd(head, html, sourcePath, getNextId)
			if (jsonLdEntries.length > 0) {
				seo.jsonLd = jsonLdEntries
			}
		}
	}

	return {
		seo,
		html: root.toString(),
		titleId,
	}
}

/**
 * Extract the page title from HTML
 */
async function extractTitle(
	root: HTMLNode,
	html: string,
	sourcePath?: string,
	markTitle?: boolean,
	getNextId?: () => string,
): Promise<{ title: SeoTitle; id?: string } | undefined> {
	const titleElement = root.querySelector('title')
	if (!titleElement) return undefined

	const content = titleElement.textContent?.trim() || ''
	if (!content) return undefined

	// Use the same source finding logic as regular text entries
	// This tracks through props, variables, and imports
	const sourceLocation = await findSourceLocation(content, 'title')

	// Fall back to rendered HTML location if source not found
	const sourceInfo = sourceLocation
		? {
			sourcePath: sourceLocation.file,
			sourceLine: sourceLocation.line,
			sourceSnippet: sourceLocation.snippet || '',
		}
		: findElementSourceLocation(titleElement, html, sourcePath)

	let id: string | undefined
	if (markTitle && getNextId) {
		id = getNextId()
		titleElement.setAttribute('data-cms-id', id)
	}

	return {
		title: {
			content,
			id,
			...sourceInfo,
		},
		id,
	}
}

/**
 * Extract all meta tags from the head
 */
async function extractMetaTags(
	head: HTMLNode,
	html: string,
	sourcePath?: string,
	getNextId?: () => string,
): Promise<SeoMetaTag[]> {
	const metaTags: SeoMetaTag[] = []
	const metas = head.querySelectorAll('meta')

	for (const meta of metas) {
		const name = meta.getAttribute('name')
		const property = meta.getAttribute('property')
		const content = meta.getAttribute('content')

		// Skip meta tags without content or without name/property
		if (!content || (!name && !property)) continue

		// Use the same source finding logic as regular text entries
		// This tracks through props, variables, and imports
		const sourceLocation = await findSourceLocation(content, 'meta')

		// Fall back to rendered HTML location if source not found
		const sourceInfo = sourceLocation
			? {
				sourcePath: sourceLocation.file,
				sourceLine: sourceLocation.line,
				sourceSnippet: sourceLocation.snippet || '',
			}
			: findElementSourceLocation(meta, html, sourcePath)

		// Mark meta tag with CMS ID for editing
		let id: string | undefined
		if (getNextId) {
			id = getNextId()
			meta.setAttribute('data-cms-id', id)
		}

		metaTags.push({
			id,
			name: name || undefined,
			property: property || undefined,
			content,
			...sourceInfo,
		})
	}

	return metaTags
}

/**
 * Categorize meta tags into description, keywords, Open Graph and Twitter Card
 */
function categorizeMetaTags(metaTags: SeoMetaTag[], seo: PageSeoData): void {
	const openGraph: OpenGraphData = {}
	const twitterCard: TwitterCardData = {}

	for (const meta of metaTags) {
		const { name, property, content } = meta

		// Description
		if (name === 'description') {
			seo.description = meta
			continue
		}

		// Keywords
		if (name === 'keywords') {
			const keywords = content.split(',').map(k => k.trim()).filter(Boolean)
			seo.keywords = {
				...meta,
				keywords,
			} as SeoKeywords
			continue
		}

		// Open Graph tags
		if (property?.startsWith('og:')) {
			const ogKey = property.replace('og:', '')
			switch (ogKey) {
				case 'title':
					openGraph.title = meta
					break
				case 'description':
					openGraph.description = meta
					break
				case 'image':
					openGraph.image = meta
					break
				case 'url':
					openGraph.url = meta
					break
				case 'type':
					openGraph.type = meta
					break
				case 'site_name':
					openGraph.siteName = meta
					break
			}
			continue
		}

		// Twitter Card tags
		if (name?.startsWith('twitter:') || property?.startsWith('twitter:')) {
			const twitterKey = (name || property || '').replace('twitter:', '')
			switch (twitterKey) {
				case 'card':
					twitterCard.card = meta
					break
				case 'title':
					twitterCard.title = meta
					break
				case 'description':
					twitterCard.description = meta
					break
				case 'image':
					twitterCard.image = meta
					break
				case 'site':
					twitterCard.site = meta
					break
			}
		}
	}

	// Only add if we found any OG tags
	if (Object.keys(openGraph).length > 0) {
		seo.openGraph = openGraph
	}

	// Only add if we found any Twitter tags
	if (Object.keys(twitterCard).length > 0) {
		seo.twitterCard = twitterCard
	}
}

/**
 * Extract canonical URL from head
 */
async function extractCanonical(
	head: HTMLNode,
	html: string,
	sourcePath?: string,
	getNextId?: () => string,
): Promise<CanonicalUrl | undefined> {
	const canonical = head.querySelector('link[rel="canonical"]')
	if (!canonical) return undefined

	const href = canonical.getAttribute('href')
	if (!href) return undefined

	// Use the same source finding logic as regular text entries
	// This tracks through props, variables, and imports
	const sourceLocation = await findSourceLocation(href, 'link')

	// Fall back to rendered HTML location if source not found
	const sourceInfo = sourceLocation
		? {
			sourcePath: sourceLocation.file,
			sourceLine: sourceLocation.line,
			sourceSnippet: sourceLocation.snippet || '',
		}
		: findElementSourceLocation(canonical, html, sourcePath)

	// Mark canonical link with CMS ID for editing
	let id: string | undefined
	if (getNextId) {
		id = getNextId()
		canonical.setAttribute('data-cms-id', id)
	}

	return {
		id,
		href,
		...sourceInfo,
	}
}

/**
 * Extract JSON-LD structured data from script tags
 */
async function extractJsonLd(
	head: HTMLNode,
	html: string,
	sourcePath?: string,
	getNextId?: () => string,
): Promise<JsonLdEntry[]> {
	const entries: JsonLdEntry[] = []

	// Also check body for JSON-LD scripts (some sites place them there)
	const root = head.parentNode as HTMLNode
	const scripts = root?.querySelectorAll('script[type="application/ld+json"]') || []

	for (const script of scripts) {
		const content = script.textContent?.trim()
		if (!content) continue

		try {
			const data = JSON.parse(content)
			const type = data['@type'] || 'Unknown'

			// Search for JSON-LD script with this @type in source files
			const sourceLocation = await findJsonLdSource(type)

			// Fall back to rendered HTML location if source not found
			const sourceInfo = sourceLocation || findElementSourceLocation(script, html, sourcePath)

			// Mark JSON-LD script with CMS ID for editing
			let id: string | undefined
			if (getNextId) {
				id = getNextId()
				script.setAttribute('data-cms-id', id)
			}

			entries.push({
				id,
				type,
				data,
				...sourceInfo,
			})
		} catch {
			// Skip malformed JSON-LD
		}
	}

	return entries
}

/**
 * Search for JSON-LD script with a specific @type in source files
 */
async function findJsonLdSource(
	jsonLdType: string,
): Promise<{ sourcePath: string; sourceLine: number; sourceSnippet: string } | undefined> {
	const srcDir = path.join(getProjectRoot(), 'src')
	const searchDirs = [
		path.join(srcDir, 'pages'),
		path.join(srcDir, 'layouts'),
		path.join(srcDir, 'components'),
	]

	for (const dir of searchDirs) {
		try {
			const result = await searchDirForJsonLd(dir, jsonLdType)
			if (result) return result
		} catch {
			// Directory doesn't exist
		}
	}

	return undefined
}

/**
 * Recursively search a directory for JSON-LD scripts
 */
async function searchDirForJsonLd(
	dir: string,
	jsonLdType: string,
): Promise<{ sourcePath: string; sourceLine: number; sourceSnippet: string } | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchDirForJsonLd(fullPath, jsonLdType)
				if (result) return result
			} else if (entry.isFile() && (entry.name.endsWith('.astro') || entry.name.endsWith('.html'))) {
				const result = await searchFileForJsonLd(fullPath, jsonLdType)
				if (result) return result
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
}

/**
 * Search a single file for JSON-LD with a specific @type
 */
async function searchFileForJsonLd(
	filePath: string,
	jsonLdType: string,
): Promise<{ sourcePath: string; sourceLine: number; sourceSnippet: string } | undefined> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] || ''

			// Look for JSON-LD script opening
			if (line.includes('application/ld+json')) {
				// Check following lines for the @type
				const snippetLines: string[] = []
				let foundType = false

				for (let j = i; j < Math.min(i + 30, lines.length); j++) {
					const snippetLine = lines[j] || ''
					snippetLines.push(snippetLine)

					// Check if this JSON-LD contains the @type we're looking for
					if (snippetLine.includes(`"@type"`) && snippetLine.includes(jsonLdType)) {
						foundType = true
					}

					// Check for closing script tag
					if (snippetLine.includes('</script>')) {
						break
					}
				}

				if (foundType) {
					return {
						sourcePath: path.relative(getProjectRoot(), filePath),
						sourceLine: i + 1,
						sourceSnippet: snippetLines.join('\n'),
					}
				}
			}
		}
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Find the source location (line number and snippet) for an element in the rendered HTML.
 * This is a fallback when the actual source file location cannot be found.
 */
function findElementSourceLocation(
	element: HTMLNode,
	html: string,
	sourcePath?: string,
): { sourcePath: string; sourceLine: number; sourceSnippet: string } {
	// Get the element's outer HTML as the source snippet
	const sourceSnippet = element.toString()

	// Find the line number by searching for the element in the original HTML
	let sourceLine = 1
	const elementStr = sourceSnippet.split('\n')[0] || sourceSnippet // Use first line for matching
	const lines = html.split('\n')

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line?.includes(elementStr.substring(0, Math.min(50, elementStr.length)))) {
			sourceLine = i + 1
			break
		}
	}

	return {
		sourcePath: sourcePath || '',
		sourceLine,
		sourceSnippet,
	}
}

