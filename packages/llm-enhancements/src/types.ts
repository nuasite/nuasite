export interface PageMarkdownOptions {
	/** Directory containing content collections (default: 'src/content') */
	contentDir?: string
	/** Whether to include static (non-collection) pages (default: true) */
	includeStaticPages?: boolean
	/** Whether to include frontmatter in output (default: true) */
	includeFrontmatter?: boolean
	/** Enable /.well-known/llm.md endpoint (default: true) */
	llmEndpoint?: boolean | LlmEndpointOptions
	/** Enable /llms.txt endpoint (default: true) */
	llmsTxt?: boolean | LlmsTxtOptions
}

export interface LlmEndpointOptions {
	/** Site name override */
	siteName?: string
	/** Site description override */
	description?: string
	/** Base URL override (defaults to Astro's site config) */
	baseUrl?: string
	/** Additional content to append */
	additionalContent?: string
}

export interface LlmsTxtOptions {
	/** Site name override */
	siteName?: string
	/** Site description override */
	description?: string
	/** Base URL override (defaults to Astro's site config) */
	baseUrl?: string
	/** Whether crawling is allowed (default: true) */
	allowCrawling?: boolean
	/** Custom instructions for LLMs */
	instructions?: string
	/** Additional content to append */
	additionalContent?: string
}

export interface MarkdownOutput {
	/** YAML frontmatter fields */
	frontmatter: Record<string, unknown>
	/** Markdown body content */
	body: string
	/** Path to the original source file (if from collection) */
	sourcePath?: string
}

export interface ResolvedOptions {
	contentDir: string
	includeStaticPages: boolean
	includeFrontmatter: boolean
	llmEndpoint: false | LlmEndpointOptions
	llmsTxt: false | LlmsTxtOptions
}

export function resolveOptions(options: PageMarkdownOptions = {}): ResolvedOptions {
	const llmEndpoint = options.llmEndpoint ?? true
	const llmsTxt = options.llmsTxt ?? true
	return {
		contentDir: options.contentDir ?? 'src/content',
		includeStaticPages: options.includeStaticPages ?? true,
		includeFrontmatter: options.includeFrontmatter ?? true,
		llmEndpoint: llmEndpoint === false ? false : llmEndpoint === true ? {} : llmEndpoint,
		llmsTxt: llmsTxt === false ? false : llmsTxt === true ? {} : llmsTxt,
	}
}
