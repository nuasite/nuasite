import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PageMeta, RedirectMeta } from './types'

export const AGENTS_PATH = path.resolve('AGENTS.md')
export const SUMMARY_START = '<page_summary>'
export const SUMMARY_END = '</page_summary>'

export const decodeEntities = (value: string): string => {
	return value
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&nbsp;/gi, ' ')
}

export const sanitize = (value: string | undefined): string => {
	if (!value) {
		return ''
	}

	const decoded = decodeEntities(value)
	return decoded
		.replace(/\s+/g, ' ')
		.replace(/[\u2012-\u2015]/g, '-')
		.replace(/\u2026/g, '...')
		.trim()
}

export const truncate = (value: string, maxLength: number): string => {
	if (value.length <= maxLength) {
		return value
	}
	return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

export const sentence = (label: string, value: string): string => {
	const trimmed = value.trim()
	const suffix = /[.!?]$/.test(trimmed) ? '' : '.'
	return `${label}: ${trimmed}${suffix}`
}

export const normalizeRoute = (pathname: string): string => {
	const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
	if (trimmed.length === 0) {
		return '/'
	}
	return `/${trimmed}`
}

export const formatDestination = (value: string): string => {
	if (!value) {
		return '/'
	}

	if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith('#')) {
		return value
	}

	return normalizeRoute(value)
}

export const resolveHtmlPath = async (distDir: string, pathname: string): Promise<string | null> => {
	const normalizedRoute = normalizeRoute(pathname)
	const routeSegment = normalizedRoute === '/' ? '' : normalizedRoute.slice(1)
	const candidates = routeSegment === ''
		? [path.join(distDir, 'index.html')]
		: [
			path.join(distDir, routeSegment, 'index.html'),
			path.join(distDir, `${routeSegment}.html`),
		]

	for (const candidate of candidates) {
		try {
			const stats = await fs.stat(candidate)
			if (stats.isFile()) {
				return candidate
			}
		} catch {
			// Ignore missing files; try next candidate.
		}
	}

	return null
}

export const extractMetaFromHtml = (route: string, html: string): PageMeta => {
	const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
	const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]*?>/i)
	const contentMatch = metaMatch?.[0]?.match(/content=["']([^"']*)["']/i)
	const headingMatches = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)]
	const headingEntries = headingMatches
		.map((match) => ({
			level: `h${match[1]}`,
			text: sanitize(match[2]?.replace(/<[^>]+>/g, '')),
		}))
		.filter((entry) => entry.text.length > 0)
	const primaryHeading = headingEntries.find((entry) => entry.level === 'h1' && entry.text.length >= 8)
		|| headingEntries.find((entry) => entry.text.length >= 16)
		|| headingEntries[0]
	const primaryHeadingText = primaryHeading?.text ?? ''
	const paragraphMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
	const paragraphCandidates = paragraphMatches.map((match) => sanitize(match[1]?.replace(/<[^>]+>/g, '')))
	const fallbackParagraph = paragraphCandidates.find((text) => text.length >= 40) ?? paragraphCandidates[0] ?? ''

	const title = sanitize(titleMatch?.[1] ?? (primaryHeadingText || 'Untitled page'))
	const descriptionSource = contentMatch?.[1]
	const paragraphDescription = descriptionSource ? '' : fallbackParagraph
	const description = truncate((descriptionSource ? sanitize(descriptionSource) : paragraphDescription) || 'Description unavailable', 220)

	return {
		route: normalizeRoute(route),
		title,
		description,
		headlines: headingEntries,
	}
}

const createJsonlRecords = (pages: PageMeta[], redirects: RedirectMeta[]): string[] => {
	const records: string[] = []

	for (const page of pages.sort((a, b) => a.route.localeCompare(b.route))) {
		records.push(JSON.stringify({
			kind: 'page',
			route: page.route,
			title: page.title,
			description: page.description,
			headlines: page.headlines,
		}))
	}

	for (const redirect of redirects.sort((a, b) => a.from.localeCompare(b.from))) {
		records.push(JSON.stringify({
			kind: 'redirect' as const,
			route: redirect.from,
			to: redirect.to,
			status: redirect.status,
		}))
	}

	return records
}

export const updateAgentsSummary = async (pages: PageMeta[], redirects: RedirectMeta[]): Promise<void> => {
	const jsonlRecords = createJsonlRecords(pages, redirects)
	const summaryBody = jsonlRecords.join('\n')
	const summaryBlock = `${SUMMARY_START}\n\n${summaryBody}${summaryBody ? '\n' : ''}\n${SUMMARY_END}\n`
	const agentsContent = await fs.readFile(AGENTS_PATH, 'utf8').catch(() => '')

	if (agentsContent.includes(SUMMARY_START) && agentsContent.includes(SUMMARY_END)) {
		const startIndex = agentsContent.indexOf(SUMMARY_START)
		const endIndex = agentsContent.indexOf(SUMMARY_END) + SUMMARY_END.length
		const updated = `${agentsContent.slice(0, startIndex)}${summaryBlock}${agentsContent.slice(endIndex)}`
		await fs.writeFile(AGENTS_PATH, updated, 'utf8')
		return
	}

	const prefix = agentsContent.trimEnd()
	const separator = prefix.length === 0 ? '' : '\n\n'
	await fs.writeFile(AGENTS_PATH, `${prefix}${separator}${summaryBlock}`, 'utf8')
}
