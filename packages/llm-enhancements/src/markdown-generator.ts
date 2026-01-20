import type { MarkdownOutput } from './types'

/**
 * Serialize a value to YAML format
 */
function yamlValue(value: unknown): string {
	if (value === null || value === undefined) {
		return 'null'
	}
	if (typeof value === 'string') {
		// Check if string needs quoting
		if (
			value.includes('\n')
			|| value.includes(':')
			|| value.includes('#')
			|| value.startsWith(' ')
			|| value.endsWith(' ')
			|| value === ''
		) {
			// Use double quotes and escape
			return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
		}
		return value
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value)
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]'
		return '\n' + value.map((v) => `  - ${yamlValue(v)}`).join('\n')
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value)
		if (entries.length === 0) return '{}'
		return '\n' + entries.map(([k, v]) => `  ${k}: ${yamlValue(v)}`).join('\n')
	}
	return String(value)
}

/**
 * Convert frontmatter object to YAML string
 */
function frontmatterToYaml(frontmatter: Record<string, unknown>): string {
	const lines: string[] = []

	for (const [key, value] of Object.entries(frontmatter)) {
		const yamlVal = yamlValue(value)
		if (yamlVal.startsWith('\n')) {
			lines.push(`${key}:${yamlVal}`)
		} else {
			lines.push(`${key}: ${yamlVal}`)
		}
	}

	return lines.join('\n')
}

export interface GenerateOptions {
	/** URL path of the page */
	url: string
	/** Type of content (collection or static) */
	type: 'collection' | 'static'
	/** Path to source file (for collections) */
	sourcePath?: string
	/** Base URL for absolute URL generation (e.g., https://example.com) */
	baseUrl?: string
}

/**
 * Generate complete markdown output with frontmatter
 */
export function generateMarkdown(
	output: MarkdownOutput,
	options: GenerateOptions,
	includeFrontmatter = true,
): string {
	if (!includeFrontmatter) {
		return output.body
	}

	// Build frontmatter with metadata
	// Use absolute URL if baseUrl is provided, otherwise use relative path
	const absoluteUrl = options.baseUrl ? `${options.baseUrl}${options.url}` : options.url
	const frontmatter: Record<string, unknown> = {
		...output.frontmatter,
		url: absoluteUrl,
		type: options.type,
		generatedAt: new Date().toISOString(),
	}

	if (options.sourcePath) {
		frontmatter.source = options.sourcePath
	}

	const yamlContent = frontmatterToYaml(frontmatter)

	return `---\n${yamlContent}\n---\n\n${output.body}`
}

/**
 * Create a simple markdown output for collection content
 * that already has markdown body
 */
export function createCollectionOutput(
	frontmatter: Record<string, { value: string; line: number }>,
	body: string,
	sourcePath: string,
): MarkdownOutput {
	// Convert frontmatter to simple key-value
	const simpleFrontmatter: Record<string, unknown> = {}
	for (const [key, { value }] of Object.entries(frontmatter)) {
		simpleFrontmatter[key] = value
	}

	return {
		frontmatter: simpleFrontmatter,
		body,
		sourcePath,
	}
}

/**
 * Create markdown output from HTML conversion result
 */
export function createStaticOutput(
	metadata: { title?: string; description?: string },
	body: string,
): MarkdownOutput {
	const frontmatter: Record<string, unknown> = {}

	if (metadata.title) {
		frontmatter.title = metadata.title
	}
	if (metadata.description) {
		frontmatter.description = metadata.description
	}

	return {
		frontmatter,
		body,
	}
}
