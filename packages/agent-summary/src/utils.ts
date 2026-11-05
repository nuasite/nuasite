import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PageMeta, RedirectMeta } from './types.ts'

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

/**
 * The redirects of a `_redirects` file (`source destination [status] [conditions]`). A rule without a
 * status redirects with 302, as Cloudflare Pages applies it; one with another status (a 200 rewrite, a
 * 404) is no redirect and is skipped, as are comments and lines without a destination.
 */
export const parseRedirectsFile = (text: string): RedirectMeta[] => {
	const records: RedirectMeta[] = []
	for (const line of text.split('\n')) {
		const [from, to, statusToken] = line.trim().split(/\s+/)
		if (!from || from.startsWith('#') || !to) continue
		// `!` forces the rule over an existing file; the status is the same.
		const status = statusToken && /^\d{3}!?$/.test(statusToken) ? statusToken.replace('!', '') : '302'
		if (!/^3\d\d$/.test(status)) continue
		records.push({ from: normalizeRoute(from), to: formatDestination(to), status })
	}
	return records
}

/** The `_redirects` of the build output, or `''` when there is none. */
export const readRedirectsFile = async (distDir: string): Promise<string> => {
	try {
		return await fs.readFile(path.join(distDir, '_redirects'), 'utf8')
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
		throw error
	}
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

export const updateAgentsSummary = async (agentsPath: string, pages: PageMeta[], redirects: RedirectMeta[]): Promise<void> => {
	const jsonlRecords = createJsonlRecords(pages, redirects)
	const summaryBody = jsonlRecords.join('\n')
	const summaryBlock = summaryBody
		? `${SUMMARY_START}\n${summaryBody}\n${SUMMARY_END}\n`
		: `${SUMMARY_START}\n${SUMMARY_END}\n`
	const agentsContent = await fs.readFile(agentsPath, 'utf8').catch(() => '')

	if (agentsContent.includes(SUMMARY_START) && agentsContent.includes(SUMMARY_END)) {
		const startIndex = agentsContent.indexOf(SUMMARY_START)
		const summaryEndIndex = agentsContent.indexOf(SUMMARY_END, startIndex)
		if (summaryEndIndex === -1) {
			const recovered = `${agentsContent.slice(0, startIndex)}${summaryBlock}`
			await fs.writeFile(agentsPath, recovered, 'utf8')
			return
		}

		let endIndex = summaryEndIndex + SUMMARY_END.length
		while (endIndex < agentsContent.length && (agentsContent[endIndex] === '\n' || agentsContent[endIndex] === '\r')) {
			endIndex += 1
		}

		const updated = `${agentsContent.slice(0, startIndex)}${summaryBlock}${agentsContent.slice(endIndex)}`
		await fs.writeFile(agentsPath, updated, 'utf8')
		return
	}

	const prefix = agentsContent.trimEnd()
	const separator = prefix.length === 0 ? '' : '\n'
	await fs.writeFile(agentsPath, `${prefix}${separator}${summaryBlock}`, 'utf8')
}
