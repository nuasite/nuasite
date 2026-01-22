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

/** Context around an element for resilient matching when exact match fails */
export interface SourceContext {
	/** Text content of the preceding sibling element */
	precedingText?: string
	/** Text content of the following sibling element */
	followingText?: string
	/** Parent element's tag name */
	parentTag?: string
	/** Position among siblings (0-indexed) */
	siblingIndex?: number
	/** Parent element's class attribute */
	parentClasses?: string
}

/** Image metadata for better tracking and integrity */
export interface ImageMetadata {
	/** Image source URL */
	src: string
	/** Alt text */
	alt: string
	/** SHA256 hash of image content (for integrity checking) */
	hash?: string
	/** Image dimensions */
	dimensions?: { width: number; height: number }
	/** Responsive image srcset */
	srcSet?: string
	/** Image sizes attribute */
	sizes?: string
}

/** Content constraints for validation */
export interface ContentConstraints {
	/** Maximum content length */
	maxLength?: number
	/** Minimum content length */
	minLength?: number
	/** Regex pattern for validation */
	pattern?: string
	/** Allowed HTML tags for rich text content */
	allowedTags?: string[]
}

/** Represents a single Tailwind color with its shades */
export interface TailwindColor {
	/** Color name (e.g., 'red', 'blue', 'primary') */
	name: string
	/** Available shades (e.g., ['50', '100', '200', ..., '900', '950']) */
	shades: string[]
	/** Whether this is a custom/theme color vs default Tailwind */
	isCustom?: boolean
}

/** Color classes currently applied to an element */
export interface ColorClasses {
	/** Background color class (e.g., 'bg-blue-500') */
	bg?: string
	/** Text color class (e.g., 'text-white') */
	text?: string
	/** Border color class (e.g., 'border-blue-600') */
	border?: string
	/** Hover background color class (e.g., 'hover:bg-blue-600') */
	hoverBg?: string
	/** Hover text color class (e.g., 'hover:text-gray-100') */
	hoverText?: string
	/** All color-related classes as found in the element */
	allColorClasses?: string[]
}

/** Available colors palette from Tailwind config */
export interface AvailableColors {
	/** All available colors with their shades */
	colors: TailwindColor[]
	/** Default Tailwind color names */
	defaultColors: string[]
	/** Custom/theme color names */
	customColors: string[]
	/** Hidden HTML containing all color classes for Tailwind safelist */
	colorSafelistHtml?: string
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
	/** Image source URL (for image entries) - deprecated, use imageMetadata */
	imageSrc?: string
	/** Image alt text (for image entries) - deprecated, use imageMetadata */
	imageAlt?: string

	// === Robustness fields ===

	/** Stable ID derived from content + context hash, survives rebuilds */
	stableId?: string
	/** SHA256 hash of sourceSnippet at generation time for conflict detection */
	sourceHash?: string
	/** Context around the element for resilient matching */
	sourceContext?: SourceContext
	/** Image metadata for img elements (replaces imageSrc/imageAlt) */
	imageMetadata?: ImageMetadata
	/** Content validation constraints */
	constraints?: ContentConstraints
	/** Color classes applied to this element (for buttons, etc.) */
	colorClasses?: ColorClasses
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

/** Manifest metadata for versioning and conflict detection */
export interface ManifestMetadata {
	/** Manifest schema version */
	version: string
	/** ISO timestamp when manifest was generated */
	generatedAt: string
	/** Build system that generated the manifest (e.g., 'astro', 'vite') */
	generatedBy?: string
	/** Build ID for correlation */
	buildId?: string
	/** SHA256 hash of all entry content for quick drift detection */
	contentHash?: string
	/** Per-source-file hashes for granular conflict detection */
	sourceFileHashes?: Record<string, string>
}

export interface CmsManifest {
	/** Manifest metadata for versioning and conflict detection */
	metadata?: ManifestMetadata
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	componentDefinitions: Record<string, ComponentDefinition>
	/** Content collection entries indexed by "collectionName/slug" */
	collections?: Record<string, CollectionEntry>
	/** Available Tailwind colors from the project's config */
	availableColors?: AvailableColors
}
