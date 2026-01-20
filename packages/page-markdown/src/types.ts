export interface PageMarkdownOptions {
	/** Directory containing content collections (default: 'src/content') */
	contentDir?: string
	/** Whether to include static (non-collection) pages (default: true) */
	includeStaticPages?: boolean
	/** Whether to include frontmatter in output (default: true) */
	includeFrontmatter?: boolean
	/** Enable /.well-known/llm.md endpoint (default: true) */
	llmEndpoint?: boolean | LlmEndpointOptions
}

export interface LlmEndpointOptions {
	/** Site name override */
	siteName?: string
	/** Site description override */
	description?: string
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
}

export function resolveOptions(options: PageMarkdownOptions = {}): ResolvedOptions {
	const llmEndpoint = options.llmEndpoint ?? true
	return {
		contentDir: options.contentDir ?? 'src/content',
		includeStaticPages: options.includeStaticPages ?? true,
		includeFrontmatter: options.includeFrontmatter ?? true,
		llmEndpoint: llmEndpoint === false ? false : llmEndpoint === true ? {} : llmEndpoint,
	}
}
