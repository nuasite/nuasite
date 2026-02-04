/** SEO tracking options */
export interface SeoOptions {
	/** Whether to track SEO elements (default: true) */
	trackSeo?: boolean
	/** Whether to mark the page title with a CMS ID (default: true) */
	markTitle?: boolean
	/** Whether to parse JSON-LD structured data (default: true) */
	parseJsonLd?: boolean
}

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
	/** SEO tracking options */
	seo?: SeoOptions
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
	previewUrl?: string
	/** Viewport width (in px) used to render the preview iframe (default: 1280) */
	previewWidth?: number
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

/** Represents a single Tailwind color with its shades and values */
export interface TailwindColor {
	/** Color name (e.g., 'red', 'blue', 'primary') */
	name: string
	/** Map of shade to CSS color value (e.g., { '500': '#ef4444', '600': '#dc2626' }) */
	values: Record<string, string>
	/** Whether this is a custom/theme color vs default Tailwind */
	isCustom?: boolean
}

/** Attribute with source information for git diff tracking */
export interface Attribute {
	/** The resolved attribute value (from rendered HTML) */
	value: string
	/** The expression text if dynamic (e.g., "component.githubUrl") */
	sourceExpression?: string
	/** Path to the source file where the value is defined */
	sourcePath?: string
	/** Line number where the value is defined in source (1-indexed) */
	sourceLine?: number
	/** The exact source snippet that can be replaced for git diff */
	sourceSnippet?: string
}

/** Available colors palette from Tailwind config */
export interface AvailableColors {
	/** All available colors with their shades */
	colors: TailwindColor[]
	/** Default Tailwind color names */
	defaultColors: string[]
	/** Custom/theme color names */
	customColors: string[]
}

/** Text style value with class name and CSS properties */
export interface TextStyleValue {
	/** Tailwind class name (e.g., 'font-bold', 'text-xl') */
	class: string
	/** Display label for UI */
	label: string
	/** CSS properties to apply (e.g., { fontWeight: '700' }) */
	css: Record<string, string>
}

/** Available text styles from Tailwind config */
export interface AvailableTextStyles {
	/** Font weight options (font-normal, font-bold, etc.) */
	fontWeight: TextStyleValue[]
	/** Font size options (text-xs, text-sm, text-base, etc.) */
	fontSize: TextStyleValue[]
	/** Text decoration options (underline, line-through, etc.) */
	textDecoration: TextStyleValue[]
	/** Font style options (italic, not-italic) */
	fontStyle: TextStyleValue[]
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
	/** Full element snippet from opening to closing tag (for text content updates) */
	sourceSnippet?: string
	variableName?: string
	childCmsIds?: string[]
	parentComponentId?: string
	/** Collection name for collection entries (e.g., 'services', 'blog') */
	collectionName?: string
	/** Entry slug for collection entries (e.g., '3d-tisk') */
	collectionSlug?: string
	/** Path to the markdown content file (e.g., 'src/content/blog/my-post.md') */
	contentPath?: string

	// === Robustness fields ===

	/** Stable ID derived from content + context hash, survives rebuilds */
	stableId?: string
	/** SHA256 hash of sourceSnippet at generation time for conflict detection */
	sourceHash?: string
	/** Image metadata for img elements (replaces imageSrc/imageAlt) */
	imageMetadata?: ImageMetadata
	/** Content validation constraints */
	constraints?: ContentConstraints
	/** Color classes applied to this element (for buttons, etc.) */
	colorClasses?: Record<string, Attribute>
	/** All HTML attributes with source information */
	attributes?: Record<string, Attribute>
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
	/** File where this component is invoked (parent page/layout) */
	invocationSourcePath?: string
	/** 0-based index among same-name component invocations in the parent file */
	invocationIndex?: number
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

/** Field types for collection schema inference */
export type FieldType =
	| 'text'
	| 'textarea'
	| 'date'
	| 'boolean'
	| 'number'
	| 'image'
	| 'url'
	| 'select'
	| 'array'
	| 'object'
	| 'reference'

/** Definition of a single field in a collection's schema */
export interface FieldDefinition {
	/** Field name as it appears in frontmatter */
	name: string
	/** Inferred or specified field type */
	type: FieldType
	/** Whether the field is required (present in all entries) */
	required: boolean
	/** Default value for the field */
	defaultValue?: unknown
	/** Options for 'select' type fields */
	options?: string[]
	/** Item type for 'array' fields */
	itemType?: FieldType
	/** Nested fields for 'object' type */
	fields?: FieldDefinition[]
	/** Sample values seen across entries */
	examples?: unknown[]
}

/** Per-entry metadata for collection browsing */
export interface CollectionEntryInfo {
	slug: string
	title?: string
	sourcePath: string
	draft?: boolean
	/** URL pathname of the rendered page for this entry */
	pathname?: string
}

/** Definition of a content collection with inferred schema */
export interface CollectionDefinition {
	/** Collection identifier (directory name) */
	name: string
	/** Human-readable label for the collection */
	label: string
	/** Path to the collection directory */
	path: string
	/** Number of entries in the collection */
	entryCount: number
	/** Inferred field definitions */
	fields: FieldDefinition[]
	/** Whether the collection has draft support */
	supportsDraft?: boolean
	/** File extension used by entries */
	fileExtension: 'md' | 'mdx'
	/** Per-entry metadata for browsing */
	entries?: CollectionEntryInfo[]
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

/** Page entry for the global manifest */
export interface PageEntry {
	/** Page URL pathname (e.g., '/', '/about') */
	pathname: string
	/** Page title from SEO data */
	title?: string
}

export interface CmsManifest {
	/** Manifest metadata for versioning and conflict detection */
	metadata?: ManifestMetadata
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	componentDefinitions: Record<string, ComponentDefinition>
	/** Content collection entries indexed by "collectionName/slug" */
	collections?: Record<string, CollectionEntry>
	/** Collection definitions with inferred schemas */
	collectionDefinitions?: Record<string, CollectionDefinition>
	/** Available Tailwind colors from the project's config */
	availableColors?: AvailableColors
	/** Available text styles from the project's Tailwind config */
	availableTextStyles?: AvailableTextStyles
	/** All pages in the site with pathname and title */
	pages?: PageEntry[]
}

// === SEO Types ===

/** Source tracking information for SEO elements */
export interface SeoSourceInfo {
	/** CMS ID if element was marked for editing */
	id?: string
	/** Path to source file */
	sourcePath: string
	/** Line number in source file (1-indexed) */
	sourceLine: number
	/** Exact source code snippet for matching/replacement */
	sourceSnippet: string
}

/** SEO meta tag with source tracking */
export interface SeoMetaTag extends SeoSourceInfo {
	/** Meta tag name attribute (for name-based meta tags) */
	name?: string
	/** Meta tag property attribute (for Open Graph/Twitter tags) */
	property?: string
	/** Meta tag content value */
	content: string
}

/** Open Graph metadata */
export interface OpenGraphData {
	title?: SeoMetaTag
	description?: SeoMetaTag
	image?: SeoMetaTag
	url?: SeoMetaTag
	type?: SeoMetaTag
	siteName?: SeoMetaTag
}

/** Twitter Card metadata */
export interface TwitterCardData {
	card?: SeoMetaTag
	title?: SeoMetaTag
	description?: SeoMetaTag
	image?: SeoMetaTag
	site?: SeoMetaTag
}

/** JSON-LD structured data entry */
export interface JsonLdEntry extends SeoSourceInfo {
	/** Schema.org @type value */
	type: string
	/** Parsed JSON-LD data */
	data: Record<string, unknown>
}

/** Canonical URL link element */
export interface CanonicalUrl extends SeoSourceInfo {
	/** The canonical URL href value */
	href: string
}

/** Favicon link element */
export interface SeoFavicon extends SeoSourceInfo {
	/** The favicon href value */
	href: string
	/** The type attribute (e.g. "image/png", "image/svg+xml") */
	type?: string
	/** The sizes attribute (e.g. "32x32", "16x16") */
	sizes?: string
	/** The rel value (e.g. "icon", "apple-touch-icon") */
	rel: string
}

/** Page title element with optional CMS ID */
export interface SeoTitle extends SeoSourceInfo {
	/** Title text content */
	content: string
}

/** Meta keywords with parsed array */
export interface SeoKeywords extends SeoSourceInfo {
	/** Raw keywords string */
	content: string
	/** Parsed array of individual keywords */
	keywords: string[]
}

/** Complete SEO data for a page */
export interface PageSeoData {
	/** Page title */
	title?: SeoTitle
	/** Meta description */
	description?: SeoMetaTag
	/** Meta keywords */
	keywords?: SeoKeywords
	/** Canonical URL */
	canonical?: CanonicalUrl
	/** Favicons */
	favicons?: SeoFavicon[]
	/** Open Graph metadata */
	openGraph?: OpenGraphData
	/** Twitter Card metadata */
	twitterCard?: TwitterCardData
	/** JSON-LD structured data blocks */
	jsonLd?: JsonLdEntry[]
}
