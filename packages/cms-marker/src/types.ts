export interface CmsMarkerOptions {
	attributeName?: string
	includeTags?: string[] | null
	excludeTags?: string[]
	includeEmptyText?: boolean
	generateManifest?: boolean
	manifestFile?: string
	markComponents?: boolean
	componentDirs?: string[]
	/** Directory containing content collections (default: 'src/content') */
	contentDir?: string
}

export interface ComponentProp {
	name: string
	type: string
	required: boolean
	defaultValue?: string
	description?: string
}

export interface ComponentDefinition {
	name: string
	file: string
	props: ComponentProp[]
	description?: string
	slots?: string[]
}

export interface ManifestEntry {
	id: string
	tag: string
	/** Plain text content (for display/search) */
	text: string
	/** HTML content when element contains inline styling (strong, em, etc.) */
	html?: string
	sourcePath?: string
	sourceLine?: number
	sourceSnippet?: string
	sourceType?: 'static' | 'variable' | 'prop' | 'computed' | 'collection' | 'image'
	variableName?: string
	childCmsIds?: string[]
	parentComponentId?: string
	/** Collection name for collection entries (e.g., 'services', 'blog') */
	collectionName?: string
	/** Entry slug for collection entries (e.g., '3d-tisk') */
	collectionSlug?: string
	/** Path to the markdown content file (e.g., 'src/content/blog/my-post.md') */
	contentPath?: string
	/** Image source URL (for image entries) */
	imageSrc?: string
	/** Image alt text (for image entries) */
	imageAlt?: string
}

export interface ComponentInstance {
	id: string
	componentName: string
	file: string
	sourcePath: string
	sourceLine: number
	props: Record<string, any>
	slots?: Record<string, string>
	parentId?: string
}

/** Represents a content collection entry (markdown file) */
export interface CollectionEntry {
	/** Collection name (e.g., 'services', 'blog') */
	collectionName: string
	/** Entry slug (e.g., '3d-tisk') */
	collectionSlug: string
	/** Path to the markdown file relative to project root */
	sourcePath: string
	/** Frontmatter fields with their values and line numbers */
	frontmatter: Record<string, { value: string; line: number }>
	/** Full markdown body content */
	body: string
	/** Line number where body starts (1-indexed) */
	bodyStartLine: number
	/** ID of the wrapper element containing the rendered markdown */
	wrapperId?: string
}

export interface CmsManifest {
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	componentDefinitions: Record<string, ComponentDefinition>
	/** Content collection entries indexed by "collectionName/slug" */
	collections?: Record<string, CollectionEntry>
}
