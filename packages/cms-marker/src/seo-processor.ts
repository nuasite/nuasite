import { type HTMLElement as ParsedHTMLElement, parse } from 'node-html-parser'
import { findSeoSource } from './source-finder/seo-finder'
import type { CanonicalUrl, JsonLdEntry, OpenGraphData, PageSeoData, RobotsDirective, SeoKeywords, SeoMetaTag, SeoTitle, TwitterCardData } from './types'

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
	titleCmsId?: string
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
	let titleCmsId: string | undefined

	// Extract title
	const titleResult = await extractTitle(root, html, sourcePath, markTitle, getNextId)
	if (titleResult) {
		seo.title = titleResult.title
		titleCmsId = titleResult.cmsId
	}

	// Extract meta tags from head
	if (head) {
		const metaTags = await extractMetaTags(head, html, sourcePath)
		categorizeMetaTags(metaTags, seo)

		// Extract canonical URL
		const canonical = await extractCanonical(head, html, sourcePath)
		if (canonical) {
			seo.canonical = canonical
		}

		// Extract JSON-LD
		if (parseJsonLd) {
			const jsonLdEntries = await extractJsonLd(head, html, sourcePath)
			if (jsonLdEntries.length > 0) {
				seo.jsonLd = jsonLdEntries
			}
		}
	}

	return {
		seo,
		html: root.toString(),
		titleCmsId,
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
): Promise<{ title: SeoTitle; cmsId?: string } | undefined> {
	const titleElement = root.querySelector('title')
	if (!titleElement) return undefined

	const content = titleElement.textContent?.trim() || ''
	if (!content) return undefined

	// Try to find source location in actual source files
	const sourceLocation = await findSeoSource('title', { content })

	// Fall back to rendered HTML location if source not found
	const sourceInfo = sourceLocation || findElementSourceLocation(titleElement, html, sourcePath)

	let cmsId: string | undefined
	if (markTitle && getNextId) {
		cmsId = getNextId()
		titleElement.setAttribute('data-cms-id', cmsId)
	}

	return {
		title: {
			content,
			cmsId,
			...sourceInfo,
		},
		cmsId,
	}
}

/**
 * Extract all meta tags from the head
 */
async function extractMetaTags(
	head: HTMLNode,
	html: string,
	sourcePath?: string,
): Promise<SeoMetaTag[]> {
	const metaTags: SeoMetaTag[] = []
	const metas = head.querySelectorAll('meta')

	for (const meta of metas) {
		const name = meta.getAttribute('name')
		const property = meta.getAttribute('property')
		const content = meta.getAttribute('content')

		// Skip meta tags without content or without name/property
		if (!content || (!name && !property)) continue

		// Try to find source location in actual source files
		const sourceLocation = await findSeoSource('meta', { name: name || undefined, property: property || undefined, content })

		// Fall back to rendered HTML location if source not found
		const sourceInfo = sourceLocation || findElementSourceLocation(meta, html, sourcePath)

		metaTags.push({
			name: name || undefined,
			property: property || undefined,
			content,
			...sourceInfo,
		})
	}

	return metaTags
}

/**
 * Categorize meta tags into description, keywords, robots, Open Graph and Twitter Card
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

		// Robots
		if (name === 'robots') {
			const directives = content.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
			seo.robots = {
				...meta,
				directives,
			} as RobotsDirective
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
): Promise<CanonicalUrl | undefined> {
	const canonical = head.querySelector('link[rel="canonical"]')
	if (!canonical) return undefined

	const href = canonical.getAttribute('href')
	if (!href) return undefined

	// Try to find source location in actual source files
	const sourceLocation = await findSeoSource('canonical', { href })

	// Fall back to rendered HTML location if source not found
	const sourceInfo = sourceLocation || findElementSourceLocation(canonical, html, sourcePath)

	return {
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

			// Try to find source location in actual source files
			const sourceLocation = await findSeoSource('jsonld', { jsonLdType: type })

			// Fall back to rendered HTML location if source not found
			const sourceInfo = sourceLocation || findElementSourceLocation(script, html, sourcePath)

			entries.push({
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
