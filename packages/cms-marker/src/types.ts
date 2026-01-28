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

/** Represents a single Tailwind color with its shades and values */
export interface TailwindColor {
	/** Color name (e.g., 'red', 'blue', 'primary') */
	name: string
	/** Map of shade to CSS color value (e.g., { '500': '#ef4444', '600': '#dc2626' }) */
	values: Record<string, string>
	/** Whether this is a custom/theme color vs default Tailwind */
	isCustom?: boolean
}

/** Opacity classes currently applied to an element */
export interface OpacityClasses {
	/** Background opacity class (e.g., 'bg-opacity-90') */
	bgOpacity?: string
	/** Text opacity class (e.g., 'text-opacity-50') */
	textOpacity?: string
	/** Border opacity class (e.g., 'border-opacity-75') */
	borderOpacity?: string
}

/** Gradient color classes currently applied to an element */
export interface GradientClasses {
	/** Gradient start color (e.g., 'from-blue-500') */
	from?: string
	/** Gradient middle color (e.g., 'via-purple-500') */
	via?: string
	/** Gradient end color (e.g., 'to-pink-500') */
	to?: string
	/** Hover gradient start color (e.g., 'hover:from-blue-600') */
	hoverFrom?: string
	/** Hover gradient middle color (e.g., 'hover:via-purple-600') */
	hoverVia?: string
	/** Hover gradient end color (e.g., 'hover:to-pink-600') */
	hoverTo?: string
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
	/** Hover border color class (e.g., 'hover:border-blue-700') */
	hoverBorder?: string
	/** Gradient color classes */
	gradient?: GradientClasses
	/** Opacity classes */
	opacity?: OpacityClasses
	/** All color-related classes as found in the element */
	allColorClasses?: string[]
}

/** Link attributes for anchor elements (for git diff tracking) */
export interface LinkAttributes {
	/** The href attribute value */
	href: string
	/** Target attribute (e.g., '_blank', '_self') */
	target?: string
	/** Rel attribute (e.g., 'noopener noreferrer') */
	rel?: string
	/** Title attribute */
	title?: string
	/** Download attribute (triggers file download) */
	download?: string | boolean
}

/** Button attributes for button elements (for git diff tracking) */
export interface ButtonAttributes {
	/** Button type (submit, reset, button) */
	type?: string
	/** Whether the button is disabled */
	disabled?: boolean
	/** Form ID the button belongs to */
	form?: string
	/** Form action URL override */
	formAction?: string
	/** Form method override */
	formMethod?: string
}

/** Input attributes for form input elements (for git diff tracking) */
export interface InputAttributes {
	/** Input type (text, email, password, checkbox, etc.) */
	type?: string
	/** Input name for form submission */
	name?: string
	/** Placeholder text */
	placeholder?: string
	/** Whether the input is required */
	required?: boolean
	/** Validation pattern (regex) */
	pattern?: string
	/** Mobile keyboard type (numeric, email, tel, etc.) */
	inputMode?: string
	/** Autocomplete hint (email, username, current-password, etc.) */
	autoComplete?: string
	/** Whether the input is disabled */
	disabled?: boolean
	/** Whether the input is readonly */
	readOnly?: boolean
	/** Minimum value (for number/date inputs) */
	min?: string
	/** Maximum value (for number/date inputs) */
	max?: string
	/** Step value (for number inputs) */
	step?: string
	/** Minimum length */
	minLength?: number
	/** Maximum length */
	maxLength?: number
}

/** Form attributes for form elements (for git diff tracking) */
export interface FormAttributes {
	/** Form submission endpoint */
	action?: string
	/** HTTP method (GET, POST, etc.) */
	method?: string
	/** Encoding type (multipart/form-data, etc.) */
	encType?: string
	/** Whether to disable HTML5 validation */
	noValidate?: boolean
	/** Target for form submission (_blank, _self, etc.) */
	target?: string
	/** Form name */
	name?: string
}

/** Media attributes for video/audio elements (for git diff tracking) */
export interface MediaAttributes {
	/** Media source URL */
	src?: string
	/** Poster image URL (video only) */
	poster?: string
	/** Whether to show controls */
	controls?: boolean
	/** Whether to autoplay */
	autoplay?: boolean
	/** Whether to mute audio */
	muted?: boolean
	/** Whether to loop playback */
	loop?: boolean
	/** Whether to play inline on mobile */
	playsInline?: boolean
	/** Preload strategy (none, metadata, auto) */
	preload?: string
}

/** Iframe attributes for embedded content (for git diff tracking) */
export interface IframeAttributes {
	/** Iframe source URL */
	src?: string
	/** Accessibility title */
	title?: string
	/** Permissions policy (camera, microphone, etc.) */
	allow?: string
	/** Sandbox restrictions */
	sandbox?: string
	/** Loading strategy (lazy, eager) */
	loading?: string
	/** Width */
	width?: string
	/** Height */
	height?: string
	/** Name attribute */
	name?: string
}

/** Select attributes for dropdown elements (for git diff tracking) */
export interface SelectAttributes {
	/** Select name for form submission */
	name?: string
	/** Whether multiple selection is allowed */
	multiple?: boolean
	/** Whether the select is required */
	required?: boolean
	/** Whether the select is disabled */
	disabled?: boolean
	/** Number of visible options */
	size?: number
}

/** Textarea attributes for multiline input (for git diff tracking) */
export interface TextareaAttributes {
	/** Textarea name for form submission */
	name?: string
	/** Placeholder text */
	placeholder?: string
	/** Whether the textarea is required */
	required?: boolean
	/** Whether the textarea is disabled */
	disabled?: boolean
	/** Whether the textarea is readonly */
	readOnly?: boolean
	/** Number of visible rows */
	rows?: number
	/** Number of visible columns */
	cols?: number
	/** Minimum length */
	minLength?: number
	/** Maximum length */
	maxLength?: number
	/** Wrap behavior (soft, hard, off) */
	wrap?: string
}

/** ARIA accessibility attributes (for git diff tracking) */
export interface AriaAttributes {
	/** ARIA role (button, tab, navigation, dialog, etc.) */
	role?: string
	/** Screen reader label */
	ariaLabel?: string
	/** ID of element that labels this one */
	ariaLabelledBy?: string
	/** ID of element that describes this one */
	ariaDescribedBy?: string
	/** Whether hidden from assistive technology */
	ariaHidden?: boolean
	/** Expanded state for collapsibles */
	ariaExpanded?: boolean
	/** Pressed state for toggle buttons */
	ariaPressed?: boolean | 'mixed'
	/** Selected state for tabs/options */
	ariaSelected?: boolean
	/** Disabled state */
	ariaDisabled?: boolean
	/** Required state */
	ariaRequired?: boolean
	/** Invalid state */
	ariaInvalid?: boolean | 'grammar' | 'spelling'
	/** Live region announcement type */
	ariaLive?: 'polite' | 'assertive' | 'off'
	/** Atomic update for live regions */
	ariaAtomic?: boolean
	/** Busy state */
	ariaBusy?: boolean
	/** Current state (page, step, location, date, time, true, false) */
	ariaCurrent?: string
	/** Controls relationship */
	ariaControls?: string
	/** Owns relationship */
	ariaOwns?: string
	/** Haspopup type */
	ariaHasPopup?: boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'
}

/** Custom data-* attributes (for git diff tracking) */
export interface DataAttributes {
	/** All data-* attributes as key-value pairs (without 'data-' prefix) */
	[key: string]: string | undefined
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
	/** Link attributes for anchor elements (href, target, rel, title) */
	linkAttributes?: LinkAttributes
	/** Button attributes (type, disabled, form, etc.) */
	buttonAttributes?: ButtonAttributes
	/** Input attributes (type, name, placeholder, required, etc.) */
	inputAttributes?: InputAttributes
	/** Form attributes (action, method, enctype, etc.) */
	formAttributes?: FormAttributes
	/** Media attributes for video/audio (src, controls, autoplay, etc.) */
	mediaAttributes?: MediaAttributes
	/** Iframe attributes (src, title, allow, sandbox, etc.) */
	iframeAttributes?: IframeAttributes
	/** Select attributes (name, multiple, required, etc.) */
	selectAttributes?: SelectAttributes
	/** Textarea attributes (name, placeholder, rows, cols, etc.) */
	textareaAttributes?: TextareaAttributes
	/** ARIA accessibility attributes (role, aria-label, etc.) */
	ariaAttributes?: AriaAttributes
	/** Custom data-* attributes */
	dataAttributes?: DataAttributes
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
	/** Open Graph metadata */
	openGraph?: OpenGraphData
	/** Twitter Card metadata */
	twitterCard?: TwitterCardData
	/** JSON-LD structured data blocks */
	jsonLd?: JsonLdEntry[]
}
