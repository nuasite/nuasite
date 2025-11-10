import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PageMeta, RedirectMeta } from '../../../src/types.ts'

const utilsModule = await import('../../../src/utils.ts')
const {
	decodeEntities,
	sanitize,
	truncate,
	sentence,
	normalizeRoute,
	formatDestination,
	resolveHtmlPath,
	extractMetaFromHtml,
	updateAgentsSummary,
	SUMMARY_START,
	SUMMARY_END,
	AGENTS_PATH,
} = utilsModule

describe('string helpers', () => {
	it('sanitizes and decodes entities', () => {
		const value = '  Hello&nbsp;&nbsp;World &amp; friends\u2026  '
		expect(sanitize(value)).toBe('Hello World & friends...')
	})

	it('truncates long values with ellipsis', () => {
		const input = 'a'.repeat(10)
		expect(truncate(input, 10)).toBe('a'.repeat(10))
		expect(truncate(input, 6)).toBe('aaa...')
	})

	it('ensures sentences end with punctuation', () => {
		expect(sentence('Label', 'Value')).toBe('Label: Value.')
		expect(sentence('Label', 'Ends with!')).toBe('Label: Ends with!')
	})

	it('normalizes routes and destinations', () => {
		expect(normalizeRoute('/')).toBe('/')
		expect(normalizeRoute('docs/guide/')).toBe('/docs/guide')
		expect(formatDestination('https://example.com')).toBe('https://example.com')
		expect(formatDestination('#anchor')).toBe('#anchor')
		expect(formatDestination('docs')).toBe('/docs')
	})

	it('decodes a variety of HTML entities', () => {
		expect(decodeEntities('&lt;strong&gt;Tom &amp; Jerry&#39;s&lt;/strong&gt;')).toBe("<strong>Tom & Jerry's</strong>")
	})
})

describe('resolveHtmlPath', () => {
	const makeTempDir = async (): Promise<string> => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-summary-test-'))
		return dir
	}

	afterEach(async () => {
		const tempRoots = await fs.readdir(os.tmpdir())
		await Promise.all(
			tempRoots
				.filter((name) => name.startsWith('agent-summary-test-'))
				.map((name) => fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }).catch(() => {})),
		)
	})

	it('finds index.html inside a directory', async () => {
		const dir = await makeTempDir()
		const aboutDir = path.join(dir, 'about')
		await fs.mkdir(aboutDir, { recursive: true })
		const target = path.join(aboutDir, 'index.html')
		await fs.writeFile(target, '<html></html>', 'utf8')

		const resolved = await resolveHtmlPath(dir, '/about/')
		expect(resolved).toBe(target)
	})

	it('falls back to a flat html file', async () => {
		const dir = await makeTempDir()
		const target = path.join(dir, 'contact.html')
		await fs.writeFile(target, '<html></html>', 'utf8')

		const resolved = await resolveHtmlPath(dir, '/contact')
		expect(resolved).toBe(target)
	})

	it('returns null when no html output exists', async () => {
		const dir = await makeTempDir()
		const resolved = await resolveHtmlPath(dir, '/missing')
		expect(resolved).toBeNull()
	})
})

describe('extractMetaFromHtml', () => {
	it('pulls metadata from title, meta description, and headings', () => {
		const html = `
			<!doctype html>
			<html lang="en">
				<head>
					<title>Sample &amp; Page</title>
					<meta name="description" content="Short &amp; sweet summary.">
				</head>
				<body>
					<h1>Primary Heading</h1>
					<h2>Secondary Heading</h2>
					<p>Paragraph content that should be ignored because the meta tag is present.</p>
				</body>
			</html>
		`

		const meta = extractMetaFromHtml('/docs/example', html)
		expect(meta.route).toBe('/docs/example')
		expect(meta.title).toBe('Sample & Page')
		expect(meta.description).toBe('Short & sweet summary.')
		expect(meta.headlines).toEqual([
			{ level: 'h1', text: 'Primary Heading' },
			{ level: 'h2', text: 'Secondary Heading' },
		])
	})

	it('derives description and heading fallback when metadata is missing', () => {
		const html = `
			<!doctype html>
			<html lang="en">
				<head>
					<title>Untidy   Title\u2026</title>
				</head>
				<body>
					<h2>Short</h2>
					<h3>Enough characters to act as primary heading</h3>
					<p>
						This paragraph contains enough characters to act as a description even without a meta tag.
					</p>
				</body>
			</html>
		`

		const meta = extractMetaFromHtml('blog/post', html)
		expect(meta.route).toBe('/blog/post')
		expect(meta.title).toBe('Untidy Title...')
		expect(meta.description).toBe('This paragraph contains enough characters to act as a description even without a meta tag.')
		expect(meta.headlines[0]).toEqual({ level: 'h2', text: 'Short' })
		expect(meta.headlines[1]).toEqual({ level: 'h3', text: 'Enough characters to act as primary heading' })
	})
})

describe('updateAgentsSummary', () => {
	let originalContent: string | null = null

	beforeAll(async () => {
		originalContent = await fs.readFile(AGENTS_PATH, 'utf8').catch(() => null)
	})

	afterEach(async () => {
		await fs.rm(AGENTS_PATH, { force: true })
	})

	afterAll(async () => {
		if (originalContent !== null) {
			await fs.writeFile(AGENTS_PATH, originalContent, 'utf8')
		} else {
			await fs.rm(AGENTS_PATH, { force: true })
		}
	})

	const blockBody = (content: string, start: string, end: string): string => {
		const startIndex = content.indexOf(start)
		if (startIndex === -1) {
			return ''
		}

		let bodyStart = startIndex + start.length
		while (bodyStart < content.length && (content[bodyStart] === '\n' || content[bodyStart] === '\r')) {
			bodyStart += 1
		}

		const endWithNewline = content.indexOf(`\n${end}`, bodyStart)
		const endIndex = endWithNewline >= 0
			? endWithNewline
			: content.indexOf(end, bodyStart)
		const body = endIndex >= 0 ? content.slice(bodyStart, endIndex) : content.slice(bodyStart)
		return body.replace(/\r/g, '').trimEnd()
	}

	const summaryLines = (content: string): string[] => {
		const body = blockBody(content, SUMMARY_START, SUMMARY_END)
		return body.length === 0 ? [] : body.split('\n')
	}

	it('creates a summary block when none exists', async () => {
		const pages: PageMeta[] = [
			{
				route: '/b',
				title: 'Beta',
				description: 'Beta description',
				headlines: [],
			},
			{
				route: '/a',
				title: 'Alpha',
				description: 'Alpha description',
				headlines: [],
			},
		]

		const redirects: RedirectMeta[] = [
			{ from: '/old', to: '/new', status: '302' },
			{ from: '/another', to: '/target', status: '301' },
		]

		await updateAgentsSummary(pages, redirects)

		const content = await fs.readFile(AGENTS_PATH, 'utf8')
		expect(content.includes(SUMMARY_START)).toBe(true)

		const lines = summaryLines(content)
		expect(lines).toEqual([
			JSON.stringify({ kind: 'page', route: '/a', title: 'Alpha', description: 'Alpha description', headlines: [] }),
			JSON.stringify({ kind: 'page', route: '/b', title: 'Beta', description: 'Beta description', headlines: [] }),
			JSON.stringify({ kind: 'redirect', route: '/another', to: '/target', status: '301' }),
			JSON.stringify({ kind: 'redirect', route: '/old', to: '/new', status: '302' }),
		])
	})

	it('replaces an existing summary block and preserves surrounding content', async () => {
		const prefix = '# Agents\n\nIntro text.\n'
		const suffix = '\nAdditional details.'
		const existing = `${prefix}${SUMMARY_START}\n\n{"kind":"page"}\n\n${SUMMARY_END}\n${suffix}`
		await fs.writeFile(AGENTS_PATH, existing, 'utf8')

		const pages: PageMeta[] = [
			{
				route: '/',
				title: 'Home',
				description: 'Home description',
				headlines: [],
			},
		]

		await updateAgentsSummary(pages, [])

		const content = await fs.readFile(AGENTS_PATH, 'utf8')
		expect(content.startsWith(prefix)).toBe(true)
		expect(content).toContain(suffix)
		const lines = summaryLines(content)
		expect(lines).toEqual([
			JSON.stringify({ kind: 'page', route: '/', title: 'Home', description: 'Home description', headlines: [] }),
		])
	})
})
