import { type HTMLElement as ParsedHTMLElement, parse } from 'node-html-parser'
import type {
	ExtractedFormData,
	ExtractedPageData,
	HeadingData,
	ImageData,
	JsonLdData,
	LinkData,
	MetaTagData,
	ScriptData,
	StylesheetData,
} from './types'

/**
 * Parse HTML and extract all data needed by checks.
 * Parses once per page — all checks receive the same ExtractedPageData.
 */
export function analyzeHtml(html: string): { root: ParsedHTMLElement; pageData: ExtractedPageData } {
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
	const body = root.querySelector('body')
	const htmlElement = root.querySelector('html')
	const lineIndex = buildLineIndex(html)

	// Extract body text length once for content quality checks
	const bodyTextLength = (body?.querySelector('main')?.textContent ?? body?.textContent ?? '').trim().length

	const pageData: ExtractedPageData = {
		metaTags: [],
		openGraph: {},
		twitterCard: {},
		jsonLd: [],
		headings: [],
		images: [],
		links: [],
		scripts: [],
		stylesheets: [],
		forms: [],
		htmlLang: htmlElement?.getAttribute('lang') || undefined,
		htmlSize: Buffer.byteLength(html, 'utf8'),
		bodyTextLength,
		hasViewport: false,
		hasNoindex: false,
		inlineScriptBytes: 0,
		inlineStyleBytes: 0,
	}

	if (head) {
		pageData.title = extractTitle(head, html, lineIndex)
		pageData.metaTags = extractMetaTags(head, html, lineIndex)
		categorizeMetaTags(pageData)
		pageData.canonical = extractCanonical(head, html, lineIndex)
		pageData.jsonLd = extractJsonLd(root, html, lineIndex)
		pageData.scripts = extractScripts(root, html, lineIndex)
		pageData.stylesheets = extractStylesheets(head, html, lineIndex)

		// Compute inline sizes from extracted data
		pageData.inlineScriptBytes = pageData.scripts
			.filter(s => s.isInline)
			.reduce((sum, s) => sum + s.size, 0)

		for (const style of root.querySelectorAll('style')) {
			const content = style.textContent ?? ''
			if (content) pageData.inlineStyleBytes += Buffer.byteLength(content, 'utf8')
		}
	}

	if (body) {
		pageData.headings = extractHeadings(body, html, lineIndex)
		pageData.images = extractImages(root, html, lineIndex)
		pageData.links = extractLinks(body, html, lineIndex)
		pageData.forms = extractForms(body, html, lineIndex)
	}

	return { root, pageData }
}

// ── Line index for efficient offset → line conversion ──────────────────────────

/** Precompute newline offsets for O(log n) offset-to-line lookups */
function buildLineIndex(html: string): number[] {
	const offsets = [0]
	for (let i = 0; i < html.length; i++) {
		if (html[i] === '\n') offsets.push(i + 1)
	}
	return offsets
}

/** Binary search to convert a character offset to a 1-based line number */
function offsetToLine(lineIndex: number[], offset: number): number {
	let lo = 0
	let hi = lineIndex.length - 1
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1
		if (lineIndex[mid]! <= offset) lo = mid + 1
		else hi = mid - 1
	}
	return lo // 1-based since offsets[0] = 0 means line 1
}

/**
 * Advancing line finder — tracks position to handle duplicate elements correctly.
 * Each call advances the search start so identical markup gets distinct line numbers.
 */
function createLineFinder(html: string, lineIndex: number[]) {
	let pos = 0
	return (search: string): number => {
		const idx = html.indexOf(search, pos)
		if (idx !== -1) {
			pos = idx + 1
			return offsetToLine(lineIndex, idx)
		}
		// Fallback: search from beginning for edge cases
		const fallback = html.indexOf(search)
		if (fallback !== -1) return offsetToLine(lineIndex, fallback)
		return 1
	}
}

function extractTitle(head: ParsedHTMLElement, html: string, lineIndex: number[]): ExtractedPageData['title'] {
	const titleEl = head.querySelector('title')
	if (!titleEl) return undefined
	const content = titleEl.textContent?.trim() || ''
	const findLine = createLineFinder(html, lineIndex)
	return { content, line: findLine('<title') }
}

function extractMetaTags(head: ParsedHTMLElement, html: string, lineIndex: number[]): MetaTagData[] {
	const tags: MetaTagData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const meta of head.querySelectorAll('meta')) {
		const name = meta.getAttribute('name')
		const property = meta.getAttribute('property')
		const content = meta.getAttribute('content')
		if (!content || (!name && !property)) continue
		tags.push({
			name: name || undefined,
			property: property || undefined,
			content,
			line: findLine(meta.toString().substring(0, 60)),
		})
	}
	return tags
}

function categorizeMetaTags(pageData: ExtractedPageData): void {
	for (const meta of pageData.metaTags) {
		if (meta.name === 'description') {
			pageData.metaDescription = { content: meta.content, line: meta.line }
		}
		if (meta.name === 'viewport') {
			pageData.hasViewport = true
		}
		if (meta.name === 'robots' && meta.content.toLowerCase().includes('noindex')) {
			pageData.hasNoindex = true
		}
		if (meta.property?.startsWith('og:')) {
			const key = meta.property.replace('og:', '')
			pageData.openGraph[key] = { content: meta.content, line: meta.line }
		}
		if ((meta.name ?? meta.property ?? '').startsWith('twitter:')) {
			const key = (meta.name ?? meta.property ?? '').replace('twitter:', '')
			pageData.twitterCard[key] = { content: meta.content, line: meta.line }
		}
	}
}

function extractCanonical(head: ParsedHTMLElement, html: string, lineIndex: number[]): ExtractedPageData['canonical'] {
	const link = head.querySelector('link[rel="canonical"]')
	if (!link) return undefined
	const href = link.getAttribute('href')
	if (!href) return undefined
	const findLine = createLineFinder(html, lineIndex)
	return { href, line: findLine('rel="canonical"') }
}

function extractJsonLd(root: ParsedHTMLElement, html: string, lineIndex: number[]): JsonLdData[] {
	const entries: JsonLdData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
		const raw = script.textContent?.trim() || ''
		if (!raw) continue
		const line = findLine('application/ld+json')
		try {
			const data = JSON.parse(raw)
			entries.push({ type: data['@type'] || 'Unknown', raw, valid: true, line })
		} catch (e) {
			entries.push({
				type: 'Unknown',
				raw,
				valid: false,
				error: e instanceof Error ? e.message : String(e),
				line,
			})
		}
	}
	return entries
}

function extractHeadings(body: ParsedHTMLElement, html: string, lineIndex: number[]): HeadingData[] {
	const headings: HeadingData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const el of body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
		const tag = el.tagName?.toLowerCase() || ''
		const level = parseInt(tag.replace('h', ''), 10)
		if (Number.isNaN(level)) continue
		headings.push({
			level,
			text: el.textContent?.trim() || '',
			line: findLine(el.toString().substring(0, 40)),
		})
	}
	return headings
}

function extractImages(root: ParsedHTMLElement, html: string, lineIndex: number[]): ImageData[] {
	const images: ImageData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const img of root.querySelectorAll('img')) {
		images.push({
			src: img.getAttribute('src') || '',
			alt: img.getAttribute('alt') ?? undefined,
			loading: img.getAttribute('loading') || undefined,
			line: findLine(img.toString().substring(0, 60)),
		})
	}
	return images
}

function extractLinks(body: ParsedHTMLElement, html: string, lineIndex: number[]): LinkData[] {
	const links: LinkData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const a of body.querySelectorAll('a')) {
		links.push({
			href: a.getAttribute('href') || '',
			text: a.textContent?.trim() || '',
			rel: a.getAttribute('rel') || undefined,
			line: findLine(a.toString().substring(0, 60)),
		})
	}
	return links
}

function extractScripts(root: ParsedHTMLElement, html: string, lineIndex: number[]): ScriptData[] {
	const scripts: ScriptData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const script of root.querySelectorAll('script')) {
		const src = script.getAttribute('src') || undefined
		const content = script.textContent ?? ''
		const isInline = !src && content.trim().length > 0
		scripts.push({
			src,
			type: script.getAttribute('type') || undefined,
			isAsync: script.hasAttribute('async'),
			isDefer: script.hasAttribute('defer'),
			isInline,
			size: isInline ? Buffer.byteLength(content, 'utf8') : 0,
			line: findLine(script.toString().substring(0, 60)),
		})
	}
	return scripts
}

function extractStylesheets(head: ParsedHTMLElement, html: string, lineIndex: number[]): StylesheetData[] {
	const stylesheets: StylesheetData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const link of head.querySelectorAll('link[rel="stylesheet"]')) {
		const href = link.getAttribute('href')
		if (!href) continue
		stylesheets.push({
			href,
			media: link.getAttribute('media') || undefined,
			line: findLine(link.toString().substring(0, 60)),
		})
	}
	return stylesheets
}

function extractForms(body: ParsedHTMLElement, html: string, lineIndex: number[]): ExtractedFormData[] {
	const forms: ExtractedFormData[] = []
	const findLine = createLineFinder(html, lineIndex)
	for (const form of body.querySelectorAll('form')) {
		const inputs: ExtractedFormData['inputs'] = []
		const inputFinder = createLineFinder(html, lineIndex)
		for (const input of form.querySelectorAll('input, select, textarea')) {
			const id = input.getAttribute('id')
			const name = input.getAttribute('name')
			const type = input.getAttribute('type') || input.tagName?.toLowerCase() || 'text'

			// Skip hidden inputs (they don't need labels)
			if (type === 'hidden' || type === 'submit' || type === 'button') continue

			// Check for associated label
			const hasLabel = !!(
				(id && form.querySelector(`label[for="${id}"]`))
				|| input.closest('label')
				|| input.getAttribute('aria-label')
				|| input.getAttribute('aria-labelledby')
			)

			inputs.push({
				type,
				name: name || undefined,
				id: id || undefined,
				hasLabel,
				line: inputFinder(input.toString().substring(0, 60)),
			})
		}
		forms.push({
			inputs,
			line: findLine(form.toString().substring(0, 40)),
		})
	}
	return forms
}
