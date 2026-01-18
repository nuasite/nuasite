export interface PageMarkdownOptions {
	/** Directory containing content collections (default: 'src/content') */
	contentDir?: string
	/** Whether to include static (non-collection) pages (default: true) */
	includeStaticPages?: boolean
	/** Whether to include frontmatter in output (default: true) */
	includeFrontmatter?: boolean
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
}

export function resolveOptions(options: PageMarkdownOptions = {}): ResolvedOptions {
	return {
		contentDir: options.contentDir ?? 'src/content',
		includeStaticPages: options.includeStaticPages ?? true,
		includeFrontmatter: options.includeFrontmatter ?? true,
	}
}
