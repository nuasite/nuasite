import type { HTMLElement as ParsedHTMLElement } from 'node-html-parser'

// ── Severity & Domain ──────────────────────────────────────────────────────────

export type CheckSeverity = 'error' | 'warning' | 'info'
export type CheckDomain = 'seo' | 'geo' | 'performance' | 'accessibility' | 'ai'
export type CheckMode = 'auto' | 'full' | 'essential'

// ── Check Result ───────────────────────────────────────────────────────────────

export interface CheckResult {
	checkId: string
	ruleName: string
	domain: CheckDomain
	severity: CheckSeverity
	message: string
	suggestion?: string
	pagePath: string
	filePath?: string
	line?: number
	actual?: string
	expected?: string
}

// ── Check Interfaces ───────────────────────────────────────────────────────────

/** Per-page check — runs once for each HTML page */
export interface Check {
	kind: 'page'
	id: string
	name: string
	domain: CheckDomain
	defaultSeverity: CheckSeverity
	description: string
	/** Whether this check runs in essential mode (true) or only in full mode (false) */
	essential: boolean
	run(context: PageCheckContext): CheckResult[]
}

/** Site-level check — runs once after all pages are processed */
export interface SiteCheck {
	kind: 'site'
	id: string
	name: string
	domain: CheckDomain
	defaultSeverity: CheckSeverity
	description: string
	essential: boolean
	run(context: SiteCheckContext): CheckResult[]
}

// ── Check Contexts ─────────────────────────────────────────────────────────────

export interface PageCheckContext {
	pagePath: string
	filePath: string
	html: string
	root: ParsedHTMLElement
	pageData: ExtractedPageData
}

export interface SiteCheckContext {
	distDir: string
	pages: Map<string, ExtractedPageData>
	siteUrl?: string
}

// ── Extracted Page Data ────────────────────────────────────────────────────────

export interface ExtractedPageData {
	title?: { content: string; line: number }
	metaDescription?: { content: string; line: number }
	metaTags: MetaTagData[]
	openGraph: Record<string, { content: string; line: number }>
	twitterCard: Record<string, { content: string; line: number }>
	canonical?: { href: string; line: number }
	jsonLd: JsonLdData[]
	headings: HeadingData[]
	images: ImageData[]
	links: LinkData[]
	scripts: ScriptData[]
	stylesheets: StylesheetData[]
	forms: ExtractedFormData[]
	htmlLang?: string
	htmlSize: number
	bodyTextLength: number
}

export interface MetaTagData {
	name?: string
	property?: string
	content: string
	line: number
}

export interface JsonLdData {
	type: string
	raw: string
	valid: boolean
	error?: string
	line: number
}

export interface HeadingData {
	level: number
	text: string
	line: number
}

export interface ImageData {
	src: string
	alt?: string
	loading?: string
	line: number
}

export interface LinkData {
	href: string
	text: string
	rel?: string
	line: number
}

export interface ScriptData {
	src?: string
	type?: string
	isAsync: boolean
	isDefer: boolean
	line: number
}

export interface StylesheetData {
	href: string
	media?: string
	line: number
}

export interface ExtractedFormData {
	inputs: FormInputData[]
	line: number
}

export interface FormInputData {
	type: string
	name?: string
	id?: string
	hasLabel: boolean
	line: number
}

// ── Configuration ──────────────────────────────────────────────────────────────

export interface ChecksOptions {
	mode?: CheckMode
	seo?: boolean | SeoChecksConfig
	geo?: boolean | GeoChecksConfig
	performance?: boolean | PerformanceChecksConfig
	accessibility?: boolean | AccessibilityChecksConfig
	ai?: AiChecksConfig | false
	failOnError?: boolean
	failOnWarning?: boolean
	overrides?: Record<string, CheckSeverity | false>
	customChecks?: (Check | SiteCheck)[]
}

export interface SeoChecksConfig {
	titleMaxLength?: number
	descriptionMaxLength?: number
	descriptionMinLength?: number
}

export interface GeoChecksConfig {
	minContentLength?: number
	minHeadings?: number
}

export interface PerformanceChecksConfig {
	maxHtmlSize?: number
	maxImageSize?: number
	allowedImageFormats?: string[]
}

export type AccessibilityChecksConfig = {}

export interface AiChecksConfig {
	apiKey?: string
	checks?: string[]
	maxPages?: number
	cache?: boolean
}

export interface ResolvedChecksOptions {
	mode: CheckMode
	seo: SeoChecksConfig | false
	geo: GeoChecksConfig | false
	performance: PerformanceChecksConfig | false
	accessibility: AccessibilityChecksConfig | false
	ai: AiChecksConfig | false
	failOnError: boolean
	failOnWarning: boolean
	overrides: Record<string, CheckSeverity | false>
	customChecks: (Check | SiteCheck)[]
}

// ── Report ─────────────────────────────────────────────────────────────────────

export interface CheckReport {
	totalPages: number
	totalChecks: number
	results: CheckResult[]
	errors: CheckResult[]
	warnings: CheckResult[]
	infos: CheckResult[]
	passed: boolean
}
